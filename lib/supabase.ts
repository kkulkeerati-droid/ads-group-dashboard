import type { AdRow } from "./types";

// ─── Supabase layer (ออปชัน) ─────────────────────────────────────────
// ถ้ายังไม่ตั้ง SUPABASE env → ทุกฟังก์ชันเป็น no-op / null
// เว็บยังทำงานได้ปกติ (live API หรือ demo) โดยไม่ต้องมี Supabase
// เมื่อสมัคร Supabase แล้ว: รัน SQL ใน supabase/migrations/ แล้วใส่ env ครบ

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function supabaseEnabled(): boolean {
  return Boolean(URL && SERVICE_KEY);
}

const TABLE = "ad_metrics_daily";

async function sb(path: string, init: RequestInit) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

// เขียนทับข้อมูลรายวัน (upsert ตาม unique key platform+account+ad+date)
export async function upsertRows(rows: AdRow[]): Promise<number> {
  if (!supabaseEnabled() || rows.length === 0) return 0;
  const mapped = rows.map((r) => ({
    platform: r.platform,
    account_id: r.accountId,
    account_name: r.accountName,
    ad_name: r.adName,
    date: r.date || null,
    spend: r.spend,
    impressions: r.impressions,
    reach: r.reach,
    results: r.results,
    revenue: r.revenue || 0,
    purchases: r.purchases || 0,
    result_type: r.resultType || null,
  }));
  // รวมแถวที่ชน unique key กันเองใน batch — ads คนละตัวแต่ชื่อซ้ำ (จากการ duplicate ad)
  // ไม่งั้น Postgres error 21000: ON CONFLICT cannot affect row a second time
  const byKey = new Map<string, (typeof mapped)[0]>();
  for (const p of mapped) {
    const k = `${p.platform}|${p.account_id}|${p.ad_name}|${p.date}`;
    const ex = byKey.get(k);
    if (ex) {
      ex.spend += p.spend; ex.impressions += p.impressions;
      ex.reach += p.reach; ex.results += p.results;
      ex.revenue += p.revenue; ex.purchases += p.purchases;
    } else byKey.set(k, { ...p });
  }
  const payload = [...byKey.values()];
  // แบ่งเป็นก้อนละ 500
  let n = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    await sb(`${TABLE}?on_conflict=platform,account_id,ad_name,date`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
    n += chunk.length;
  }
  return n;
}

// ─── ยอดขายจริงต่อสินค้า (สำหรับ ROAS จริง — ปิดการขายในแชท/COD นอก pixel) ──
const SALES_TABLE = "product_sales_daily";

// รวมยอดขายจริงต่อกลุ่มสินค้าในช่วงวันที่ (key → บาท)
export async function readSalesByGroup(since: string, until: string): Promise<Record<string, number>> {
  if (!supabaseEnabled()) return {};
  const q = `${SALES_TABLE}?select=group_key,sales&date=gte.${since}&date=lte.${until}&limit=50000`;
  const res = await sb(q, { method: "GET" });
  const data = (await res.json()) as any[];
  const out: Record<string, number> = {};
  for (const r of data) out[r.group_key] = (out[r.group_key] || 0) + (Number(r.sales) || 0);
  return out;
}

// บันทึกยอดขายจริง (upsert ตาม platform+group+วัน)
export async function upsertSales(
  rows: { date: string; groupKey: string; sales: number; platform?: string; note?: string }[]
): Promise<number> {
  if (!supabaseEnabled() || rows.length === 0) return 0;
  const payload = rows.map((r) => ({
    platform: r.platform || "all",
    group_key: r.groupKey,
    date: r.date,
    sales: r.sales,
    note: r.note || null,
  }));
  await sb(`${SALES_TABLE}?on_conflict=platform,group_key,date`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(payload),
  });
  return payload.length;
}

// วันเก่าสุดที่มีใน cache — ใช้เช็คว่า cache ครอบช่วงที่ขอครบไหม (กันโชว์ข้อมูลไม่ครบ)
export async function earliestDate(
  platform: "meta" | "tiktok" | "all"
): Promise<string | null> {
  if (!supabaseEnabled()) return null;
  let q = `${TABLE}?select=date&date=not.is.null&order=date.asc&limit=1`;
  if (platform !== "all") q += `&platform=eq.${platform}`;
  const res = await sb(q, { method: "GET" });
  const data = (await res.json()) as any[];
  return data[0]?.date || null;
}

// อ่านข้อมูลช่วงวันที่ (สำหรับ /api/metrics โหมด supabase)
export async function readRows(
  platform: "meta" | "tiktok" | "all",
  since: string,
  until: string
): Promise<AdRow[]> {
  if (!supabaseEnabled()) return [];
  let q = `${TABLE}?select=*&date=gte.${since}&date=lte.${until}&limit=50000`;
  if (platform !== "all") q += `&platform=eq.${platform}`;
  const res = await sb(q, { method: "GET" });
  const data = (await res.json()) as any[];
  return data.map((d) => ({
    platform: d.platform,
    accountId: d.account_id,
    accountName: d.account_name,
    adName: d.ad_name,
    spend: Number(d.spend) || 0,
    impressions: Number(d.impressions) || 0,
    reach: Number(d.reach) || 0,
    results: Number(d.results) || 0,
    revenue: Number(d.revenue) || 0,
    purchases: Number(d.purchases) || 0,
    resultType: d.result_type || undefined,
    date: d.date || undefined,
  }));
}

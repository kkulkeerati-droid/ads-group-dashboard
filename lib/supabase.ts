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
    result_type: r.resultType || null,
    replies: r.replies || 0,
    purchases: r.purchases || 0,
    revenue: r.revenue || 0,
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
      ex.replies += p.replies; ex.purchases += p.purchases; ex.revenue += p.revenue;
    } else byKey.set(k, { ...p });
  }
  const payload = [...byKey.values()];
  // แบ่งเป็นก้อนละ 500
  // คอลัมน์คุณภาพ (replies/purchases/revenue) อาจยังไม่มีในฐานข้อมูล (ยังไม่รัน migration 0002)
  // → ถ้า Supabase ปฏิเสธเพราะไม่รู้จักคอลัมน์ ให้ตัดออกแล้วส่งใหม่ (ระบบไม่พังระหว่างรอ migrate)
  const strip = (o: any) => {
    const { replies, purchases, revenue, ...rest } = o;
    return rest;
  };
  let n = 0;
  let dropQuality = false;
  for (let i = 0; i < payload.length; i += 500) {
    const raw = payload.slice(i, i + 500);
    const send = (rows: any[]) =>
      sb(`${TABLE}?on_conflict=platform,account_id,ad_name,date`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
    try {
      await send(dropQuality ? raw.map(strip) : raw);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (!dropQuality && /replies|purchases|revenue|PGRST204|column/i.test(msg)) {
        dropQuality = true;
        await send(raw.map(strip));
      } else throw e;
    }
    n += raw.length;
  }
  return n;
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
    resultType: d.result_type || undefined,
    date: d.date || undefined,
    replies: Number(d.replies) || 0,
    purchases: Number(d.purchases) || 0,
    revenue: Number(d.revenue) || 0,
  }));
}

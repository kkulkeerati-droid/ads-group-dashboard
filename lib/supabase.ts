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
  const payload = rows.map((r) => ({
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
  }));
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
  }));
}

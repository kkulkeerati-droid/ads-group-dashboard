import type { AdRow, AdsetInfo } from "./types";

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
const ADSET_TABLE = "ad_adsets";

/** ตัวระบุแอดที่เขียนลง DB — ข้อมูลเก่าไม่มี ad_id จึงใช้ชื่อแทน (ไม่งั้น unique key พัง)
 *  แถวที่ ad_id == ad_name = แถวเก่าที่ยัง "รวมชื่อซ้ำ" อยู่ ต้อง re-sync ทับ */
const rowAdId = (r: AdRow) => r.adId || r.adName;

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

// เขียนทับข้อมูลรายวัน (upsert ตาม unique key platform+account+ad_id+date)
// ⚠️ เคย key ด้วย ad_name → ads คนละตัวที่ชื่อซ้ำถูกยุบเป็นแถวเดียว ตัวชนะถูกกลบ
//    (P-FLOW 2 ยิง 1:1:3 ตั้งชื่อเหมือนกันทั้งชุด · AI/Ultra/600/7Aug ROAS 14.15 → โชว์ 6.49)
export async function upsertRows(rows: AdRow[], syncedAt?: string): Promise<number> {
  if (!supabaseEnabled() || rows.length === 0) return 0;
  const stamp = syncedAt || new Date().toISOString();
  const mapped = rows.map((r) => ({
    platform: r.platform,
    account_id: r.accountId,
    account_name: r.accountName,
    ad_id: rowAdId(r),
    ad_name: r.adName,
    adset_id: r.adsetId || null,
    adset_name: r.adsetName || null,
    campaign_id: r.campaignId || null,
    campaign_name: r.campaignName || null,
    date: r.date || null,
    spend: r.spend,
    impressions: r.impressions,
    reach: r.reach,
    results: r.results,
    result_type: r.resultType || null,
    replies: r.replies || 0,
    purchases: r.purchases || 0,
    purchases_valued: r.purchasesValued || 0,
    revenue: r.revenue || 0,
    // ต้องส่งเองทุกครั้ง — default now() ทำงานตอน insert เท่านั้น ไม่ทำตอน merge
    // ใช้เป็น watermark ให้ pruneStale รู้ว่าแถวไหน "รอบนี้ไม่ได้ถูกแตะ" = ค้างมาจากอดีต
    updated_at: stamp,
  }));
  // รวมแถวที่ชน unique key กันเองใน batch — Meta คืน ad_id ซ้ำในหน้าเดียวได้
  // ไม่งั้น Postgres error 21000: ON CONFLICT cannot affect row a second time
  //
  // ⚠️ ต้องรวมตาม "key ที่ DB ใช้จริง" ไม่ใช่ key ที่เราอยากใช้
  //    ถ้ายังไม่ได้รัน migration 0003 ตารางยัง unique ที่ ad_name อยู่ →
  //    ถ้ารวมตาม ad_id แล้วส่งไป แอด 4 ตัวชื่อเดียวกันจะชน unique เก่า = 21000 พังทั้งรอบ
  //    (โค้ดใหม่ + DB เก่า ต้องอยู่ร่วมกันได้ ไม่งั้น deploy กับ migrate ต้องเป๊ะวินาทีเดียวกัน)
  const mergeBy = (keyOf: (p: (typeof mapped)[0]) => string) => {
    const byKey = new Map<string, (typeof mapped)[0]>();
    for (const p of mapped) {
      const k = keyOf(p);
      const ex = byKey.get(k);
      if (ex) {
        ex.spend += p.spend; ex.impressions += p.impressions;
        ex.reach += p.reach; ex.results += p.results;
        ex.replies += p.replies; ex.purchases += p.purchases;
        ex.purchases_valued += p.purchases_valued; ex.revenue += p.revenue;
      } else byKey.set(k, { ...p });
    }
    return [...byKey.values()];
  };
  const payloadById = mergeBy((p) => `${p.platform}|${p.account_id}|${p.ad_id}|${p.date}`);
  // โหมดถอย: รวมตามชื่อแบบเดิม (ตัวเลขรายแอดผิด แต่ยอดรวมยังถูก และระบบไม่ล่ม)
  const payloadByName = () => mergeBy((p) => `${p.platform}|${p.account_id}|${p.ad_name}|${p.date}`);

  // คอลัมน์ใหม่อาจยังไม่มีในฐานข้อมูล (ยังไม่รัน migration 0002 / 0003)
  // → ถ้า Supabase ปฏิเสธ ให้ถอยทีละชั้น (ระบบไม่พังระหว่างรอ migrate)
  const stripAdId = (o: any) => {
    const { ad_id, adset_id, adset_name, campaign_id, campaign_name, purchases_valued, ...rest } = o;
    return rest;
  };
  const stripQuality = (o: any) => {
    const { replies, purchases, revenue, ...rest } = o;
    return rest;
  };
  const isSchemaErr = (m: string) =>
    /ad_id|adset_id|campaign_id|purchases_valued|PGRST204|42P10|21000|constraint|column|does not exist/i.test(m);

  let dropAdId = false;   // ยังไม่ได้รัน 0003
  let dropQuality = false; // ยังไม่ได้รัน 0002

  const post = (rows: any[]) => {
    let body = rows;
    if (dropAdId) body = body.map(stripAdId);
    if (dropQuality) body = body.map(stripQuality);
    return sb(`${TABLE}?on_conflict=platform,account_id,${dropAdId ? "ad_name" : "ad_id"},date`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body),
    });
  };

  let n = 0;
  let payload = payloadById;
  for (let i = 0; i < payload.length; i += 500) {
    const raw = payload.slice(i, i + 500);
    try {
      await post(raw);
      n += raw.length;
      continue;
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (!isSchemaErr(msg)) throw e;
      if (!dropAdId) {
        // ถอยไปโหมดชื่อ — ต้อง "รวมใหม่ทั้งก้อน" ไม่ใช่แค่ตัดคอลัมน์ทิ้ง
        // ไม่งั้นแถวชื่อซ้ำยังอยู่ครบแล้วชน unique เก่าอีกรอบ
        dropAdId = true;
        payload = payloadByName();
        i = -500; n = 0; // เริ่มก้อนใหม่ตั้งแต่ต้น (ก้อนที่ผ่านไปแล้วเป็น upsert idempotent)
        continue;
      }
      if (!dropQuality) {
        dropQuality = true;
        i -= 500; // ลองก้อนเดิมซ้ำด้วย shape ใหม่
        continue;
      }
      throw e;
    }
  }
  return n;
}

/** ลบแถวในช่วงวันที่ที่ "รอบ sync นี้ไม่ได้แตะ" — แอดที่ถูกลบ/archive Meta ไม่คืนมาแล้ว
 *  upsert อย่างเดียวจะไม่มีวันลบมันออก แถวค้างบวกเข้ายอดรวมตลอดไป
 *  (P-FLOW 2 4–10 ส.ค.: Meta ฿14,333.92 vs dashboard ฿14,605 — ต่าง ฿271 น่าจะมาจากตรงนี้)
 *  ⭐ เรียก "หลัง" upsert สำเร็จเท่านั้น — ถ้า upsert ล้มแล้วลบก่อน = ข้อมูลหาย */
export async function pruneStale(
  platform: "meta" | "tiktok",
  since: string,
  until: string,
  syncedAt: string,
  accountIds: string[]
): Promise<number> {
  if (!supabaseEnabled() || accountIds.length === 0) return 0;
  // ลบเฉพาะบัญชีที่ดึงสำเร็จรอบนี้ — บัญชีที่ error จะไม่มีแถวใหม่ ห้ามไปลบของเก่าทิ้ง
  const inList = accountIds.map((a) => `"${a}"`).join(",");
  const q =
    `${TABLE}?platform=eq.${platform}` +
    `&date=gte.${since}&date=lte.${until}` +
    `&updated_at=lt.${encodeURIComponent(syncedAt)}` +
    `&account_id=in.(${inList})`;
  const res = await sb(q, {
    method: "DELETE",
    headers: { Prefer: "return=representation", Accept: "application/json" },
  });
  const gone = (await res.json()) as any[];
  return Array.isArray(gone) ? gone.length : 0;
}

// ─── targeting/งบระดับ adset (snapshot สถานะตอนนี้ ไม่ใช่รายวัน) ────────
export async function upsertAdsets(list: AdsetInfo[]): Promise<number> {
  if (!supabaseEnabled() || list.length === 0) return 0;
  const stamp = new Date().toISOString();
  const byId = new Map<string, any>();
  for (const a of list) {
    byId.set(`${a.platform}|${a.adsetId}`, {
      platform: a.platform,
      account_id: a.accountId,
      adset_id: a.adsetId,
      adset_name: a.adsetName,
      campaign_id: a.campaignId || null,
      campaign_name: a.campaignName || null,
      daily_budget: a.dailyBudget,
      lifetime_budget: a.lifetimeBudget,
      created_time: a.createdTime || null,
      effective_status: a.effectiveStatus || null,
      age_min: a.ageMin ?? null,
      age_max: a.ageMax ?? null,
      genders: a.genders || null,
      countries: a.countries || null,
      interests: a.interests,
      custom_audiences: a.customAudiences,
      excluded_audiences: a.excludedAudiences,
      lookalikes: a.lookalikes,
      platforms: a.platforms || null,
      is_broad: a.isBroad,
      updated_at: stamp,
    });
  }
  const payload = [...byId.values()];
  for (let i = 0; i < payload.length; i += 500) {
    await sb(`${ADSET_TABLE}?on_conflict=platform,adset_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload.slice(i, i + 500)),
    });
  }
  return payload.length;
}

export async function readAdsets(platform: "meta" | "tiktok" | "all"): Promise<AdsetInfo[]> {
  if (!supabaseEnabled()) return [];
  let q = `${ADSET_TABLE}?select=*&limit=20000`;
  if (platform !== "all") q += `&platform=eq.${platform}`;
  let data: any[];
  try {
    const res = await sb(q, { method: "GET" });
    data = (await res.json()) as any[];
  } catch {
    return []; // ยังไม่ได้รัน migration 0003 — ไม่ใช่เรื่องคอขาดบาดตาย
  }
  return data.map((d) => ({
    platform: d.platform,
    accountId: d.account_id,
    adsetId: d.adset_id,
    adsetName: d.adset_name,
    campaignId: d.campaign_id || undefined,
    campaignName: d.campaign_name || undefined,
    dailyBudget: d.daily_budget === null ? null : Number(d.daily_budget),
    lifetimeBudget: d.lifetime_budget === null ? null : Number(d.lifetime_budget),
    createdTime: d.created_time || undefined,
    effectiveStatus: d.effective_status || undefined,
    ageMin: d.age_min ?? undefined,
    ageMax: d.age_max ?? undefined,
    genders: d.genders || undefined,
    countries: d.countries || undefined,
    interests: Number(d.interests) || 0,
    customAudiences: Number(d.custom_audiences) || 0,
    excludedAudiences: Number(d.excluded_audiences) || 0,
    lookalikes: Number(d.lookalikes) || 0,
    platforms: d.platforms || undefined,
    isBroad: Boolean(d.is_broad),
    updatedAt: d.updated_at || undefined,
  }));
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
  return data.map((d) => {
    const revenue = Number(d.revenue) || 0;
    const purchases = Number(d.purchases) || 0;
    return {
      platform: d.platform,
      accountId: d.account_id,
      accountName: d.account_name,
      // แถวเก่าที่ ad_id เท่ากับ ad_name = ยังไม่ได้ re-sync (ยังรวมชื่อซ้ำอยู่)
      // ปล่อยเป็น undefined เพื่อให้ปลายทางรู้ว่า "ไม่มี ad_id จริง" ผ่าน quality.rowsWithoutAdId
      adId: d.ad_id && d.ad_id !== d.ad_name ? d.ad_id : undefined,
      adName: d.ad_name,
      adsetId: d.adset_id || undefined,
      adsetName: d.adset_name || undefined,
      campaignId: d.campaign_id || undefined,
      campaignName: d.campaign_name || undefined,
      spend: Number(d.spend) || 0,
      impressions: Number(d.impressions) || 0,
      reach: Number(d.reach) || 0,
      results: Number(d.results) || 0,
      resultType: d.result_type || undefined,
      date: d.date || undefined,
      replies: Number(d.replies) || 0,
      purchases,
      // แถวเก่าไม่มีคอลัมน์นี้ → คำนวณย้อนจาก revenue แบบเดียวกับที่ meta.ts ทำ
      purchasesValued:
        d.purchases_valued === null || d.purchases_valued === undefined
          ? revenue > 0 ? purchases : 0
          : Number(d.purchases_valued) || 0,
      revenue,
    };
  });
}

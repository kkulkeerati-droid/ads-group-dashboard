import type { AdRow } from "./types";

// ─── TikTok adapter (โครงพร้อม เปิดใช้เมื่อมี token) ───────────────────
// TikTok Marketing API: /open_api/v1.3/report/integrated/get/
// ต้อง authorize แอปก่อน แล้วใส่ TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_IDS
// ใน .env.local โครงสร้าง output ตรงกับ Meta (AdRow) เพื่อรวมกลุ่มด้วย logic เดียวกัน

const BASE = "https://business-api.tiktok.com/open_api/v1.3";

interface FetchArgs {
  token: string;
  advertiserIds: string[];
  since: string;
  until: string;
}

async function fetchAdvertiserAds(
  token: string,
  advertiserId: string,
  since: string,
  until: string
): Promise<AdRow[]> {
  const rows: AdRow[] = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_AD",
      dimensions: JSON.stringify(["ad_id", "stat_time_day"]),
      metrics: JSON.stringify(["ad_name", "spend", "impressions", "reach", "conversion"]),
      start_date: since,
      end_date: until,
      page: String(page),
      page_size: "1000",
    });
    const res = await fetch(`${BASE}/report/integrated/get/?${params}`, {
      headers: { "Access-Token": token },
      cache: "no-store",
    });
    const json = await res.json();
    if (json.code !== 0) {
      throw new Error(`TikTok API: ${json.message}`);
    }
    const list = json.data?.list || [];
    for (const item of list) {
      const m = item.metrics || {};
      rows.push({
        platform: "tiktok",
        accountId: advertiserId,
        accountName: advertiserId,
        adName: m.ad_name || "",
        spend: parseFloat(m.spend || "0") || 0,
        impressions: parseInt(m.impressions || "0", 10) || 0,
        reach: parseInt(m.reach || "0", 10) || 0,
        results: Math.round(parseFloat(m.conversion || "0")) || 0,
        resultType: "conversion",
        date: item.dimensions?.stat_time_day?.slice(0, 10),
      });
    }
    const pageInfo = json.data?.page_info;
    if (!pageInfo || page >= (pageInfo.total_page || 1)) break;
    page += 1;
  }
  return rows;
}

export async function fetchTikTokAds(args: FetchArgs): Promise<AdRow[]> {
  const { token, advertiserIds, since, until } = args;
  const all = await Promise.allSettled(
    advertiserIds.map((id) => fetchAdvertiserAds(token, id, since, until))
  );
  const rows: AdRow[] = [];
  for (const r of all) {
    if (r.status === "fulfilled") rows.push(...r.value);
  }
  return rows;
}

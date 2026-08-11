import type { AdRow, AccountIssue, AdsetInfo } from "./types";

const VERSION = process.env.META_API_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;

// ลำดับความสำคัญของ action ที่นับเป็น "ผลลัพธ์" (results) — ปรับได้
// map: action_type ที่ Graph API คืน → label สั้น
const RESULT_ACTIONS: { match: string; label: string }[] = [
  { match: "messaging_conversation_started", label: "ทัก" },
  { match: "onsite_conversion.lead_grouped", label: "ลีด" },
  { match: "lead", label: "ลีด" },
  { match: "omni_purchase", label: "ซื้อ" },
  { match: "purchase", label: "ซื้อ" },
  { match: "link_click", label: "คลิก" },
];

// ── metric คุณภาพ: แยก "แชทผี" ออกจากคนจริง + ยอดขายจริง ────────────
// depth_2 = user ส่งข้อความ ≥2 ครั้ง (กลับมาตอบ = คนจริง) ← ตัวชี้ขาดว่าแชทมีคุณภาพไหม
const A_STARTED = "onsite_conversion.messaging_conversation_started_7d";
const A_REPLIED = "onsite_conversion.messaging_conversation_replied_7d";
const A_DEPTH2 = "onsite_conversion.messaging_user_depth_2_message_send";
const A_DEPTH3 = "onsite_conversion.messaging_user_depth_3_message_send";
const PURCHASE_TYPES = ["onsite_conversion.purchase", "omni_purchase", "purchase"];

const findAction = (arr: any[], type: string): number => {
  if (!Array.isArray(arr)) return 0;
  const hit = arr.find((a) => a.action_type === type);
  return hit ? parseFloat(hit.value || "0") || 0 : 0;
};
// ยอดซื้อ/มูลค่า: เลือก type แรกที่มีค่า (กันนับซ้ำ)
const findFirst = (arr: any[], types: string[]): number => {
  for (const t of types) {
    const v = findAction(arr, t);
    if (v > 0) return v;
  }
  return 0;
};

interface FetchArgs {
  token: string;
  accountIds?: string[];
  since: string;
  until: string;
  /** ดึง targeting/งบระดับ adset ด้วยไหม — payload หนัก ปิดไว้ตอน backfill ก้อนใหญ่ */
  withAdsets?: boolean;
}

// error ชั่วคราวของ Meta ที่ retry แล้วมักหาย (service unavailable / rate limit)
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 341, 613]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gget(url: string, tries = 3): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    let json: any;
    try {
      const res = await fetch(url, { cache: "no-store" });
      json = await res.json();
    } catch (netErr) {
      // network/parse error → retry สั้น ๆ
      if (attempt >= tries) throw netErr;
      await sleep(400 * attempt);
      continue;
    }
    if (json.error) {
      const code = json.error.code;
      if (TRANSIENT_CODES.has(code) && attempt < tries) {
        await sleep(500 * attempt); // backoff 0.5s, 1s
        continue;
      }
      throw new Error(`Meta API: ${json.error.message} (code ${code})`);
    }
    return json;
  }
}

function extractResults(actions: any[]): { results: number; resultType?: string } {
  if (!Array.isArray(actions)) return { results: 0 };
  for (const { match, label } of RESULT_ACTIONS) {
    const hit = actions.find((a) => (a.action_type || "").includes(match));
    if (hit) return { results: Math.round(parseFloat(hit.value || "0")) || 0, resultType: label };
  }
  return { results: 0 };
}

export interface MetaResult {
  rows: AdRow[];
  issues: AccountIssue[];
  adsets: AdsetInfo[];
}

// รายชื่อบัญชี + สถานะ (แยกบัญชีที่ดึงได้/ดึงไม่ได้)
async function listAccounts(
  token: string
): Promise<{ ok: { id: string; name: string }[]; issues: AccountIssue[] }> {
  const ok: { id: string; name: string }[] = [];
  const issues: AccountIssue[] = [];
  let url = `${GRAPH}/me/adaccounts?fields=account_id,name,account_status,disable_reason&limit=200&access_token=${token}`;
  while (url) {
    const json = await gget(url);
    for (const a of json.data || []) {
      const active = a.account_status === 1; // 1 = ACTIVE
      if (active) {
        ok.push({ id: a.account_id, name: a.name || a.account_id });
      } else {
        issues.push({
          id: a.account_id,
          name: a.name || a.account_id,
          status: String(a.account_status),
          reason: `account_status=${a.account_status}${a.disable_reason ? ", disable_reason=" + a.disable_reason : ""}`,
        });
      }
    }
    url = json.paging?.next || "";
  }
  return { ok, issues };
}

async function fetchAccountName(token: string, id: string): Promise<string> {
  try {
    const json = await gget(`${GRAPH}/act_${id}?fields=name&access_token=${token}`);
    return json.name || id;
  } catch {
    return id;
  }
}

async function fetchAccountAds(
  token: string,
  accountId: string,
  accountName: string,
  since: string,
  until: string
): Promise<AdRow[]> {
  const rows: AdRow[] = [];
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  // ⭐ ad_id คือ key จริง — ชื่อแอดซ้ำกันทั้งชุดเพราะทีมยิง 1:1:3 (บั๊กราก 11 ส.ค. 69)
  //    adset_id/campaign_id แถมมาฟรีในคอลเดียวกัน ใช้ join targeting + งบจริงทีหลัง
  let url =
    `${GRAPH}/act_${accountId}/insights` +
    `?level=ad&fields=ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,` +
    `spend,impressions,reach,actions,action_values&time_increment=1` +
    `&time_range=${timeRange}&limit=500&access_token=${token}`;
  while (url) {
    const json = await gget(url);
    for (const r of json.data || []) {
      const { results, resultType } = extractResults(r.actions);
      const purchases = Math.round(findFirst(r.actions, PURCHASE_TYPES));
      const revenue = findFirst(r.action_values, PURCHASE_TYPES);
      rows.push({
        platform: "meta",
        accountId,
        accountName,
        adId: r.ad_id || undefined,
        adName: r.ad_name || "",
        adsetId: r.adset_id || undefined,
        adsetName: r.adset_name || undefined,
        campaignId: r.campaign_id || undefined,
        campaignName: r.campaign_name || undefined,
        spend: parseFloat(r.spend || "0") || 0,
        impressions: parseInt(r.impressions || "0", 10) || 0,
        reach: parseInt(r.reach || "0", 10) || 0,
        results,
        resultType,
        date: r.date_start,
        // คุณภาพ: depth_2 = คนกลับมาตอบจริง (fallback replied_7d ถ้าไม่มี)
        replies: Math.round(findAction(r.actions, A_DEPTH2) || findAction(r.actions, A_REPLIED)),
        purchases,
        revenue,
        // ⚠️ Meta นับ onsite_conversion.purchase เป็น "ซื้อ" แม้ไม่มีมูลค่าติดมาเลย
        //    วัดจริง 3 ส.ค. 69: P-FLOW 2 มี 61 ซื้อ แต่ 35 ตัว (57%) มูลค่า ๐
        //    แอดหนึ่งใช้ ฿6.41 นับ 11 ซื้อ มูลค่า ๐ — เอาไปนับบันไดออเดอร์ไม่ได้
        purchasesValued: revenue > 0 ? purchases : 0,
      });
    }
    url = json.paging?.next || "";
  }
  return rows;
}

// ─── targeting + งบจริงระดับ adset ────────────────────────────────────
// เดิมเดาจากชื่อแอด (budgetFromName / classifyFunnel) — ชื่อโกหกได้ ตัวนี้โกหกไม่ได้
// เป็น snapshot "สถานะตอนนี้" ไม่ใช่รายวัน (Meta ไม่เก็บ targeting ย้อนหลัง)
const num = (v: any): number | null => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function distillTargeting(t: any): Partial<AdsetInfo> {
  if (!t || typeof t !== "object") return { interests: 0, customAudiences: 0, excludedAudiences: 0, lookalikes: 0, isBroad: false };
  const flex: any[] = Array.isArray(t.flexible_spec) ? t.flexible_spec : [];
  const countIn = (o: any, k: string) => (Array.isArray(o?.[k]) ? o[k].length : 0);
  const interests =
    countIn(t, "interests") + countIn(t, "behaviors") +
    flex.reduce((s, f) => s + countIn(f, "interests") + countIn(f, "behaviors"), 0);
  const inc: any[] = Array.isArray(t.custom_audiences) ? t.custom_audiences : [];
  const exc: any[] = Array.isArray(t.excluded_custom_audiences) ? t.excluded_custom_audiences : [];
  // LAL มาในรูป custom_audience ที่ชื่อขึ้นต้นด้วย Lookalike — นับแยกไว้ให้เห็นว่าเป็นการขยาย ไม่ใช่รีทาเก็ต
  const lookalikes = inc.filter((a) => /lookalike|lal/i.test(a?.name || "")).length;
  const geo = t.geo_locations || {};
  const countries: string[] = Array.isArray(geo.countries) ? geo.countries : [];
  const regions = countIn(geo, "regions") + countIn(geo, "cities");
  return {
    ageMin: num(t.age_min) ?? undefined,
    ageMax: num(t.age_max) ?? undefined,
    genders: !Array.isArray(t.genders) || t.genders.length === 0 || t.genders.length === 2
      ? "all" : t.genders[0] === 1 ? "male" : "female",
    countries: countries.length ? countries.join(",") : regions ? `พื้นที่ย่อย ${regions} จุด` : undefined,
    interests,
    customAudiences: inc.length,
    excludedAudiences: exc.length,
    lookalikes,
    platforms: Array.isArray(t.publisher_platforms) ? t.publisher_platforms.join(",") : undefined,
    // "ปล่อยกว้าง" = ไม่ล็อกความสนใจ และไม่ยิงเข้าฐานลูกค้าเดิม (exclude ไม่นับ — กันซ้ำเฉย ๆ)
    isBroad: interests === 0 && inc.length === 0,
  };
}

async function fetchAccountAdsets(
  token: string,
  accountId: string
): Promise<AdsetInfo[]> {
  const out: AdsetInfo[] = [];
  // เอาเฉพาะตัวที่ยังไม่ถูกลบ — archived/deleted ไม่มีประโยชน์กับการตัดสินใจวันนี้
  const statuses = encodeURIComponent(JSON.stringify(["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW"]));
  let url =
    `${GRAPH}/act_${accountId}/adsets` +
    `?fields=id,name,daily_budget,lifetime_budget,created_time,effective_status,targeting,` +
    `campaign{id,name}&effective_status=${statuses}&limit=200&access_token=${token}`;
  while (url) {
    const json = await gget(url);
    for (const a of json.data || []) {
      // Meta คืนงบเป็น "หน่วยย่อย" (สตางค์) — ต้องหาร 100 ไม่งั้นงบพองร้อยเท่า
      const daily = num(a.daily_budget);
      const life = num(a.lifetime_budget);
      out.push({
        platform: "meta",
        accountId,
        adsetId: a.id,
        adsetName: a.name || a.id,
        campaignId: a.campaign?.id,
        campaignName: a.campaign?.name,
        dailyBudget: daily !== null && daily > 0 ? daily / 100 : null,
        lifetimeBudget: life !== null && life > 0 ? life / 100 : null,
        createdTime: a.created_time,
        effectiveStatus: a.effective_status,
        interests: 0, customAudiences: 0, excludedAudiences: 0, lookalikes: 0, isBroad: false,
        ...distillTargeting(a.targeting),
      });
    }
    url = json.paging?.next || "";
  }
  return out;
}

export async function fetchMetaAds(args: FetchArgs): Promise<MetaResult> {
  const { token, since, until } = args;
  let accounts: { id: string; name: string }[];
  const issues: AccountIssue[] = [];

  if (args.accountIds && args.accountIds.length > 0) {
    accounts = await Promise.all(
      args.accountIds.map(async (id) => ({ id, name: await fetchAccountName(token, id) }))
    );
  } else {
    const listed = await listAccounts(token);
    accounts = listed.ok;
    issues.push(...listed.issues);
  }

  const settled = await Promise.allSettled(
    accounts.map((a) => fetchAccountAds(token, a.id, a.name, since, until))
  );

  const rows: AdRow[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") rows.push(...r.value);
    else
      issues.push({
        id: accounts[i].id,
        name: accounts[i].name,
        status: "FETCH_ERROR",
        reason: String(r.reason).slice(0, 200),
      });
  });

  // targeting/งบ — เป็นของแถม ล้มได้โดยไม่ทำให้ตัวเลขหลักพัง
  const adsets: AdsetInfo[] = [];
  if (args.withAdsets) {
    const got = await Promise.allSettled(accounts.map((a) => fetchAccountAdsets(token, a.id)));
    got.forEach((r, i) => {
      if (r.status === "fulfilled") adsets.push(...r.value);
      else
        issues.push({
          id: accounts[i].id,
          name: accounts[i].name,
          status: "ADSET_FETCH_ERROR",
          reason: String(r.reason).slice(0, 200),
        });
    });
  }

  return { rows, issues, adsets };
}

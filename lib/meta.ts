import type { AdRow, AccountIssue } from "./types";

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
  let url =
    `${GRAPH}/act_${accountId}/insights` +
    `?level=ad&fields=ad_name,spend,impressions,reach,actions,action_values&time_increment=1` +
    `&time_range=${timeRange}&limit=500&access_token=${token}`;
  while (url) {
    const json = await gget(url);
    for (const r of json.data || []) {
      const { results, resultType } = extractResults(r.actions);
      rows.push({
        platform: "meta",
        accountId,
        accountName,
        adName: r.ad_name || "",
        spend: parseFloat(r.spend || "0") || 0,
        impressions: parseInt(r.impressions || "0", 10) || 0,
        reach: parseInt(r.reach || "0", 10) || 0,
        results,
        resultType,
        date: r.date_start,
        // คุณภาพ: depth_2 = คนกลับมาตอบจริง (fallback replied_7d ถ้าไม่มี)
        replies: Math.round(findAction(r.actions, A_DEPTH2) || findAction(r.actions, A_REPLIED)),
        purchases: Math.round(findFirst(r.actions, PURCHASE_TYPES)),
        revenue: findFirst(r.action_values, PURCHASE_TYPES),
      });
    }
    url = json.paging?.next || "";
  }
  return rows;
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

  return { rows, issues };
}

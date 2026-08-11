// ─── สมองฝั่ง AE — อ่านผลแล้วสั่งงานแบบคนยิงแอดจริง ────────────────
// ต่างจาก lib/decide.ts ตรงที่ decide.ts ตอบ "ตัวนี้ดีหรือแย่"
// ส่วนไฟล์นี้ตอบ "แล้วพรุ่งนี้ทำอะไรกับมัน" — scale / หยุด / clone / ทำคอนเทนต์ใหม่
//
// หลักที่ยึด (มาจากวิธีทำงานจริง ไม่ใช่ตำรา):
//   1) งบขึ้นทีละ 20% ทุก 2-3 วัน — แรงกว่านี้ learning reset
//   2) อยากโตเร็วให้ duplicate ไปกลุ่มใหม่ (แนวนอน) ปลอดภัยกว่าดันงบตัวเดิม
//   3) clone แล้วต้องเช็ค 24 ชม. — เคยเจอ clone แพงกว่าตัวแม่ 2 เท่า
//   4) แอดอายุ < 3 วัน = learning ห้ามแตะ
//   5) ความถี่ขึ้น + ผลตก = ครีเอทีฟล้า ไม่ใช่กลุ่มพัง → เปลี่ยนคอนเทนต์ อย่าเพิ่งปิดกลุ่ม

import {
  ROAS_SCALE, ROAS_OK, ROAS_BREAKEVEN,
  MIN_ACTIVE_DAYS, MIN_SPEND_TO_JUDGE, MIN_DAYS_TO_SCALE, ANT_KILL_BUDGET_SHARE,
} from "./decide";
import { parseProduct, parseTheme, parseAudience } from "./content";
import { adKey } from "./types";
import type { AdRow, AdsetInfo } from "./types";

// ─── 1) ชั้น funnel — ดูจาก "กลุ่มเป้าหมาย" ในชื่อ ไม่ใช่ objective ────
// objective (ยอดขาย/Buy/msg/conv) บอกว่าตั้งให้ Meta หาอะไร
// แต่ชั้น funnel คือ "ยิงใส่ใคร" — คนละเรื่อง แอดหนึ่งตัวมีได้ทั้งสองอย่าง
export type Funnel = "TOF" | "MOF" | "BOF" | "?";

export const FUNNEL_LABEL: Record<Funnel, string> = {
  TOF: "TOF · คนใหม่",
  MOF: "MOF · คนอุ่น",
  BOF: "BOF · คนใกล้ซื้อ",
  "?": "ยังไม่ระบุกลุ่มในชื่อ",
};

/**
 * sure = ชื่อบอกกลุ่มเป้าหมายไว้จริง ๆ
 * sure=false = ชื่อไม่ได้บอก แต่ตีความตามค่าเริ่มต้นของบ้าน
 *   (ยืนยันกับ user 10 ส.ค. 69: แอดที่ชื่อไม่มีคำบอกกลุ่ม = ปล่อยกว้าง/Advantage+ = TOF)
 *   ยังนับเป็น TOF ในกราฟได้ แต่ต้องขึ้นแผง "ตั้งชื่อไม่ครบ" ให้ทีมไปแก้ชื่อ
 *   เพราะอ่านจากค่าเริ่มต้น = หลักฐานอ่อนกว่าอ่านจากชื่อ
 */
export interface FunnelCall { stage: Funnel; why: string; sure: boolean }

// คำที่แปลว่า "ตัดคนกลุ่มนี้ออก" — ตัดออกแล้วที่เหลือคือคนใหม่ = prospecting
// ⚠️ ห้ามใส่ \b ปิดท้ายคำไทย — \b ดูจาก [A-Za-z0-9_] อักษรไทยไม่นับเป็น word char
//    "Exซื้อ/600" จึงไม่มี boundary ระหว่าง ซื้อ กับ / → \b ทำให้ไม่ match เลย (เคยพลาดมาแล้ว)
//    เรียง ทักซื้อ ก่อน ทัก/ซื้อ เพื่อให้จับตัวยาวสุดก่อน
const EXCLUDE_RE = /\bEX\s?(ALL\b|AI\b|\d{1,3}\b|ทักซื้อ|ซื้อ|ทัก)/;

export function classifyFunnel(adName: string): FunnelCall {
  const n = (adName || "").toUpperCase();

  // ── retarget มาก่อนเสมอ ──
  // ชื่อจริงมีทั้ง RE กับ Ex ปนกัน เช่น "AI/RE180/Exซื้อ/Omni" = ยิงคนอุ่นแต่ตัดคนซื้อแล้วออก
  // ถ้าเช็ค Ex ก่อนจะกลายเป็น TOF ผิดทั้งแถบ
  const re = n.match(/\bRE\s?(\d{1,3})\b/);
  if (re) {
    const days = parseInt(re[1], 10);
    return days <= 90
      ? { stage: "BOF", why: `RE${days} — คนที่เพิ่งมีปฏิสัมพันธ์ใน ${days} วัน`, sure: true }
      : { stage: "MOF", why: `RE${days} — คนอุ่นย้อนหลัง ${days} วัน`, sure: true };
  }
  if (/\bRERUN\b|\bRE\b/.test(n)) return { stage: "MOF", why: "retarget (ไม่ระบุช่วงวัน)", sure: true };

  // ── prospecting ──
  if (/\bLAL\b|LAL\s?\d/.test(n)) return { stage: "TOF", why: "Lookalike — คนคล้ายลูกค้า ยังไม่เคยรู้จักเรา", sure: true };
  if (/\bAW\b/.test(n)) return { stage: "TOF", why: "Broad / Advantage+ — ปล่อยให้ Meta หาเอง", sure: true };
  if (EXCLUDE_RE.test(n)) {
    const tag = n.match(EXCLUDE_RE)![0].replace(/\s/g, "");
    return { stage: "TOF", why: `${tag} — ตัดคนที่เคยมีปฏิสัมพันธ์ออก = ล่าคนใหม่ล้วน`, sure: true };
  }
  if (/ลูกค้าใหม่/.test(adName)) return { stage: "TOF", why: "ระบุในชื่อว่ายิงหาลูกค้าใหม่", sure: true };
  // ยืนยันกับ user แล้ว: ส่วนร่วม/ENG = objective "ส่วนร่วม → สนทนา" ที่ยิงกว้าง ไม่ใช่ custom audience
  if (/\bENG\b|ส่วนร่วม|ENGAGE/.test(n)) return { stage: "TOF", why: "แคมเปญส่วนร่วม → สนทนา ยิงกว้าง — เติมคนเข้าถังบนสุด", sure: true };
  // ยืนยันกับ user แล้ว: "view msg" ที่ไม่มี RE = ยิงกว้างหาคนดูใหม่ (ตัวที่ retarget จะเขียน RE ต่อท้าย)
  if (/\bVIEW\b|วิว/.test(n)) return { stage: "TOF", why: "แอดยอดวิว ยิงกว้าง — เติมคนดูไว้ retarget ทีหลัง", sure: true };

  // ── ชื่อไม่ได้บอกกลุ่มเลย ──
  // ยืนยันกับ user 10 ส.ค. 69: แอดพวกนี้ตั้ง targeting เป็นปล่อยกว้าง/Advantage+ = TOF
  // แต่ติดธง sure=false ไว้ เพราะอ่านจากค่าเริ่มต้น ไม่ได้อ่านจากชื่อ
  return {
    stage: "TOF",
    why: "ชื่อไม่มีคำบอกกลุ่ม — ตีเป็นปล่อยกว้าง/Advantage+ ตามค่าเริ่มต้นของบ้าน (ควรใส่ AW ในชื่อ)",
    sure: false,
  };
}

// ─── 1.5) มาตรฐานชื่อ — ใช้ทั้งตอนตรวจและตอนเสนอชื่อใหม่ ───────────────
export const AUDIENCE_TOKENS = ["AW", "LAL", "LAL1-3%", "LAL2-3%", "ExAll", "Ex180", "Exซื้อ", "ENG", "VIEW", "RE7", "RE30", "RE60", "RE180", "RE365"] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * งบต่อวันที่ทีมเขียนไว้ในชื่อ เช่น "AI/AW/600/12Jul" → 600 · "500 > 700" → 700 (ตัวล่าสุด)
 * คืน null เมื่ออ่านไม่ชัด — **ยอมอ่านไม่ออก ดีกว่าอ่านผิด** เพราะค่านี้เป็นตัวตั้งเส้นปิดของกฎแอดมด 30%
 * (เคยพลาด: "Clone 2026-08-09 1306" อ่านเวลาเป็นงบ · "view msg 001 - 36-45" อ่านช่วงอายุ 45 เป็นงบ
 *  → เส้นปิดเหลือ ฿13.5 แอดที่เพิ่งใช้ ฿20 วันแรกโดนสั่งปิดทันที)
 */
export function budgetFromName(adName: string): number | null {
  let n = adName || "";
  // 1) ตัดหางที่ Meta เติมเอง (Clone 2026-08-09 1306 / - สำเนา) — มีทั้งวันที่และเวลา
  n = n.replace(/\s*(?:[-–]\s*สำเนา|Clone\s+\d{4}-\d{2}-\d{2}[\s\d]*)\s*$/gi, " ");
  // 2) ตัดคำที่มีตัวเลขแต่ไม่ใช่งบ
  const cleaned = n
    .replace(/\bRE\s?\d{1,3}\b/gi, " ")
    .replace(/\bEX\s?\d{1,3}\b/gi, " ")
    .replace(/\bLAL\s?\d(-\d)?%?/gi, " ")
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\d{1,3}\s*[-–]\s*\d{1,3}/g, " ") // ช่วงอายุ เช่น 25-35 / 36-45
    .replace(/\d{1,3}\s*\+\+/g, " ")           // 55++
    .replace(/\d{1,2}\s?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*/gi, " ")
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, " ");    // เวลา
  const nums = [...cleaned.matchAll(/(?<![\d.%])(\d{2,5})(?![\d.%])/g)].map((m) => parseInt(m[1], 10));
  // 3) รับเฉพาะงบที่ทีมตั้งจริง (ลงท้าย 0 และอยู่ในช่วงที่เป็นไปได้) — กันเลขสุ่มอย่าง 1031/1306
  const plausible = nums.filter((v) => v >= 30 && v <= 20000 && v % 10 === 0);
  return plausible.length ? plausible[plausible.length - 1] : null;
}

/** วันที่ในชื่อ เช่น "12Jul" / "04 AUG" / "19JULY" → "12Jul" */
export function dateFromName(adName: string): string | null {
  const m = (adName || "").match(/\b(\d{1,2})\s?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*/i);
  if (!m) return null;
  const mon = MONTHS.find((x) => x.toLowerCase() === m[2].toLowerCase())!;
  return `${parseInt(m[1], 10)}${mon}`;
}

/**
 * ชื่อที่ควรเปลี่ยนเป็น — ให้ทีมก๊อปไปวางใน Ads Manager ได้เลย
 * หลักคือ "แก้ให้น้อยที่สุด" — แค่แทรกคำบอกกลุ่มเข้าไป ของเดิมไม่หาย
 * (มาตรฐานเต็มอยู่ใน docs/AD-NAMING.md)
 */
export function suggestName(adName: string, token = "AW"): string | null {
  const name = (adName || "").trim();
  if (!name) return null;
  if (classifyFunnel(name).sure) return null; // อ่านออกอยู่แล้ว ไม่ต้องแก้

  // ตัดหางที่ Meta เติมเองออกก่อน (สำเนา / Clone 2026-08-08 1013) แล้วค่อยต่อกลับ
  const tailMatch = name.match(/\s*(?:[-–]\s*สำเนา|Clone\s+\d{4}-\d{2}-\d{2}[\s\d]*)\s*$/i);
  const tail = tailMatch ? tailMatch[0] : "";
  const core = tail ? name.slice(0, name.length - tail.length) : name;

  const parts = core.split("/");
  if (parts.length >= 2) {
    // มีรูปแบบ slash อยู่แล้ว → แทรกเป็นช่องที่ 2 (ตำแหน่งกลุ่มเป้าหมายตามมาตรฐาน)
    return [parts[0].trim(), token, ...parts.slice(1).map((p) => p.trim())].filter(Boolean).join("/") + tail;
  }

  // ชื่อแบบเว้นวรรค (เช่น "1 cut ยอดขาย ซื้อ - 700 19JULY") → แทรกหลังคำนำหน้า
  // ⚠️ ต้อง "ไม่ทิ้งข้อความเดิม" — ถ้าประกอบใหม่จากงบ+วันที่อย่างเดียว
  //    ชื่อ 2 ตัวที่ต่างกันจะกลายเป็นชื่อเดียวกัน แล้ว upsert ใน lib/supabase.ts
  //    จะรวมแถวเป็นแอดเดียว = ข้อมูลเพี้ยน
  const m = core.match(/^\s*(1\s*cut|1\s*c\.?c\.?|grd|unc|gpt\S*|a2|ai|au2|ap2|rerun)\b/i);
  const head = m ? m[0].trim() : core.split(/\s+/)[0];
  const rest = core.slice(m ? m[0].length : head.length).trim();
  return [head, token, rest].filter(Boolean).join("/") + tail;
}

// วัตถุประสงค์ (แกนคนละเส้นกับ funnel)
export function classifyObjective(adName: string): string {
  const n = (adName || "").toUpperCase();
  if (/ยอดขาย|\bBUY\b|ซื้อ|\bCONV\b|PURCHASE/.test(adName + n)) return "ขาย";
  if (/\bMSG\b|ทัก|MESSAGE/.test(adName + n)) return "ทักแชท";
  if (/\bENG\b|ส่วนร่วม/.test(n)) return "มีส่วนร่วม";
  if (/\bVIEW\b/.test(n)) return "ยอดวิว";
  return "ไม่ระบุ";
}

// ─── 2) จับ clone กับร่องรอยการขยับงบที่ทีมเขียนไว้ในชื่อ ──────────────
// ⚠️ \b ใช้กับ "สำเนา" ไม่ได้ (อักษรไทยไม่ใช่ word char) — ของเดิมใส่ \b ไว้
//    ทำให้ clone ที่ Meta ตั้งชื่อว่า "- สำเนา" ไม่เคยถูกจับเป็น clone เลย
//    เหลือแต่ตัวที่ลงท้าย "Clone 2026-08-07 1515" (อังกฤษ) ที่ \b ทำงานได้
const CLONE_RE = /\s*[-–]?\s*(สำเนา|(?:copy|clone)\b).*$/i;

export function cloneInfo(adName: string): { isClone: boolean; parent: string | null } {
  if (!CLONE_RE.test(adName)) return { isClone: false, parent: null };
  return { isClone: true, parent: adName.replace(CLONE_RE, "").trim() };
}

/** ทีมเขียนการขยับงบไว้ในชื่อ เช่น "600/16Jul > 900 19JULY" = เคยดันจาก 600 เป็น 900 */
export function budgetBumps(adName: string): number {
  return (adName.match(/>/g) || []).length;
}

// ─── 3) สรุปราย ad จาก row รายวัน + เทียบ 3 วันล่าสุด vs 4 วันก่อน ────
export interface Slice {
  spend: number; revenue: number; results: number; replies: number; purchases: number;
  /** ออเดอร์ที่มีมูลค่าติดมาด้วย — ตัวเดียวที่เอาไปนับบันไดออเดอร์ 10/20/30 ได้
   *  purchases ดิบมี event มูลค่า ๐ ปนถึง 57% (วัดจริง 3 ส.ค. 69) = ไฟเขียวปลอมให้สเกล */
  purchasesValued: number;
  impressions: number; reach: number;
  roas: number; cpReply: number; freq: number; days: number;
}

const emptySlice = (): Slice => ({ spend: 0, revenue: 0, results: 0, replies: 0, purchases: 0, purchasesValued: 0, impressions: 0, reach: 0, roas: 0, cpReply: 0, freq: 0, days: 0 });

function seal(s: Slice, dayCount: number): Slice {
  s.roas = s.spend > 0 ? s.revenue / s.spend : 0;
  s.cpReply = s.replies > 0 ? s.spend / s.replies : 0;
  s.freq = s.reach > 0 ? s.impressions / s.reach : 0;
  s.days = dayCount;
  return s;
}

export interface AdView {
  /** ad_id จริงจาก Meta — undefined = ข้อมูลเก่าก่อน migration 0003 (ยังรวมชื่อซ้ำอยู่) */
  adId?: string;
  adName: string; accountName: string; accountId: string;
  /** ในบัญชีเดียวกันมีแอดชื่อนี้กี่ตัว (1 = ไม่ซ้ำ) */
  nameDupes: number;
  /** ลำดับที่เท่าไหร่ในกลุ่มชื่อซ้ำ เรียงตามค่าแอดมากไปน้อย (1-based) */
  dupeRank: number;
  adsetId?: string; adsetName?: string; campaignId?: string; campaignName?: string;
  /** ── ยอดของ "ทั้งชุด" (แอดที่ใช้งบก้อนเดียวกัน = อยู่ adset เดียวกัน) ──
   *  งบเป็นของ adset ไม่ใช่ของแอด · ยิง 1:1:3 คือ 3 แอดหารงบก้อนเดียวกัน
   *  กติกาที่อ้าง "งบต่อวัน" ต้องตัดสินทั้งชุด ไม่ใช่ทีละตัว
   *  ไม่มี adsetId (ข้อมูลเก่า) → ถอยไปจับกลุ่มด้วยชื่อ ซึ่ง 1:1:3 ตั้งเหมือนกันอยู่แล้ว */
  setAds: number; setSpend: number; setRevenue: number;
  setReplies: number; setPurchasesValued: number;
  product: string; theme: string; audience: string;
  funnel: Funnel; funnelWhy: string; funnelSure: boolean; objective: string;
  isClone: boolean; parent: string | null; bumps: number;
  /** งบต่อวันที่เขียนไว้ในชื่อ (null = ชื่อไม่ได้บอก) */
  budget: number | null;
  all: Slice; recent: Slice; prior: Slice;
  firstSeen: string; lastSeen: string; activeDays: number;
}

/** ป้ายที่ใช้โชว์ในตาราง — ชื่อซ้ำต้องแยกออกจากกัน ไม่งั้น user เห็นชื่อเดียวกัน 4 บรรทัดแล้วงง
 *  ใช้ท้าย ad_id 6 ตัว เพราะ user ก๊อปไปหาใน Ads Manager ได้จริง (ต่างจากเลข 1/4 ที่ไม่มีความหมาย) */
export function adLabel(v: { adName: string; adId?: string; nameDupes: number; dupeRank: number }): string {
  if (v.nameDupes <= 1) return v.adName;
  const tail = v.adId ? `…${v.adId.slice(-6)}` : `#${v.dupeRank}`;
  return `${v.adName}  ${tail}`;
}

function addRow(s: Slice, r: AdRow, dates: Set<string>) {
  s.spend += r.spend; s.revenue += r.revenue || 0; s.results += r.results;
  s.replies += r.replies || 0; s.purchases += r.purchases || 0;
  s.purchasesValued += r.purchasesValued ?? ((r.revenue || 0) > 0 ? r.purchases || 0 : 0);
  s.impressions += r.impressions; s.reach += r.reach;
  if (r.date) dates.add(r.date);
}

/** recentDays = กี่วันล่าสุดนับเป็น "ตอนนี้" (default 3) */
export function buildAdViews(rows: AdRow[], until: string, recentDays = 3, priorDays = 4): AdView[] {
  const cut = addDays(until, -(recentDays - 1)); // >= cut = recent
  const priorFrom = addDays(cut, -priorDays);
  const map = new Map<string, AdView & { _d: Set<string>; _rd: Set<string>; _pd: Set<string> }>();

  for (const r of rows) {
    if (!r.adName) continue;
    // ⭐ key ต้องเป็น ad_id — ทีมยิง 1:1:3 ตั้งชื่อทุกตัวในชุดเหมือนกัน
    //    เคย key ด้วยชื่อ → 4 แอดยุบเป็นแถวเดียว ตัวชนะ ROAS 14.15 โดนเฉลี่ยเหลือ 6.49
    //    ข้อมูลเก่าไม่มี ad_id จึงถอยไปใช้ชื่อ (ยังรวมอยู่ แต่ quality.rowsWithoutAdId จะฟ้อง)
    const key = adKey(r);
    let v = map.get(key) as any;
    if (!v) {
      const f = classifyFunnel(r.adName);
      const c = cloneInfo(r.adName);
      v = {
        adId: r.adId, adName: r.adName, accountName: r.accountName, accountId: r.accountId,
        nameDupes: 1, dupeRank: 1,
        adsetId: r.adsetId, adsetName: r.adsetName,
        campaignId: r.campaignId, campaignName: r.campaignName,
        setAds: 1, setSpend: 0, setRevenue: 0, setReplies: 0, setPurchasesValued: 0,
        product: parseProduct(r.adName), theme: parseTheme(r.adName), audience: parseAudience(r.adName),
        funnel: f.stage, funnelWhy: f.why, funnelSure: f.sure, objective: classifyObjective(r.adName),
        isClone: c.isClone, parent: c.parent, bumps: budgetBumps(r.adName),
        budget: budgetFromName(r.adName),
        all: emptySlice(), recent: emptySlice(), prior: emptySlice(),
        firstSeen: r.date || "", lastSeen: r.date || "", activeDays: 0,
        _d: new Set<string>(), _rd: new Set<string>(), _pd: new Set<string>(),
      };
      map.set(key, v);
    }
    // adset/campaign อาจมาไม่ครบทุกแถว (แถวเก่า) — เติมให้เต็มจากแถวไหนก็ได้ที่มี
    if (!v.adsetId && r.adsetId) { v.adsetId = r.adsetId; v.adsetName = r.adsetName; }
    if (!v.campaignId && r.campaignId) { v.campaignId = r.campaignId; v.campaignName = r.campaignName; }
    addRow(v.all, r, v._d);
    if (r.date) {
      if (r.date < v.firstSeen || !v.firstSeen) v.firstSeen = r.date;
      if (r.date > v.lastSeen) v.lastSeen = r.date;
      if (r.date >= cut) addRow(v.recent, r, v._rd);
      else if (r.date >= priorFrom) addRow(v.prior, r, v._pd);
    }
  }

  const views = [...map.values()].map((v) => {
    seal(v.all, v._d.size); seal(v.recent, v._rd.size); seal(v.prior, v._pd.size);
    v.activeDays = v._d.size;
    const { _d, _rd, _pd, ...rest } = v as any;
    return rest as AdView;
  });

  // นับชื่อซ้ำ "ในบัญชีเดียวกัน" แล้วจัดอันดับตามค่าแอด — ใช้ทั้งตอนโชว์และตอนหาตัวแม่ของ clone
  const byName = new Map<string, AdView[]>();
  for (const v of views) {
    const k = `${v.accountId}::${v.adName.trim()}`;
    const list = byName.get(k);
    if (list) list.push(v); else byName.set(k, [v]);
  }
  for (const list of byName.values()) {
    list.sort((a, b) => b.all.spend - a.all.spend);
    list.forEach((v, i) => { v.nameDupes = list.length; v.dupeRank = i + 1; });
  }

  // ยอดรวม "ทั้งชุด" — แอดที่ใช้งบก้อนเดียวกัน (adset เดียวกัน)
  // ต้องมี เพราะกติกาที่อ้างงบต่อวันจะตัดสินผิดถ้าเอา spend รายตัวไปเทียบงบทั้งก้อน
  const bySet = new Map<string, AdView[]>();
  for (const v of views) {
    const k = `${v.accountId}::${v.adsetId || v.adName.trim()}`;
    const list = bySet.get(k);
    if (list) list.push(v); else bySet.set(k, [v]);
  }
  for (const list of bySet.values()) {
    const spend = list.reduce((s, v) => s + v.all.spend, 0);
    const revenue = list.reduce((s, v) => s + v.all.revenue, 0);
    const replies = list.reduce((s, v) => s + v.all.replies, 0);
    const pv = list.reduce((s, v) => s + v.all.purchasesValued, 0);
    for (const v of list) {
      v.setAds = list.length; v.setSpend = spend; v.setRevenue = revenue;
      v.setReplies = replies; v.setPurchasesValued = pv;
    }
  }

  return views;
}

/** เอา targeting + งบจริงจาก Meta มาทับการเดาจากชื่อแอด
 *
 *  ชื่อแอดเป็นสิ่งที่คนพิมพ์ — พิมพ์ผิด/ลืมเปลี่ยนตอน duplicate/ตั้งไม่ครบได้ตลอด
 *  targeting กับงบมาจาก Meta โดยตรง โกหกไม่ได้ · ตัวไหนมีของจริงให้ใช้ของจริง
 *
 *  ⚠️ ที่ยัง "ไม่" ทำ: งบเป็นของ adset ไม่ใช่ของแอด — ยิง 1:1:3 คือ 3 แอดใช้งบก้อนเดียวกัน
 *     ยังไม่หารเฉลี่ยเพราะกติกาแอดมดถูกจูนมากับงบเต็มก้อน (เทียบ spend รายแอด vs 30% ของงบ adset)
 *     ถ้าจะหาร ต้องคุยกับ user ก่อน ไม่ใช่เปลี่ยนเงียบ ๆ */
export function attachAdsets(views: AdView[], adsets: AdsetInfo[]): AdView[] {
  if (!adsets.length) return views;
  const byId = new Map(adsets.map((a) => [a.adsetId, a]));
  for (const v of views) {
    const s = v.adsetId ? byId.get(v.adsetId) : undefined;
    if (!s) continue;

    // งบจริงชนะงบที่เขียนไว้ในชื่อเสมอ (null = ใช้งบระดับแคมเปญ CBO → ถอยไปใช้ชื่อ)
    if (s.dailyBudget && s.dailyBudget > 0) v.budget = s.dailyBudget;

    // ── funnel จาก targeting จริง ──
    if (s.isBroad) {
      v.funnel = "TOF"; v.funnelSure = true;
      v.funnelWhy = "targeting จริง: ไม่ล็อกความสนใจ ไม่มี custom audience = ปล่อยกว้าง";
    } else if (s.lookalikes > 0 && s.customAudiences === s.lookalikes) {
      // มีแต่ LAL = ยังหาคนใหม่อยู่ ไม่ใช่รีทาเก็ต
      v.funnel = "TOF"; v.funnelSure = true;
      v.funnelWhy = `targeting จริง: ใช้ Lookalike ${s.lookalikes} ชุด = หาคนใหม่`;
    } else if (s.customAudiences > s.lookalikes && v.funnel === "?") {
      // มี custom audience ที่ไม่ใช่ LAL = ยิงใส่คนที่รู้จักเราแล้ว
      // แต่ API บอกไม่ได้ว่าเป็น MOF (อุ่น) หรือ BOF (ใกล้ซื้อ) — เดาเป็น MOF และยังไม่ถือว่าชัวร์
      // เพื่อให้ยังโผล่ในตาราง "ชื่อไม่ครบ" ให้ทีมไปแก้ชื่อ
      v.funnel = "MOF";
      v.funnelWhy = `targeting จริง: ยิงใส่ custom audience ${s.customAudiences - s.lookalikes} ชุด (API แยก MOF/BOF ไม่ได้ — ชื่อยังต้องบอก)`;
    }
  }
  return views;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

// ─── 4) ครีเอทีฟล้าหรือยัง ────────────────────────────────────────────
// ล้า = คนเห็นซ้ำถี่ขึ้น แต่ผลแย่ลง → ปัญหาอยู่ที่ "ตัวคอนเทนต์" ไม่ใช่กลุ่ม
// (ถ้ากลุ่มพัง ความถี่จะไม่ขึ้น เพราะ Meta หาคนใหม่ไม่ได้ตั้งแต่แรก)
export interface Fatigue { score: 0 | 1 | 2 | 3; signals: string[]; tired: boolean }

export function fatigueOf(v: AdView): Fatigue {
  const s: string[] = [];
  const enough = v.prior.spend > 200 && v.recent.spend > 200;
  if (!enough) return { score: 0, signals: [], tired: false };

  if (v.recent.freq > v.prior.freq * 1.15 && v.recent.freq >= 1.6)
    s.push(`คนเห็นซ้ำถี่ขึ้น ${v.prior.freq.toFixed(2)}→${v.recent.freq.toFixed(2)}`);
  if (v.prior.roas > 0 && v.recent.roas < v.prior.roas * 0.75)
    s.push(`ROAS ตก ${v.prior.roas.toFixed(2)}→${v.recent.roas.toFixed(2)}`);
  if (v.prior.cpReply > 0 && v.recent.cpReply > v.prior.cpReply * 1.25)
    s.push(`ต้นทุนต่อคนตอบแพงขึ้น ${Math.round(v.prior.cpReply)}→${Math.round(v.recent.cpReply)} บาท`);

  const score = Math.min(3, s.length) as 0 | 1 | 2 | 3;
  return { score, signals: s, tired: score >= 2 };
}

// ─── 4.5) บันไดออเดอร์ — ตัดสินตามจำนวน ไม่ใช่ตาม ROAS อย่างเดียว ────
// จาก ebook "บทเรียนแม่เอ โฆษณา 100 ล้าน":
//   1–5 ออเดอร์ = ดูก่อน · 10 = เริ่มวิเคราะห์ · 20–30 = เริ่มตัดสินใจ · 50+ = สเกลจริงจัง
//   "อย่าสเกลเพราะ ROAS สวย แต่เพิ่งขายได้ 2 ออเดอร์"
// ROAS จากออเดอร์เดียวไม่ใช่หลักฐาน — มันคือความบังเอิญที่ยังไม่ถูกพิสูจน์
/** ตัวประกอบในชุด 1:1:3 ที่กินงบเกินสัดส่วนนี้ของทั้งชุดโดยไม่มียอด = รูรั่วจริง ไม่ใช่ "งบไหลไปหาตัวชนะ"
 *  0.4 = สูงกว่าส่วนแบ่งเท่า ๆ กันของชุด 3 ตัว (33%) พอสมควร — ต้องกินเกินจริงถึงจะโดนสั่งปิด */
export const SET_LEAK_SHARE = 0.4;

export const ORDERS_ANALYZE = 10; // ต่ำกว่านี้ = ยังอ่านไม่ออก
export const ORDERS_DECIDE = 20;  // ถึงตรงนี้ค่อยตัดสินใจได้
export const ORDERS_SCALE = 30;   // ถึงตรงนี้ค่อยดันงบ/แตกตัวได้เต็มปาก

/** ต้นทุนต่อออเดอร์นิ่งหรือยัง — นิ่ง 3 วันขึ้นไปถึงจะเพิ่มงบได้ (เงื่อนไขที่ 1 ของแม่เอ) */
export function costIsStable(v: AdView): { stable: boolean; why: string } {
  const r = v.recent, p = v.prior;
  // ใช้ purchasesValued — purchases ดิบมีออเดอร์มูลค่า ๐ ปน ทำให้ต้นทุน/ออเดอร์ต่ำผิดจริง
  const cprOf = (s: Slice) => (s.purchasesValued > 0 ? s.spend / s.purchasesValued : 0);
  const a = cprOf(p), b = cprOf(r);
  if (!a || !b) return { stable: false, why: "ยังไม่มีออเดอร์พอให้ดูว่าต้นทุนนิ่งไหม" };
  const drift = Math.abs(b - a) / a;
  return drift <= 0.3
    ? { stable: true, why: `ต้นทุนต่อออเดอร์นิ่ง (฿${Math.round(a)}→฿${Math.round(b)})` }
    : { stable: false, why: `ต้นทุนต่อออเดอร์ยังแกว่ง ฿${Math.round(a)}→฿${Math.round(b)} (${(drift * 100).toFixed(0)}%)` };
}

// ─── 4.7) สเกลผ่านหรือไม่ผ่าน — วัดที่ "กำไรหลังค่าแอดต่อวัน" ไม่ใช่ ROAS ──
// จาก ebook แม่เอ บทที่ 31: สเกลผ่าน = ยิง 1,600 กำไร 1,000 → ยิง 3,200 กำไร 1,500
//                          สเกลไม่ผ่าน = ยิง 3,200 แล้วกำไรเหลือ 500
// ROAS ลดตอนสเกลเป็นเรื่องปกติ — ตัวที่ต้องดูคือเงินที่เข้ากระเป๋าต่อวัน
export interface ScaleCheck { state: "grew" | "shrank" | "flat" | "unknown"; passed: boolean | null; why: string }

export function scaleVerdict(v: AdView): ScaleCheck {
  const r = v.recent, p = v.prior;
  if (!r.days || !p.days || p.spend < 200 || r.spend < 200)
    return { state: "unknown", passed: null, why: "ข้อมูลยังไม่พอเทียบก่อน/หลัง" };
  const spendR = r.spend / r.days, spendP = p.spend / p.days;
  const profitR = (r.revenue - r.spend) / r.days, profitP = (p.revenue - p.spend) / p.days;
  const B = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
  const move = `${B(spendP)}→${B(spendR)}/วัน`;
  const gain = `กำไรหลังค่าแอด ${B(profitP)}→${B(profitR)}/วัน`;

  if (spendR > spendP * 1.25) {
    // เผื่อ 10% — กำไรขยับลงนิดเดียวยังไม่นับว่าสเกลไม่ผ่าน (เลขรายวันเหวี่ยงเป็นปกติ)
    const floor = profitP >= 0 ? profitP * 0.9 : profitP * 1.1;
    const passed = profitR >= floor;
    return {
      state: "grew", passed,
      why: passed ? `สเกลผ่าน — ดันงบ ${move} แล้ว${gain}` : `สเกลไม่ผ่าน — ดันงบ ${move} แต่${gain}`,
    };
  }
  if (spendR < spendP * 0.75) return { state: "shrank", passed: null, why: `งบลดลง ${move} · ${gain}` };
  return { state: "flat", passed: null, why: `งบใกล้เคียงเดิม ${move} · ${gain}` };
}

// ─── 5) พรุ่งนี้ทำอะไรกับแอดตัวนี้ ────────────────────────────────────
export type AeAction = "SCALE" | "CLONE" | "KEEP" | "REDUCE" | "STOP" | "NEW_CREATIVE" | "FIX_OFFER" | "FIX_TRACKING" | "WAIT";

export const ACTION_META: Record<AeAction, { icon: string; label: string; order: number }> = {
  STOP:        { icon: "🔴", label: "หยุด",          order: 1 },
  REDUCE:      { icon: "🟠", label: "ลดงบ",          order: 2 },
  NEW_CREATIVE:{ icon: "🎬", label: "เปลี่ยนคอนเทนต์", order: 3 },
  FIX_OFFER:   { icon: "💬", label: "แก้ข้อเสนอ/แชท", order: 4 },
  FIX_TRACKING:{ icon: "⚫", label: "เช็คการนับยอด",   order: 5 },
  CLONE:       { icon: "🧬", label: "แตกตัวใหม่",     order: 6 },
  SCALE:       { icon: "🟢", label: "เพิ่มงบ 20%",    order: 7 },
  KEEP:        { icon: "🔵", label: "ปล่อยไว้",       order: 8 },
  WAIT:        { icon: "⏳", label: "ยังไม่แตะ",      order: 9 },
};

export interface AeCall { action: AeAction; why: string; how: string; money: number }

export function callFor(
  v: AdView,
  ctx: { peerHasRevenue: boolean; avgFreq: number; windowStart: string; windowEnd: string }
): AeCall | null {
  const a = v.all;
  if (a.spend <= 0) return null;
  const fat = fatigueOf(v);
  const M = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");

  // ── แยก "เพิ่งเปิด" ออกจาก "หยุดไปแล้ว" ──
  // ทั้งคู่มี activeDays น้อยเหมือนกัน แต่ต้องสั่งงานคนละแบบ
  //   เพิ่งเปิด  = firstSeen อยู่ใน 3 วันล่าสุด → learning ห้ามแตะ
  //   หยุดไปแล้ว = lastSeen ไม่ใช่วันสุดท้ายของช่วง → ไม่ต้องสั่งปิดซ้ำ
  const brandNew = v.firstSeen >= addDays(ctx.windowEnd, -(MIN_ACTIVE_DAYS - 1));
  const stoppedAlready = v.lastSeen < ctx.windowEnd;

  if (brandNew && v.activeDays < MIN_ACTIVE_DAYS) {
    return { action: "WAIT", money: 0,
      why: `เพิ่งเปิด ${v.firstSeen} (ยิงมา ${v.activeDays} วัน · ${M(a.spend)})`,
      how: `รอให้ครบ ${MIN_ACTIVE_DAYS} วันก่อน แตะตอนนี้ learning จะรีเซ็ต` };
  }
  if (stoppedAlready) {
    const verdict = a.revenue > 0
      ? `ปิดไปตอน ROAS ${a.roas.toFixed(2)}`
      : `ปิดไปโดยไม่มียอดขาย (${M(a.spend)})`;
    return { action: "WAIT", money: 0,
      why: `หยุดยิงไปแล้วตั้งแต่ ${v.lastSeen} — ${verdict}`,
      how: a.revenue > 0 && a.roas >= ROAS_SCALE
        ? "ตัวนี้เคยทำเงินได้ดี ถ้าปิดโดยไม่ตั้งใจให้เปิดกลับ"
        : "ไม่ต้องทำอะไร — แค่อย่าลืมว่ามันเคยกินงบไปเท่านี้" };
  }
  // ── กติกาแอดมด (ebook บทที่ 34): กินงบเกิน 30% ของงบวันแล้วยังไม่มีการซื้อ = คัดตัวตายออก ──
  // ใช้ได้เฉพาะตัวที่เขียนงบไว้ในชื่อ (เช่น "AI/AW/600/12Jul") — ตัวที่ไม่ได้เขียนก็ข้ามไป
  // ต้องเช็คก่อน MIN_SPEND_TO_JUDGE เพราะแอดมดงบ ฿300/วัน จะไม่มีวันถึง ฿300 ใน 1 วัน
  // ⚠️ ต้องไม่ทำงานเมื่อ "มีคนกลับมาคุยอยู่" — บทที่ 34 เองก็บอกว่าปิดแล้วให้แอดมินลากแชตต่อ
  //    ถ้ามีคนคุยอยู่จริง สิ่งที่ต้องแก้คือขั้นปิดการขาย (บทที่ 4) ไม่ใช่ฆ่าแอดที่กำลังส่งคนมาให้
  //
  // ⭐ งบเป็นของ adset ไม่ใช่ของแอด — ยิง 1:1:3 คือ 3 แอดหารงบก้อนเดียวกัน
  //    ถ้าเอา spend รายตัวไปเทียบ 30% ของงบทั้งก้อน จะสั่งปิดตัวประกอบทีละตัว
  //    ซึ่งชนกับหลัก 1:1:3 เอง: "หน้าที่ของ 3 ตัวไม่ใช่ให้เก่งเท่ากัน แต่มีไว้หาตัวแบก"
  //    → ชุดที่มีหลายแอด ให้ตัดสิน "ทั้งชุด" · ชุดตัวเดียวก็เหมือนเดิม
  const antKill = v.budget ? v.budget * ANT_KILL_BUDGET_SHARE : 0;
  const inSet = v.setAds > 1;
  const setSpend = inSet ? v.setSpend : a.spend;
  const setPV = inSet ? v.setPurchasesValued : a.purchasesValued;
  const setReplies = inSet ? v.setReplies : a.replies;
  // purchasesValued — ออเดอร์มูลค่า ๐ ไม่ควรช่วยให้แอดที่ไม่ทำเงินรอดจากด่านนี้
  if (antKill && setPV === 0 && setReplies === 0 && setSpend >= antKill && ctx.peerHasRevenue && v.activeDays >= 1) {
    return { action: "STOP", money: setSpend,
      why: inSet
        ? `ทั้งชุด ${v.setAds} แอด (งบ ${M(v.budget!)}/วัน) ใช้ไป ${M(setSpend)} แล้วยังไม่มีออเดอร์สักรายการ`
        : `งบในชื่อ ${M(v.budget!)}/วัน · ใช้ไป ${M(setSpend)} แล้วยังไม่มีออเดอร์สักรายการ`,
      how: `กติกาแอดมด: เกิน ${Math.round(ANT_KILL_BUDGET_SHARE * 100)}% ของงบวันแล้วยังไม่มีการซื้อ = ปิดก่อน${inSet ? " (ปิดทั้งชุด ไม่ใช่ทีละตัว — งบเป็นของชุด)" : ""} · ให้แอดมินลากแชตกระตุ้นปิดการขาย ถ้ามียอดเข้าค่อยเปิดกลับ` };
  }

  if (a.spend < MIN_SPEND_TO_JUDGE) {
    return { action: "WAIT", money: 0,
      why: `ใช้ยังไม่ถึง ${M(MIN_SPEND_TO_JUDGE)} (${M(a.spend)} ใน ${v.activeDays} วัน)`,
      how: "ข้อมูลน้อยเกินจะชี้ขาด — ปล่อยไว้ หรือถ้าตั้งใจทดสอบก็เพิ่มงบให้พอเก็บข้อมูล" };
  }

  // clone ที่แพงกว่าตัวแม่ = ตัดทิ้งเร็ว (กติกา 24 ชม.)
  // (เทียบกับตัวแม่ทำที่ชั้นบน — ตรงนี้ดูเฉพาะตัวมันเอง)

  // ไม่มียอดขายเลย
  if (a.revenue <= 0) {
    if (!ctx.peerHasRevenue) {
      return { action: "FIX_TRACKING", money: a.spend,
        why: `ใช้ ${M(a.spend)} แต่ทั้งกลุ่มไม่มียอดเข้าระบบเลย`,
        how: "เช็คก่อนว่าขายไม่ออกจริง หรือปิดการขายทางแชท/โทรแล้วยอดไม่ถูกส่งกลับ — อย่าเพิ่งปิด" };
    }
    // ── ตัวประกอบในชุด 1:1:3 ที่ยอด ๐ ทั้งที่ชุดขายได้ = ห้ามปิด ──
    // "หน้าที่ของ 3 ตัวไม่ใช่ให้เก่งเท่ากัน แต่มีไว้หาตัวแบก" — งบไหลไปหาตัวชนะเอง
    // ปิดตัวประกอบ = ทำลายกลไกคัดตัว แถมนับเป็น churn (เปิด-ปิดถี่จนไม่มีตัวไหนพ้น learning)
    // ⚠️ ยกเว้นตัวที่กินงบเกิน SET_LEAK_SHARE ของทั้งชุด — นั่นไม่ใช่ "งบไหลไปหาตัวชนะ" แต่คือรูรั่วจริง
    if (inSet && v.setRevenue > 0 && a.spend < v.setSpend * SET_LEAK_SHARE) {
      return { action: "KEEP", money: 0,
        why: `ยอด ๐ แต่เป็น 1 ใน ${v.setAds} แอดของชุดเดียวกัน ซึ่งทั้งชุดขายได้ ${M(v.setRevenue)} (ตัวนี้กินงบ ${Math.round((a.spend / v.setSpend) * 100)}% ของชุด)`,
        how: "อย่าปิด — นี่คือวิธีทำงานของ 1:1:3 · งบจะไหลไปหาตัวแบกเอง ปิดตัวประกอบคือทำลายกลไกคัดตัว" };
    }
    if (a.results > 0 && a.replies === 0) {
      return { action: "STOP", money: a.spend,
        why: `ทัก ${a.results} คน ไม่มีใครกลับมาตอบสักคน`,
        how: "คนที่ยิงไปเจอไม่ใช่กลุ่มที่สนใจ — ปิด แล้วเอางบไปตัวที่ยังตอบ" };
    }
    // ── มีคนกลับมาคุยแล้วแต่ยังไม่ซื้อ = ยังไม่ใช่เรื่องของแอด ──
    // สูตรตัดสินใจของแม่เอ: คนไม่ทัก → ปิดได้ · ทักแต่ไม่อ่าน → ปิดได้
    //   แต่ "ทัก + กลับมาคุย + ยังไม่ซื้อ" → ห้ามปิด ให้ไปแก้โปร/สคริปต์ขาย/การตอบแชท/การติดตามก่อน
    // (แอดหาคนถูกกลุ่มแล้ว — ที่พังคือขั้นปิดการขาย ปิดแอดทิ้งคือทิ้งคนที่คุยอยู่)
    if (a.replies > 0) {
      return { action: "FIX_OFFER", money: a.spend,
        why: `คนกลับมาคุย ${a.replies} คน (${M(a.cpReply)}/คน) แต่ยังไม่มีใครซื้อ — แอดหาคนถูกแล้ว ที่ยังไม่ผ่านคือขั้นปิดการขาย`,
        how: "อย่าเพิ่งปิด — ไล่ตามลำดับ: โปรโมชั่น/ข้อเสนอ → สคริปต์ขาย → ความเร็วตอบแชท → การติดตามลูกค้า · แก้ทีละอย่าง" };
    }
    return { action: "STOP", money: a.spend,
      why: `ใช้ ${M(a.spend)} ยอดขาย ๐ ทั้งที่ตัวอื่นในกลุ่มขายได้`,
      how: "ปิด — ระบบนับยอดใช้ได้ แปลว่าตัวนี้ขายไม่ออกจริง" };
  }

  const roas = v.recent.spend > 200 ? v.recent.roas : a.roas; // มีข้อมูลสดพอก็ใช้ตัวสด
  const label = v.recent.spend > 200 ? "3 วันล่าสุด" : "ทั้งช่วง";
  const scaled = scaleVerdict(v);

  // ── เพิ่งดันงบไปแล้วกำไรต่อวันหดลง = สเกลไม่ผ่าน ให้ถอยงบกลับ ──
  // (ebook บทที่ 31/44) เช็คก่อนบันได ROAS เพราะ ROAS ยังอาจดูดีอยู่ทั้งที่กำไรหด
  // แต่ถ้ายังอยู่เหนือเส้นสเกล ไม่ถอยงบ — แค่ห้ามเติมเพิ่ม (ไปโผล่ที่ชั้นล่างแทน)
  const scaleFailed = scaled.state === "grew" && scaled.passed === false;
  if (scaleFailed && roas >= ROAS_BREAKEVEN && roas < ROAS_SCALE) {
    return { action: "REDUCE", money: a.spend,
      why: `${scaled.why} (ROAS ${roas.toFixed(2)})`,
      how: "ถอยงบกลับระดับเดิม แล้วอยู่ตรงนั้น 2-3 วันให้ต้นทุนต่อออเดอร์นิ่งก่อน · อยากโตกว่านี้ให้แตกตัวใหม่แทนการอัดตัวเดิม" };
  }

  // ขาดทุน
  if (roas < ROAS_BREAKEVEN) {
    return { action: "STOP", money: a.spend - a.revenue,
      why: `ROAS ${roas.toFixed(2)} (${label}) — ขาดทุนตั้งแต่ยังไม่หักต้นทุนสินค้า`,
      how: `ปิด · เงินที่หยุดไหลออก ${M(a.spend - a.revenue)}` };
  }

  // คืนแค่ค่าแอด
  if (roas < ROAS_OK) {
    return fat.tired
      ? { action: "NEW_CREATIVE", money: a.spend,
          why: `ROAS ${roas.toFixed(2)} + ${fat.signals.join(" · ")}`,
          how: "กลุ่มยังใช้ได้แต่คอนเทนต์หมดแรง — ยิงคลิป/ภาพใหม่เข้าไปในชุดเดิม อย่าเพิ่งปิดกลุ่ม" }
      : { action: "REDUCE", money: a.spend - a.revenue,
          why: `ROAS ${roas.toFixed(2)} (${label}) — คืนแค่ค่าแอด ไม่พอต้นทุนสินค้า`,
          how: "ลดงบครึ่งหนึ่ง ให้เวลาแก้ 2-3 วัน ไม่ดีขึ้นค่อยปิด" };
  }

  // ยังไม่ถึงเส้นสเกล
  if (roas < ROAS_SCALE) {
    if (fat.tired) {
      return { action: "NEW_CREATIVE", money: a.spend,
        why: `ROAS ${roas.toFixed(2)} กำลังลง — ${fat.signals.join(" · ")}`,
        how: "เปลี่ยนคอนเทนต์ก่อนที่มันจะร่วงต่ำกว่าทุน กลุ่มนี้ยังมีของ" };
    }
    return { action: "KEEP", money: 0,
      why: `ROAS ${roas.toFixed(2)} (${label}) — ยังไม่ถึงเส้นสเกล ${ROAS_SCALE}`,
      how: "ปล่อยงบเท่าเดิม อย่าเพิ่งเติม ดูอีก 2-3 วัน" };
  }

  // ── ผ่านเส้นสเกลแล้ว แต่ยังต้องผ่านบันไดออเดอร์ + บันไดวันก่อน ──
  // กติกาแม่เอ: "อย่าสเกลเพราะ ROAS สวย แต่เพิ่งขายได้ 2 ออเดอร์"
  // ROAS 5 จากออเดอร์เดียว = ความบังเอิญ ไม่ใช่หลักฐานว่าระบบหาคนซื้อซ้ำได้
  // ⚠️ ต้องเป็น purchasesValued ไม่ใช่ purchases
  // Meta นับ onsite_conversion.purchase เป็น "ซื้อ" แม้มูลค่า ๐ — วัดจริง 3 ส.ค. 69 ปนถึง 57%
  // แอดหนึ่งใช้ ฿6.41 นับ 11 ซื้อ มูลค่า ๐ · ถ้าใช้เลขดิบ บันไดนี้จะเปิดไฟเขียวให้สเกลทั้งที่ไม่มียอด
  const orders = a.purchasesValued;
  if (orders < ORDERS_ANALYZE) {
    const junk = a.purchases - orders;
    return { action: "KEEP", money: 0,
      why: `ROAS ${roas.toFixed(2)} สวย แต่เพิ่งได้ ${orders} ออเดอร์ที่มีมูลค่าจริง — ยังไม่ใช่หลักฐาน`
        + (junk > 0 ? ` (Meta นับ ${a.purchases} แต่ ${junk} ตัวมูลค่า ๐)` : ""),
      how: `ปล่อยงบเท่าเดิมให้ถึง ${ORDERS_ANALYZE} ออเดอร์ก่อน แล้วค่อยดู · ROAS จากออเดอร์ไม่กี่รายการเหวี่ยงง่ายมาก` };
  }

  // ── "แอดติดหลอก" (ebook บทที่ 55): ดี 3 วันยังสอบไม่ผ่าน ──
  // ช่วงแรก AI เก็บ "ลูกค้าร้อน" ที่ตอบสนองง่ายสุดก่อน ตัวเลขเลยสวยผิดปกติ
  // พอวันที่ 4-5 ระบบเริ่มขยายหาคนใหม่ ถ้าคอนเทนต์ไม่แข็งพอ ยอดตกทันที
  // → พ้น 3 วันแตะได้แล้ว แต่ "เพิ่มงบ" ต้องรอให้ยืนระยะครบ 5 วันก่อน
  if (v.activeDays < MIN_DAYS_TO_SCALE) {
    return { action: "KEEP", money: 0,
      why: `ROAS ${roas.toFixed(2)} · ${orders} ออเดอร์ แต่เพิ่งยิงมา ${v.activeDays} วัน`,
      how: `ดี 3 วันยังไม่ใช่หลักฐาน — ระบบเพิ่งเก็บลูกค้าร้อนที่หาง่ายสุด · รอให้ยืนได้ครบ ${MIN_DAYS_TO_SCALE} วันค่อยเพิ่มงบ ระหว่างนี้เตรียมคอนเทนต์ชุดใหม่ไว้` };
  }

  const stable = costIsStable(v);
  const saturated = v.recent.freq >= 2 || v.recent.freq > ctx.avgFreq * 1.4;

  // อิ่มกลุ่ม / ดันงบมาหลายรอบ / เริ่มล้า → แตกตัวใหม่ ดีกว่าดันงบตัวเดิม
  if (saturated || v.bumps >= 2 || fat.score >= 1) {
    const reason = saturated
      ? `กลุ่มเริ่มอิ่ม (คนเห็นซ้ำ ${v.recent.freq.toFixed(2)} ครั้ง)`
      : v.bumps >= 2
        ? "ดันงบมาแล้ว 2 รอบ"
        : `เริ่มมีสัญญาณล้า (${fat.signals[0]})`;
    const enough = orders >= ORDERS_SCALE;
    return { action: "CLONE", money: a.revenue,
      why: `ROAS ${roas.toFixed(2)} · ${orders} ออเดอร์ · ${reason}`,
      how: enough
        ? "โคลนแล้วลดงบ ไปกลุ่มใหม่ (LAL อีก % / ความสนใจอื่น) แทนดันงบตัวเดิม · เช็ค 24 ชม. แพงกว่าตัวแม่ให้ปิด clone"
        : `ยังมีแค่ ${orders} ออเดอร์ — โคลนได้แต่ทีละตัว อย่าแตกรัว รอให้ถึง ${ORDERS_SCALE} ออเดอร์ค่อยแตกเป็นกอง` };
  }

  // เพิ่งดันงบไปแล้วกำไรต่อวันยังไม่โตตาม → อย่าเติมซ้ำ (ต่อให้ ROAS ยังเหนือเส้นสเกล)
  if (scaleFailed) {
    return { action: "KEEP", money: 0,
      why: `ROAS ${roas.toFixed(2)} ยังเหนือเส้นสเกล แต่${scaled.why}`,
      how: "อย่าเติมงบซ้ำ — รอบที่แล้วดันแล้วกำไรต่อวันยังไม่โตตาม · ปล่อยงบเท่านี้ 2-3 วันให้นิ่งก่อน หรือแตกตัวใหม่ไปกลุ่มอื่นแทน" };
  }

  // ต้นทุนยังแกว่ง = ระบบยังไม่นิ่ง → ห้ามเพิ่มงบ (เงื่อนไขที่ 1 ของแม่เอ)
  if (!stable.stable) {
    return { action: "KEEP", money: 0,
      why: `ROAS ${roas.toFixed(2)} · ${orders} ออเดอร์ แต่${stable.why}`,
      how: "รอให้ต้นทุนต่อออเดอร์นิ่งอีก 2-3 วันค่อยเพิ่มงบ · เพิ่มตอนระบบยังไม่นิ่ง learning จะรีเซ็ต" };
  }

  return { action: "SCALE", money: a.revenue - a.spend,
    why: `ROAS ${roas.toFixed(2)} (${label}) · ${orders} ออเดอร์ · ยืนมา ${v.activeDays} วัน · ${stable.why}${scaled.state === "grew" && scaled.passed ? ` · ${scaled.why}` : ""}`,
    how: orders >= ORDERS_SCALE
      ? "เพิ่มงบ +20% แล้วอย่าแตะอีก 2-3 วัน · อยากโตเร็วกว่านี้ให้โคลนเพิ่มแทนการอัดตัวเดิม"
      : `เพิ่มงบ +20% แล้วอย่าแตะอีก 2-3 วัน · ถึง ${ORDERS_SCALE} ออเดอร์ค่อยสเกลจริงจัง` };
}

// ─── 6) สมดุล funnel ทั้งบัญชี ────────────────────────────────────────
export interface FunnelRow {
  stage: Funnel; label: string; spend: number; share: number;
  revenue: number; roas: number; ads: number;
  results: number; replies: number; purchases: number; purchasesValued: number;
  /** ส่วนที่อ่านจาก "ค่าเริ่มต้น" ไม่ได้อ่านจากชื่อ — หลักฐานอ่อนกว่า */
  assumedSpend: number; assumedAds: number;
}

const emptyFunnelAcc = () => ({ spend: 0, revenue: 0, ads: 0, results: 0, replies: 0, purchases: 0, purchasesValued: 0, assumedSpend: 0, assumedAds: 0 });

export function funnelBreakdown(views: AdView[]): { rows: FunnelRow[]; notes: string[] } {
  const acc = new Map<Funnel, ReturnType<typeof emptyFunnelAcc>>();
  for (const s of ["TOF", "MOF", "BOF", "?"] as Funnel[]) acc.set(s, emptyFunnelAcc());
  let total = 0;
  for (const v of views) {
    const a = acc.get(v.funnel)!;
    a.spend += v.all.spend; a.revenue += v.all.revenue; a.ads++;
    a.results += v.all.results; a.replies += v.all.replies;
    a.purchases += v.all.purchases; a.purchasesValued += v.all.purchasesValued;
    if (!v.funnelSure) { a.assumedSpend += v.all.spend; a.assumedAds++; }
    total += v.all.spend;
  }
  const rows: FunnelRow[] = (["TOF", "MOF", "BOF", "?"] as Funnel[])
    .map((stage) => {
      const a = acc.get(stage)!;
      return {
        stage, label: FUNNEL_LABEL[stage], spend: a.spend, share: total ? a.spend / total : 0,
        revenue: a.revenue, roas: a.spend ? a.revenue / a.spend : 0, ads: a.ads,
        results: a.results, replies: a.replies, purchases: a.purchases, purchasesValued: a.purchasesValued,
        assumedSpend: a.assumedSpend, assumedAds: a.assumedAds,
      };
    })
    .filter((r) => r.spend > 0);

  const get = (s: Funnel) => rows.find((r) => r.stage === s)?.share || 0;
  const notes: string[] = [];

  // งบที่ "อ่านจากค่าเริ่มต้น" ไม่ได้อ่านจากชื่อ — ยิ่งเยอะ ยิ่งเชื่อ ROAS รายชั้นได้น้อย
  const assumed = rows.reduce((s, r) => s + r.assumedSpend, 0);
  const assumedShare = total ? assumed / total : 0;
  if (assumedShare > 0.25)
    notes.push(`งบ ${(assumedShare * 100).toFixed(0)}% อยู่ในแอดที่ชื่อไม่บอกกลุ่มเป้าหมาย — ตอนนี้นับเป็น TOF ตามค่าเริ่มต้น (ปล่อยกว้าง) แต่ยังพิสูจน์จากชื่อไม่ได้ · ใส่ AW/LAL/RE180 ในชื่อแล้ว ROAS รายชั้นจะเชื่อได้จริง`);

  const tof = get("TOF"), warm = get("MOF") + get("BOF"), bof = get("BOF");
  if (tof > 0 && tof < 0.35)
    notes.push(`งบหาคนใหม่ (TOF) แค่ ${(tof * 100).toFixed(0)}% — ถังคนอุ่นจะแห้งในไม่กี่สัปดาห์ ควรดันขึ้นราว 40-50%`);
  if (warm > 0 && warm < 0.15)
    notes.push(`งบตามคนอุ่น (MOF+BOF) แค่ ${(warm * 100).toFixed(0)}% — คนที่ทักแล้วไม่ซื้อกำลังหลุดมือฟรี ๆ`);
  if (warm > 0.6)
    notes.push(`งบ ${(warm * 100).toFixed(0)}% ไปกองที่คนอุ่น — กำลังขุดถังเดิมซ้ำ ROAS จะดูดีตอนนี้แต่ตันแน่`);
  if (warm > 0.1 && bof <= 0.02)
    notes.push(`แทบไม่มีชั้น BOF (คนใกล้ซื้อ · RE7-RE60) เลย — คนที่เพิ่งทักเมื่อ 1-2 สัปดาห์ก่อนคือกลุ่มที่ปิดง่ายที่สุดในบ้าน`);

  return { rows, notes };
}

// ─── 6.5) แผง "แอดที่ตั้งชื่อไม่ครบ" ──────────────────────────────────
export interface NamingGap {
  adName: string; accountName: string; product: string;
  spend: number; revenue: number; roas: number;
  suggested: string | null;
  /** แอดชื่อนี้ในบัญชีนี้มีกี่ตัว — เปลี่ยนชื่อทีต้องแก้ครบทุกตัว */
  ads: number;
}

/** เรียงตามงบมากไปน้อย — ทีมเห็นทันทีว่าแก้ตัวไหนก่อนได้ผลที่สุด
 *
 *  ⚠️ ต้องรวมเป็น "1 บรรทัดต่อชื่อ" ไม่ใช่ต่อ ad_id — หลังแก้ ad_id แล้ว
 *  แอดชื่อเดียวกัน 4 ตัวจะกลายเป็น 4 บรรทัดที่เสนอชื่อใหม่เหมือนกันเป๊ะ = อ่านไม่รู้เรื่อง
 *  แต่ตัวเลขยังบวกมาจากรายตัว (spend/revenue ของทุกตัวในชื่อนั้น) */
export function namingGaps(views: AdView[]): { rows: NamingGap[]; spend: number; share: number } {
  const total = views.reduce((s, v) => s + v.all.spend, 0);
  const byName = new Map<string, NamingGap>();
  for (const v of views) {
    if (v.funnelSure || v.all.spend <= 0) continue;
    const k = `${v.accountId}::${v.adName}`;
    const cur = byName.get(k);
    if (cur) {
      cur.spend += v.all.spend;
      cur.revenue += v.all.revenue;
      cur.ads += 1;
    } else {
      byName.set(k, {
        adName: v.adName, accountName: v.accountName, product: v.product,
        spend: v.all.spend, revenue: v.all.revenue, roas: 0,
        suggested: suggestName(v.adName), ads: 1,
      });
    }
  }
  const rows = [...byName.values()]
    .map((r) => ({
      ...r,
      spend: Math.round(r.spend * 100) / 100,
      revenue: Math.round(r.revenue * 100) / 100,
      roas: r.spend ? Math.round((r.revenue / r.spend) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.spend - a.spend);
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  return { rows, spend: Math.round(spend * 100) / 100, share: total ? spend / total : 0 };
}

// ─── 6.6) funnel × สินค้า — เห็นว่าสินค้าไหนขาดชั้นไหน ────────────────
export interface FunnelByProductRow {
  product: string; spend: number; roas: number; purchases: number;
  cells: Record<Funnel, { spend: number; share: number; roas: number; ads: number }>;
  missing: Funnel[]; note: string;
}

export function funnelByProduct(views: AdView[]): FunnelByProductRow[] {
  const byProd = new Map<string, AdView[]>();
  for (const v of views) {
    if (v.all.spend <= 0) continue;
    const list = byProd.get(v.product);
    if (list) list.push(v); else byProd.set(v.product, [v]);
  }
  const stages: Funnel[] = ["TOF", "MOF", "BOF"];
  const out: FunnelByProductRow[] = [];
  for (const [product, list] of byProd) {
    const spend = list.reduce((s, v) => s + v.all.spend, 0);
    const revenue = list.reduce((s, v) => s + v.all.revenue, 0);
    // นับเฉพาะออเดอร์ที่มีมูลค่าจริง — เกณฑ์ "ซื้อครบ 20 ราย ค่อยทำ LAL" ต้องนับคนซื้อจริง
    const purchases = list.reduce((s, v) => s + v.all.purchasesValued, 0);
    const cells = {} as FunnelByProductRow["cells"];
    for (const st of ["TOF", "MOF", "BOF", "?"] as Funnel[]) {
      const g = list.filter((v) => v.funnel === st);
      const gs = g.reduce((s, v) => s + v.all.spend, 0);
      const gr = g.reduce((s, v) => s + v.all.revenue, 0);
      cells[st] = { spend: gs, share: spend ? gs / spend : 0, roas: gs ? gr / gs : 0, ads: g.length };
    }
    const missing = stages.filter((st) => cells[st].spend <= 0);
    const hasLAL = list.some((v) => /LAL/i.test(v.adName));
    const note = missing.length === 0
      ? "ครบทั้ง 3 ชั้น"
      : purchases >= 20 && !hasLAL && missing.includes("TOF")
        ? `ซื้อแล้ว ${purchases} ราย แต่ยังไม่มีท่อหาคนใหม่ — เอา list คนซื้อไปทำ LAL 1-3%`
        : `ยังไม่มีชั้น ${missing.join(" / ")}`;
    out.push({ product, spend, roas: spend ? revenue / spend : 0, purchases, cells, missing, note });
  }
  return out.sort((a, b) => b.spend - a.spend);
}

// ─── 7) สัญญาณคอนเทนต์รายสินค้า ──────────────────────────────────────
export interface ContentSignal {
  product: string; spend: number; roas: number;
  winners: { theme: string; roas: number; spend: number }[]; // มุมที่ยังทำเงิน → ขยี้ต่อ
  dead: { theme: string; roas: number; spend: number }[];    // มุมที่ตายแล้ว
  needNew: boolean; why: string;
}

export function contentSignals(views: AdView[]): ContentSignal[] {
  const byProd = new Map<string, AdView[]>();
  for (const v of views) {
    if (v.all.spend <= 0) continue;
    (byProd.get(v.product) || byProd.set(v.product, []).get(v.product)!).push(v);
  }
  // เกณฑ์ "มุมที่เวิร์ค" ต้องเทียบกับค่าเฉลี่ยของบ้านเอง ไม่ใช่เลขตายตัว
  // ถ้าทั้งบัญชี ROAS 1.27 แล้วไปตั้งบาร์ที่ 2 → ไม่มีมุมไหนผ่านเลย แผงนี้ก็ไร้ประโยชน์
  // สิ่งที่ AE อยากรู้จริง ๆ คือ "ในบ้านเรา มุมไหนดีกว่าค่าเฉลี่ย" แล้วเอาไปทำเพิ่ม
  const houseSpend = views.reduce((s, v) => s + v.all.spend, 0);
  const houseRev = views.reduce((s, v) => s + v.all.revenue, 0);
  const house = houseSpend ? houseRev / houseSpend : 0;
  const winBar = Math.max(ROAS_BREAKEVEN, house * 1.15); // ดีกว่าค่าเฉลี่ยบ้าน 15% ขึ้นไป
  const out: ContentSignal[] = [];
  for (const [product, list] of byProd) {
    const spend = list.reduce((s, v) => s + v.all.spend, 0);
    const revenue = list.reduce((s, v) => s + v.all.revenue, 0);
    if (spend < 500) continue;

    // รวมตามมุมคอนเทนต์
    const byTheme = new Map<string, { spend: number; revenue: number; tired: number; n: number }>();
    for (const v of list) {
      const t = byTheme.get(v.theme) || { spend: 0, revenue: 0, tired: 0, n: 0 };
      t.spend += v.all.spend; t.revenue += v.all.revenue; t.n++;
      if (fatigueOf(v).tired) t.tired++;
      byTheme.set(v.theme, t);
    }
    const themes = [...byTheme.entries()]
      .map(([theme, t]) => ({ theme, spend: t.spend, roas: t.spend ? t.revenue / t.spend : 0, tiredShare: t.n ? t.tired / t.n : 0 }))
      .filter((t) => t.spend > 300)
      .sort((a, b) => b.roas - a.roas);

    const winners = themes.filter((t) => t.roas >= winBar).map(({ theme, roas, spend }) => ({ theme, roas, spend }));
    const dead = themes.filter((t) => t.roas < ROAS_BREAKEVEN).map(({ theme, roas, spend }) => ({ theme, roas, spend }));

    // ต้องยิงคอนเทนต์ใหม่เมื่อ: ไม่มีมุมไหนดีกว่าค่าเฉลี่ยบ้าน หรือ ที่เหลือกำลังล้าเกินครึ่ง
    const tiredAds = list.filter((v) => fatigueOf(v).tired).length;
    const tiredShare = list.length ? tiredAds / list.length : 0;
    // มุม "ทั่วไป" = ชื่อแอดไม่ได้บอกว่าเป็นคอนเทนต์แนวไหน — บอกไม่ได้ว่าอะไรเวิร์ค
    const genericSpend = themes.filter((t) => t.theme === "ทั่วไป").reduce((s, t) => s + t.spend, 0);
    const genericShare = spend ? genericSpend / spend : 0;

    const needNew = winners.length === 0 || tiredShare >= 0.5;
    const why = genericShare >= 0.7
      ? `งบ ${(genericShare * 100).toFixed(0)}% อยู่ในแอดที่ชื่อไม่บอกมุมคอนเทนต์ — ยังชี้ไม่ได้ว่าแนวไหนเวิร์ค ใส่คำอย่าง ดราม่า/รีวิว/ก่อนหลัง/โกดัง ในชื่อก่อน`
      : winners.length === 0
        ? `ไม่มีมุมไหนทำได้ดีกว่าค่าเฉลี่ยบ้าน (${house.toFixed(2)}) — ของเดิมหมดแรงทั้งชุด ต้องยิงแนวใหม่`
        : tiredShare >= 0.5
          ? `${tiredAds} จาก ${list.length} ตัวมีสัญญาณล้า (คนเห็นซ้ำถี่ขึ้นแต่ผลตก) — เตรียมคอนเทนต์ชุดใหม่ไว้`
          : `ยังมี ${winners.length} มุมที่ทำได้ดีกว่าค่าเฉลี่ยบ้าน`;

    out.push({ product, spend, roas: spend ? revenue / spend : 0, winners, dead, needNew, why });
  }
  return out.sort((a, b) => b.spend - a.spend);
}

// ─── 8) ควรทำ LAL / RE เพิ่มไหม ───────────────────────────────────────
export function audienceTodos(views: AdView[]): string[] {
  const todo: string[] = [];
  const byProd = new Map<string, AdView[]>();
  for (const v of views) (byProd.get(v.product) || byProd.set(v.product, []).get(v.product)!).push(v);

  for (const [product, list] of byProd) {
    const spend = list.reduce((s, v) => s + v.all.spend, 0);
    if (spend < 1000) continue;
    // นับเฉพาะออเดอร์ที่มีมูลค่าจริง — เกณฑ์ "ซื้อครบ 20 ราย ค่อยทำ LAL" ต้องนับคนซื้อจริง
    const purchases = list.reduce((s, v) => s + v.all.purchasesValued, 0);
    const replies = list.reduce((s, v) => s + v.all.replies, 0);
    const hasLAL = list.some((v) => /LAL/i.test(v.adName));
    const hasRE = list.some((v) => v.funnel === "MOF" || v.funnel === "BOF");

    if (purchases >= 20 && !hasLAL)
      todo.push(`🧬 ${product} — มีคนซื้อ ${purchases} รายแล้วแต่ยังไม่มีแอด LAL สักตัว · เอา list คนซื้อไปทำ Lookalike 1-3% เป็นท่อคนใหม่ที่ถูกที่สุด`);
    if (replies >= 100 && !hasRE)
      todo.push(`🎯 ${product} — คนกลับมาคุย ${replies} คนแต่ไม่มีแอด retarget เลย · คนกลุ่มนี้อุ่นที่สุดในบ้าน ปล่อยหลุดคือทิ้งเงิน`);
    const conv = replies > 0 ? (purchases / replies) * 100 : 0;
    if (replies >= 80 && conv < 8)
      todo.push(`🎯 ${product} — คุยจริง ${replies} คน ปิดได้แค่ ${conv.toFixed(0)}% · ยิง RE ใส่คนกลุ่มนี้ด้วยรีวิว/ของแถม/รับประกัน แทนที่จะหาคนใหม่เพิ่ม`);
  }
  return todo;
}

// ─── 9) สุขภาพ clone (กติกา 24 ชม.) ───────────────────────────────────
export interface CloneCheck { clone: AdView; parent: AdView; verdict: "kill" | "keep" | "wait"; why: string }

export function cloneChecks(views: AdView[]): CloneCheck[] {
  // key ด้วย accountId ด้วย — ชื่อแอดซ้ำกันข้ามบัญชีมีจริง (ทีมใช้ชื่อชุดเดียวกันหลายบัญชี)
  // ถ้า key ด้วยชื่อเปล่า clone ในบัญชี A จะไปจับคู่กับตัวแม่ในบัญชี B แล้วเทียบต้นทุนผิดคู่
  //
  // ⚠️ หลังแก้ ad_id: ชื่อเดียวกันมีได้หลายตัว (1:1:3) → Map เดิมเก็บได้ตัวเดียว
  //    ตัวไหนมาทีหลังทับตัวก่อน = จับคู่ตัวแม่แบบสุ่มตามลำดับที่วนเจอ
  //    "ตัวแม่" ที่ถูกต้องคือตัวที่ "เกิดก่อน" (clone ถูกสร้างทีหลังเสมอตามนิยาม)
  //    เท่ากัน → เอาตัวที่ใช้เงินมากสุด (ตัวหลักของชุด)
  const byName = new Map<string, AdView>();
  for (const v of views) {
    const k = `${v.accountId}::${v.adName.trim()}`;
    const cur = byName.get(k);
    if (!cur) { byName.set(k, v); continue; }
    const older = v.firstSeen && cur.firstSeen && v.firstSeen !== cur.firstSeen
      ? (v.firstSeen < cur.firstSeen ? v : cur)
      : (v.all.spend > cur.all.spend ? v : cur);
    byName.set(k, older);
  }
  const out: CloneCheck[] = [];
  for (const v of views) {
    if (!v.isClone || !v.parent) continue;
    const p = byName.get(`${v.accountId}::${v.parent}`);
    if (!p) continue;
    if (v.activeDays < 1 || v.all.spend < 150) {
      out.push({ clone: v, parent: p, verdict: "wait", why: `เพิ่งแตกมา ${v.activeDays} วัน (฿${Math.round(v.all.spend)}) — รอครบ 24 ชม. ก่อนตัดสิน` });
      continue;
    }
    const cc = v.all.cpReply || Infinity, pc = p.all.cpReply || Infinity;
    if (isFinite(cc) && isFinite(pc) && cc > pc * 1.5) {
      out.push({ clone: v, parent: p, verdict: "kill",
        why: `ต้นทุนต่อคนตอบ ฿${Math.round(cc)} แพงกว่าตัวแม่ (฿${Math.round(pc)}) ${(cc / pc).toFixed(1)} เท่า — ปิด clone เอางบคืนตัวแม่` });
    } else if (v.all.revenue === 0 && v.all.spend > 500 && p.all.revenue > 0) {
      out.push({ clone: v, parent: p, verdict: "kill", why: `ใช้ ฿${Math.round(v.all.spend)} ยอด ๐ ทั้งที่ตัวแม่ขายได้ — clone ไม่ติด ปิดทิ้ง` });
    } else {
      out.push({ clone: v, parent: p, verdict: "keep",
        why: `ROAS ${v.all.roas.toFixed(2)} vs ตัวแม่ ${p.all.roas.toFixed(2)} — ยังไปได้` });
    }
  }
  return out;
}

// ─── 10) แตกเกินโควตา + แคมเปญแย่งลูกค้ากันเอง ────────────────────────
// ebook แม่เอ บทที่ 50: "1 ต้นฉบับ + โคลน 1-3 ตัว = จุดที่กำลังสวยที่สุด"
//   เกินกว่านั้น Facebook มองว่าสินค้าเดียวกัน คอนเทนต์เดียวกัน กลุ่มเดียวกัน → แย่งกันกินเอง
// ตัวชี้ขาดไม่ใช่ผลรายตัว แต่คือ "ใช้เงินเพิ่มแล้วยอดรวมเพิ่มด้วยไหม"
export const MAX_CLONES_PER_PARENT = 3;

export interface CloneFamily { parent: string; clones: number; spend: number; revenue: number; roas: number; over: boolean }

export function cloneFamilies(views: AdView[]): CloneFamily[] {
  // นับแยกตามบัญชี — ตัวแม่ชื่อเดียวกันคนละบัญชีคือคนละครอบครัว ไม่ควรเอามารวมกัน
  const fam = new Map<string, { parent: string; clones: number; spend: number; revenue: number }>();
  for (const v of views) {
    if (!v.isClone || !v.parent) continue;
    const key = `${v.accountId}::${v.parent}`;
    const f = fam.get(key) || { parent: v.parent, clones: 0, spend: 0, revenue: 0 };
    f.clones++; f.spend += v.all.spend; f.revenue += v.all.revenue;
    fam.set(key, f);
  }
  return [...fam.values()]
    .map((f) => ({
      parent: f.parent, clones: f.clones, spend: f.spend, revenue: f.revenue,
      roas: f.spend ? f.revenue / f.spend : 0, over: f.clones > MAX_CLONES_PER_PARENT,
    }))
    .sort((a, b) => b.clones - a.clones || b.spend - a.spend);
}

/** สินค้าที่ "ใช้เงินเพิ่มแต่ยอดรวมไม่เพิ่ม" = กำลังแบ่งเงินก้อนเดิมออกไปหลายทาง */
export interface Cannibal { product: string; spendBefore: number; spendAfter: number; revBefore: number; revAfter: number; ads: number; why: string }

export function cannibalCheck(views: AdView[]): Cannibal[] {
  const byProd = new Map<string, AdView[]>();
  for (const v of views) {
    if (v.all.spend <= 0) continue;
    const l = byProd.get(v.product);
    if (l) l.push(v); else byProd.set(v.product, [v]);
  }
  const out: Cannibal[] = [];
  for (const [product, list] of byProd) {
    const rD = list.reduce((m, v) => Math.max(m, v.recent.days), 0);
    const pD = list.reduce((m, v) => Math.max(m, v.prior.days), 0);
    if (!rD || !pD) continue;
    const sBefore = list.reduce((s, v) => s + v.prior.spend, 0) / pD;
    const sAfter = list.reduce((s, v) => s + v.recent.spend, 0) / rD;
    const rBefore = list.reduce((s, v) => s + v.prior.revenue, 0) / pD;
    const rAfter = list.reduce((s, v) => s + v.recent.revenue, 0) / rD;
    if (sBefore < 300 || sAfter <= sBefore * 1.2) continue; // ไม่ได้ใช้เงินเพิ่มอย่างมีนัย
    if (rAfter > rBefore * 1.05) continue; // ยอดรวมโตตาม = สเกลจริง
    const B = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
    out.push({
      product, spendBefore: sBefore, spendAfter: sAfter, revBefore: rBefore, revAfter: rAfter,
      ads: list.length,
      why: `ค่าแอด ${B(sBefore)}→${B(sAfter)}/วัน แต่ยอดขาย ${B(rBefore)}→${B(rAfter)}/วัน — ใช้เงินเพิ่มแล้วยอดรวมไม่โต`,
    });
  }
  return out.sort((a, b) => b.spendAfter - a.spendAfter);
}

// ─── 11) สัญญาณระดับกระดาน — "ลากแอด" ก่อนสั่งปิดรัว ──────────────────
// ebook แม่เอ บทที่ 41: ROAS ดิ่งพร้อมกันทั้งกระดานทั้งที่แชทยังเข้าปกติ
//   = ยอดขายยังไม่ถูกดึงกลับเข้าระบบ ไม่ใช่แอดพังทีละตัว
//   ท่าที่ถูกคือ ปิดหยุดเลือด → ระดมปิดการขาย → รอ ROAS ฟื้น → ค่อยเปิด
export interface BoardSignal { wobble: boolean; headline: string; detail: string }

export function boardSignal(views: AdView[]): BoardSignal {
  const sum = (pick: (v: AdView) => Slice) => views.reduce(
    (t, v) => { const s = pick(v); t.spend += s.spend; t.revenue += s.revenue; t.results += s.results; t.replies += s.replies; return t; },
    { spend: 0, revenue: 0, results: 0, replies: 0 }
  );
  const r = sum((v) => v.recent), p = sum((v) => v.prior);
  const rDays = views.reduce((m, v) => Math.max(m, v.recent.days), 0) || 1;
  const pDays = views.reduce((m, v) => Math.max(m, v.prior.days), 0) || 1;
  if (p.spend < 1000 || r.spend < 1000) return { wobble: false, headline: "", detail: "" };

  const roasR = r.spend ? r.revenue / r.spend : 0;
  const roasP = p.spend ? p.revenue / p.spend : 0;
  const repliesR = r.replies / rDays, repliesP = p.replies / pDays;
  // ROAS ทั้งกระดานร่วง >30% แต่คนกลับมาคุยยังไม่ตก = คนยังเข้ามา แต่ยอดไม่เข้าระบบ
  const wobble = roasP > 0 && roasR < roasP * 0.7 && repliesR >= repliesP * 0.85;
  if (!wobble) return { wobble: false, headline: "", detail: "" };
  return {
    wobble: true,
    headline: `ทั้งกระดานร่วงพร้อมกัน — ROAS ${roasP.toFixed(2)} → ${roasR.toFixed(2)} แต่คนกลับมาคุยยังเท่าเดิม (${Math.round(repliesP)}→${Math.round(repliesR)} คน/วัน)`,
    detail: "คนยังเข้ามาปกติ แปลว่ายอดขายน่าจะยังไม่ถูกดึงกลับเข้าระบบ มากกว่าที่แอดจะพังทีละตัว · ทำ \"ลากแอด\" ก่อนสั่งปิดรัว: ปิดตัวที่เลือดไหลแรงสุดหยุดเลือด → ระดมปิดการขาย/ตอบแชทค้าง/โทรยืนยันออเดอร์ → ดูว่า ROAS ฟื้นไหม → ค่อยเปิดกลับ (กู้ได้ใน 1-2 ชม. เปิดงบเดิม · นานกว่านั้นลดงบ 30-50%)",
  };
}

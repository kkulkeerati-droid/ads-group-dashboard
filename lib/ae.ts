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

import { ROAS_SCALE, ROAS_OK, ROAS_BREAKEVEN, MIN_ACTIVE_DAYS, MIN_SPEND_TO_JUDGE } from "./decide";
import { parseProduct, parseTheme, parseAudience } from "./content";
import type { AdRow } from "./types";

// ─── 1) ชั้น funnel — ดูจาก "กลุ่มเป้าหมาย" ในชื่อ ไม่ใช่ objective ────
// objective (ยอดขาย/Buy/msg) บอกว่าตั้งให้ Meta หาอะไร
// แต่ชั้น funnel คือ "ยิงใส่ใคร" — คนละเรื่อง แอดหนึ่งตัวมีได้ทั้งสองอย่าง
export type Funnel = "TOF" | "MOF" | "BOF" | "?";

export const FUNNEL_LABEL: Record<Funnel, string> = {
  TOF: "TOF · คนใหม่",
  MOF: "MOF · คนอุ่น",
  BOF: "BOF · คนใกล้ซื้อ",
  "?": "ยังไม่ระบุกลุ่มในชื่อ",
};

export function classifyFunnel(adName: string): { stage: Funnel; why: string } {
  const n = (adName || "").toUpperCase();

  // retarget — ตัวเลขคือจำนวนวันย้อนหลัง ยิ่งสั้นยิ่งร้อน
  const re = n.match(/\bRE\s?(\d{1,3})\b/);
  if (re) {
    const days = parseInt(re[1], 10);
    return days <= 90
      ? { stage: "BOF", why: `RE${days} — คนที่เพิ่งมีปฏิสัมพันธ์ใน ${days} วัน` }
      : { stage: "MOF", why: `RE${days} — คนอุ่นย้อนหลัง ${days} วัน` };
  }
  if (/\bRERUN\b|\bRE\b/.test(n)) return { stage: "MOF", why: "retarget (ไม่ระบุช่วงวัน)" };

  // prospecting
  if (/\bLAL\b|LAL\s?\d/.test(n)) return { stage: "TOF", why: "Lookalike — คนคล้ายลูกค้า ยังไม่เคยรู้จักเรา" };
  if (/\bAW\b/.test(n)) return { stage: "TOF", why: "Broad / Advantage+ — ปล่อยให้ Meta หาเอง" };
  if (/\bEXALL\b|EX\s?ALL/.test(n)) return { stage: "TOF", why: "ตัดคนที่เคยซื้อออก = ล่าคนใหม่ล้วน" };
  if (/\bENG\b|ส่วนร่วม/.test(n)) return { stage: "TOF", why: "แอดปั้นยอดมีส่วนร่วม — เติมคนเข้าถังบนสุด" };
  if (/\bVIEW\b|วิว/.test(n)) return { stage: "TOF", why: "แอดยอดวิว — เติมคนดูไว้ retarget ทีหลัง" };

  return { stage: "?", why: "ชื่อไม่ได้บอกกลุ่มเป้าหมาย — เดาไม่ได้ว่าอยู่ชั้นไหน" };
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
const CLONE_RE = /\s*[-–]?\s*(สำเนา|copy|clone)\b.*$/i;

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
  impressions: number; reach: number;
  roas: number; cpReply: number; freq: number; days: number;
}

const emptySlice = (): Slice => ({ spend: 0, revenue: 0, results: 0, replies: 0, purchases: 0, impressions: 0, reach: 0, roas: 0, cpReply: 0, freq: 0, days: 0 });

function seal(s: Slice, dayCount: number): Slice {
  s.roas = s.spend > 0 ? s.revenue / s.spend : 0;
  s.cpReply = s.replies > 0 ? s.spend / s.replies : 0;
  s.freq = s.reach > 0 ? s.impressions / s.reach : 0;
  s.days = dayCount;
  return s;
}

export interface AdView {
  adName: string; accountName: string; accountId: string;
  product: string; theme: string; audience: string;
  funnel: Funnel; funnelWhy: string; objective: string;
  isClone: boolean; parent: string | null; bumps: number;
  all: Slice; recent: Slice; prior: Slice;
  firstSeen: string; lastSeen: string; activeDays: number;
}

function addRow(s: Slice, r: AdRow, dates: Set<string>) {
  s.spend += r.spend; s.revenue += r.revenue || 0; s.results += r.results;
  s.replies += r.replies || 0; s.purchases += r.purchases || 0;
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
    const key = `${r.accountId}::${r.adName}`;
    let v = map.get(key) as any;
    if (!v) {
      const f = classifyFunnel(r.adName);
      const c = cloneInfo(r.adName);
      v = {
        adName: r.adName, accountName: r.accountName, accountId: r.accountId,
        product: parseProduct(r.adName), theme: parseTheme(r.adName), audience: parseAudience(r.adName),
        funnel: f.stage, funnelWhy: f.why, objective: classifyObjective(r.adName),
        isClone: c.isClone, parent: c.parent, bumps: budgetBumps(r.adName),
        all: emptySlice(), recent: emptySlice(), prior: emptySlice(),
        firstSeen: r.date || "", lastSeen: r.date || "", activeDays: 0,
        _d: new Set<string>(), _rd: new Set<string>(), _pd: new Set<string>(),
      };
      map.set(key, v);
    }
    addRow(v.all, r, v._d);
    if (r.date) {
      if (r.date < v.firstSeen || !v.firstSeen) v.firstSeen = r.date;
      if (r.date > v.lastSeen) v.lastSeen = r.date;
      if (r.date >= cut) addRow(v.recent, r, v._rd);
      else if (r.date >= priorFrom) addRow(v.prior, r, v._pd);
    }
  }

  return [...map.values()].map((v) => {
    seal(v.all, v._d.size); seal(v.recent, v._rd.size); seal(v.prior, v._pd.size);
    v.activeDays = v._d.size;
    const { _d, _rd, _pd, ...rest } = v as any;
    return rest as AdView;
  });
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

// ─── 5) พรุ่งนี้ทำอะไรกับแอดตัวนี้ ────────────────────────────────────
export type AeAction = "SCALE" | "CLONE" | "KEEP" | "REDUCE" | "STOP" | "NEW_CREATIVE" | "FIX_TRACKING" | "WAIT";

export const ACTION_META: Record<AeAction, { icon: string; label: string; order: number }> = {
  STOP:        { icon: "🔴", label: "หยุด",          order: 1 },
  REDUCE:      { icon: "🟠", label: "ลดงบ",          order: 2 },
  NEW_CREATIVE:{ icon: "🎬", label: "เปลี่ยนคอนเทนต์", order: 3 },
  FIX_TRACKING:{ icon: "⚫", label: "เช็คการนับยอด",   order: 4 },
  CLONE:       { icon: "🧬", label: "แตกตัวใหม่",     order: 5 },
  SCALE:       { icon: "🟢", label: "เพิ่มงบ 20%",    order: 6 },
  KEEP:        { icon: "🔵", label: "ปล่อยไว้",       order: 7 },
  WAIT:        { icon: "⏳", label: "ยังไม่แตะ",      order: 8 },
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
    if (a.results > 0 && a.replies === 0) {
      return { action: "STOP", money: a.spend,
        why: `ทัก ${a.results} คน ไม่มีใครกลับมาตอบสักคน`,
        how: "คนที่ยิงไปเจอไม่ใช่กลุ่มที่สนใจ — ปิด แล้วเอางบไปตัวที่ยังตอบ" };
    }
    return { action: "STOP", money: a.spend,
      why: `ใช้ ${M(a.spend)} ยอดขาย ๐ ทั้งที่ตัวอื่นในกลุ่มขายได้`,
      how: "ปิด — ระบบนับยอดใช้ได้ แปลว่าตัวนี้ขายไม่ออกจริง" };
  }

  const roas = v.recent.spend > 200 ? v.recent.roas : a.roas; // มีข้อมูลสดพอก็ใช้ตัวสด
  const label = v.recent.spend > 200 ? "3 วันล่าสุด" : "ทั้งช่วง";

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

  // ผ่านเส้นสเกลแล้ว → เลือกระหว่างดันงบ กับ แตกตัวใหม่
  const saturated = v.recent.freq >= 2 || v.recent.freq > ctx.avgFreq * 1.4;
  if (saturated || v.bumps >= 2 || fat.score >= 1) {
    const reason = saturated
      ? `กลุ่มเริ่มอิ่ม (คนเห็นซ้ำ ${v.recent.freq.toFixed(2)} ครั้ง)`
      : v.bumps >= 2
        ? "ดันงบมาแล้ว 2 รอบ"
        : `เริ่มมีสัญญาณล้า (${fat.signals[0]})`;
    return { action: "CLONE", money: a.revenue,
      why: `ROAS ${roas.toFixed(2)} ดี แต่${reason}`,
      how: `duplicate ไปกลุ่มใหม่ (LAL อีก % / ความสนใจอื่น) แทนการดันงบตัวเดิม · เช็คผลใน 24 ชม. ถ้าแพงกว่าตัวแม่ให้ปิด clone` };
  }
  return { action: "SCALE", money: a.revenue - a.spend,
    why: `ROAS ${roas.toFixed(2)} (${label}) ผ่านเส้นสเกล ${ROAS_SCALE}`,
    how: "เพิ่มงบ +20% แล้วอย่าแตะอีก 2-3 วัน (แรงกว่านี้ learning รีเซ็ต)" };
}

// ─── 6) สมดุล funnel ทั้งบัญชี ────────────────────────────────────────
export interface FunnelRow { stage: Funnel; label: string; spend: number; share: number; revenue: number; roas: number; ads: number }

export function funnelBreakdown(views: AdView[]): { rows: FunnelRow[]; notes: string[] } {
  const acc = new Map<Funnel, { spend: number; revenue: number; ads: number }>();
  for (const s of ["TOF", "MOF", "BOF", "?"] as Funnel[]) acc.set(s, { spend: 0, revenue: 0, ads: 0 });
  let total = 0;
  for (const v of views) {
    const a = acc.get(v.funnel)!;
    a.spend += v.all.spend; a.revenue += v.all.revenue; a.ads++;
    total += v.all.spend;
  }
  const rows: FunnelRow[] = (["TOF", "MOF", "BOF", "?"] as Funnel[])
    .map((stage) => {
      const a = acc.get(stage)!;
      return { stage, label: FUNNEL_LABEL[stage], spend: a.spend, share: total ? a.spend / total : 0,
        revenue: a.revenue, roas: a.spend ? a.revenue / a.spend : 0, ads: a.ads };
    })
    .filter((r) => r.spend > 0);

  const get = (s: Funnel) => rows.find((r) => r.stage === s)?.share || 0;
  const notes: string[] = [];
  const unknown = get("?");
  if (unknown > 0.25)
    notes.push(`งบ ${(unknown * 100).toFixed(0)}% อยู่ในแอดที่ชื่อไม่บอกกลุ่มเป้าหมาย — อ่าน funnel ไม่ออก ตั้งชื่อให้มี AW/LAL/RE180 จะวิเคราะห์ได้ทันที`);
  const tof = get("TOF"), warm = get("MOF") + get("BOF");
  if (tof > 0 && tof < 0.35)
    notes.push(`งบหาคนใหม่ (TOF) แค่ ${(tof * 100).toFixed(0)}% — ถังคนอุ่นจะแห้งในไม่กี่สัปดาห์ ควรดันขึ้นราว 40-50%`);
  if (warm > 0 && warm < 0.15)
    notes.push(`งบตามคนอุ่น (MOF+BOF) แค่ ${(warm * 100).toFixed(0)}% — คนที่ทักแล้วไม่ซื้อกำลังหลุดมือฟรี ๆ`);
  if (warm > 0.6)
    notes.push(`งบ ${(warm * 100).toFixed(0)}% ไปกองที่คนอุ่น — กำลังขุดถังเดิมซ้ำ ROAS จะดูดีตอนนี้แต่ตันแน่`);
  return { rows, notes };
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
    const purchases = list.reduce((s, v) => s + v.all.purchases, 0);
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
  const byName = new Map<string, AdView>();
  for (const v of views) byName.set(v.adName.trim(), v);
  const out: CloneCheck[] = [];
  for (const v of views) {
    if (!v.isClone || !v.parent) continue;
    const p = byName.get(v.parent);
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

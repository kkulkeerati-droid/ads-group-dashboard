// ─── เครื่องตัดสินใจ: ปิด / สเกล / เฝ้าดู ────────────────────────────
// เกณฑ์เดิมตัดจาก "ค่าทัก (CPR)" อย่างเดียว → หลอกได้
//   เคสจริง 28 ก.ค.–10 ส.ค. 69: All Post ค่าทักถูกสุดในบ้าน ฿13.82
//   แต่ ROAS 0.38 (ใช้ ฿3,689 ได้กลับ ฿1,408) — เกณฑ์เดิมขึ้น 🟢 สเกล = แนะนำผิดทาง
//
// เกณฑ์ใหม่เรียงตาม north star ของ user:
//   1) ROAS            — ตัวตัดสินสูงสุด (ยอดขาย ÷ ค่าแอด)
//   2) มียอดขายไหม     — ใช้เงินไปเยอะแต่ ๐ ยอด = ปิด (ถ้ารู้ว่า tracking ใช้ได้)
//   3) tracking        — ถ้าทั้งกลุ่มไม่มียอดเลย = ยังตัดสินไม่ได้ ต้องไปแก้การวัดผลก่อน
//   4) cpReply         — ต้นทุนต่อ "คนที่กลับมาตอบจริง" (สำรอง ไม่ใช่ค่าทัก)
//   ค่าทัก (cpr) ใช้เป็นข้อมูลประกอบเท่านั้น ไม่ใช้ตัดสินอีกต่อไป

import { parseAudience } from "./content";

export type DecisionCls = "good" | "warn" | "poor" | "bad" | "fix" | "idle";

export interface Decision {
  label: string; // ป้ายที่โชว์ เช่น "🟢 สเกล"
  cls: DecisionCls;
  why: string; // เหตุผลสั้น ๆ พร้อมตัวเลข (โชว์ใน tooltip / แถบแนะนำ)
  basis: "roas" | "no-sale" | "tracking" | "reply" | "low-data" | "engagement";
}

// ตัวเลขขั้นต่ำที่ยอมให้ตัดสิน — ต่ำกว่านี้ยังเป็น learning / ข้อมูลน้อยเกิน
export const MIN_SPEND_TO_JUDGE = 300;

// ─── เส้นแบ่ง ROAS (user กำหนดเอง 10 ส.ค. 69) ────────────────────────
// "ROAS > 3.5 ถึงจะให้ scale ต่ำกว่านี้ถือว่าเริ่มแย่แล้ว"
export const ROAS_SCALE = 3.5; // ≥ นี้ = เพิ่มงบได้
export const ROAS_OK = 2; // 2–3.5 = เริ่มแย่ · ยังไม่ต้องปิด แต่ห้ามเติมงบ
export const ROAS_BREAKEVEN = 1; // < 1 = ขาดทุนตั้งแต่ยังไม่หักต้นทุนสินค้า

// แอดที่ยิงมายังไม่ถึงกี่วัน = ยังอยู่ learning ห้ามแตะ (กติกาบ้าน)
export const MIN_ACTIVE_DAYS = 3;

// ─── "แอดติดหลอก" — ต้องยืนระยะกี่วันถึงเชื่อว่าติดจริง ─────────────────
// จาก ebook แม่เอ บทที่ 55 "3 วันดี วันที่ 4 ตาย":
//   ช่วงแรก AI หากลุ่มที่ตอบสนองง่ายที่สุดก่อน → ตัวเลขสวยผิดปกติ
//   พอ 3-4 วันระบบเริ่มขยายหาคนใหม่ ถ้าคอนเทนต์ไม่แข็งพอ ยอดตกทันที
//   ROAS ดี 3 วัน = ยังสอบไม่ผ่าน · 5-7 วัน = เริ่มเชื่อได้ · 14 วัน = ของจริง
// พ้น 3 วัน (MIN_ACTIVE_DAYS) = แตะได้แล้ว แต่ยัง "เพิ่มงบ" ไม่ได้จนกว่าจะครบ 5 วัน
export const MIN_DAYS_TO_SCALE = 5;

// กติกาแอดมด (ebook บทที่ 34): กินงบเกิน 30% ของงบวันแล้วยังไม่มีการซื้อ = คัดตัวตายออก
export const ANT_KILL_BUDGET_SHARE = 0.3;

export interface DecideInput {
  spend: number;
  results: number; // ทัก
  replies: number; // คนกลับมาตอบจริง (depth_2)
  revenue: number;
  roas: number;
  cpReply: number;
  cpr: number;
  adName?: string;
  activeDays?: number; // จำนวนวันที่มีข้อมูล — น้อยกว่า 3 = ยัง learning
}

export interface DecideCtx {
  kpiRoas: number; // เป้า ROAS (default 2)
  avgCpReply: number; // ต้นทุนต่อคนตอบเฉลี่ยทั้งชุด (ใช้เทียบตอนไม่มียอดขาย)
  /** กลุ่ม/ชุดที่ ad ตัวนี้อยู่ "มียอดขายจากตัวอื่นไหม" — บอกว่า tracking ใช้ได้จริง */
  peerHasRevenue: boolean;
  target?: number; // เป้าค่าทัก (ใช้แค่ประกอบคำอธิบาย)
}

const money = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");

/**
 * ตัดสินใจต่อ 1 ad — คืน null เมื่อไม่ควรแสดงธงเลย (ไม่มี spend)
 *
 * บันไดตัดสิน (หยุดที่ชั้นแรกที่เข้าเงื่อนไข):
 *   0. spend ต่ำเกิน                → ⏳ รอข้อมูล
 *   1. แอด engagement/view          → ไม่ตัดจาก ROAS (คนละวัตถุประสงค์)
 *   2. มี revenue                   → ตัดจาก ROAS
 *   3. ไม่มี revenue + เพื่อนมี      → 🔴 ปิด (tracking ใช้ได้ แต่ตัวนี้ขายไม่ออก)
 *   4. ไม่มี revenue + เพื่อนก็ไม่มี → ⚫ เช็ค tracking (แล้วดู cpReply ประกอบ)
 */
export function decideAd(ad: DecideInput, ctx: DecideCtx): Decision | null {
  const { spend, results, replies, revenue, roas, cpReply } = ad;
  if (spend <= 0) return null;

  // ── 0) ยังตัดสินไม่ได้ — เงินน้อยเกิน หรือเพิ่งเปิดยังไม่พ้น learning ──
  // เคสจริง: clone ที่เพิ่งเกิดเมื่อวาน ใช้ ฿681 ยอด ๐ → เกณฑ์เก่าสั่ง "ปิด"
  // ทั้งที่กติกาบ้านคือแอดอายุ < 3 วันห้ามแตะ (ยอดขายยังตามมาไม่ทัน)
  const days = ad.activeDays;
  if (days !== undefined && days > 0 && days < MIN_ACTIVE_DAYS) {
    return {
      label: "⏳ ยัง learning",
      cls: "idle",
      why: `เพิ่งยิงได้ ${days} วัน (${money(spend)}) — กติกาบ้าน: อายุน้อยกว่า ${MIN_ACTIVE_DAYS} วันห้ามแตะ ยอดขายยังตามมาไม่ทัน`,
      basis: "low-data",
    };
  }
  if (spend < MIN_SPEND_TO_JUDGE) {
    return {
      label: "⏳ รอข้อมูล",
      cls: "idle",
      why: `เพิ่งใช้ ${money(spend)} (ต่ำกว่า ${money(MIN_SPEND_TO_JUDGE)}) — ยังตัดสินไม่ได้ ปล่อยให้พ้น learning ก่อน`,
      basis: "low-data",
    };
  }

  // ── 1) แอดที่ไม่ได้ตั้งมาเพื่อขาย (engagement / view) ──
  // ตัดจาก ROAS ไม่ได้ เพราะ Meta ไม่ได้ optimize ไปหาคนซื้อตั้งแต่แรก
  const aud = ad.adName ? parseAudience(ad.adName) : "";
  const isEngagement = aud === "Engagement" || aud === "View video";
  if (isEngagement && revenue === 0) {
    if (results > 0 && replies === 0) {
      return {
        label: "🔴 ปิด",
        cls: "bad",
        why: `แอด${aud} — ทัก ${results} คน แต่ไม่มีใครกลับมาตอบสักคน (${money(spend)})`,
        basis: "reply",
      };
    }
    return {
      label: "🔵 แอดปั้นยอดมีส่วนร่วม",
      cls: "warn",
      why: `แอด${aud} — ไม่ตัดจาก ROAS (คนละวัตถุประสงค์) · ${money(spend)} · ทัก ${results} · ตอบจริง ${replies}`,
      basis: "engagement",
    };
  }

  // ── 2) มียอดขาย → ROAS ตัดสิน (4 ขั้น) ──
  if (revenue > 0) {
    const roasTxt = `ROAS ${roas.toFixed(2)}`;
    const flow = `${money(spend)} → ${money(revenue)}`;
    if (roas >= ctx.kpiRoas) {
      return {
        label: "🟢 สเกล",
        cls: "good",
        why: `${roasTxt} ผ่านเส้นสเกล ${ctx.kpiRoas} — ${flow} (เหลือหลังค่าแอด ${money(revenue - spend)})`,
        basis: "roas",
      };
    }
    if (roas >= ROAS_OK) {
      return {
        label: "🟡 เริ่มแย่",
        cls: "warn",
        why: `${roasTxt} — ยังไปได้แต่ยังไม่ถึงเส้นสเกล ${ctx.kpiRoas} · อย่าเพิ่งเติมงบ (${flow})`,
        basis: "roas",
      };
    }
    if (roas >= ROAS_BREAKEVEN) {
      return {
        label: "🟠 ลดงบ",
        cls: "poor",
        why: `${roasTxt} — คืนแค่ค่าแอด ยังไม่พอต้นทุนสินค้า/ค่าส่ง (${flow}) · ลดงบแล้วแก้ก่อน`,
        basis: "roas",
      };
    }
    return {
      label: "🔴 ปิด",
      cls: "bad",
      why: `${roasTxt} ขาดทุนตั้งแต่ยังไม่หักต้นทุนสินค้า — ${flow} (ติดลบ ${money(spend - revenue)})`,
      basis: "roas",
    };
  }

  // ── 3) ไม่มียอดขาย แต่ตัวอื่นในกลุ่มเดียวกันมี = ระบบวัดผลใช้ได้ ตัวนี้ขายไม่ออกจริง ──
  if (ctx.peerHasRevenue) {
    const ghost =
      results > 0 && replies === 0
        ? ` · ทัก ${results} คน ไม่มีใครกลับมาตอบเลย`
        : replies > 0
          ? ` · ตอบจริง ${replies} คน (${money(cpReply)}/คน) แต่ไม่ปิดการขาย`
          : "";
    return {
      label: "🔴 ปิด",
      cls: "bad",
      why: `ใช้ ${money(spend)} ยอดขาย ๐ ทั้งที่ตัวอื่นในกลุ่มเดียวกันขายได้ (= ระบบนับยอดใช้ได้)${ghost}`,
      basis: "no-sale",
    };
  }

  // ── 4) ทั้งกลุ่มไม่มียอดเลย = ยังชี้ไม่ได้ว่าขายไม่ออก หรือยอดไม่ถูกส่งกลับเข้าระบบ ──
  const cmp = ctx.avgCpReply > 0 && cpReply > 0 ? cpReply / ctx.avgCpReply : 0;
  const tail = !cpReply
    ? results > 0
      ? ` · ทัก ${results} คน ไม่มีใครกลับมาตอบ`
      : " · ยังไม่มีคนทัก"
    : ` · ต้นทุนต่อคนตอบ ${money(cpReply)} (เฉลี่ยบ้าน ${money(ctx.avgCpReply)}${cmp ? ` = ${cmp >= 1 ? "แพงกว่า" : "ถูกกว่า"} ${Math.abs((cmp - 1) * 100).toFixed(0)}%` : ""})`;
  return {
    label: "⚫ เช็คการนับยอด",
    cls: "fix",
    why: `ใช้ ${money(spend)} แต่ทั้งกลุ่มนี้ไม่มียอดขายเข้าระบบเลย — เช็คก่อนว่าขายไม่ออกจริง หรือปิดการขายนอกระบบ (LINE/โทร) แล้วยอดไม่ถูกส่งกลับ${tail}`,
    basis: "tracking",
  };
}

/** ชุดข้อมูลที่ decideAd ต้องรู้ "ภาพรวม" ก่อนตัดสินรายตัว */
export interface DecideScope {
  kpiRoas: number;
  avgCpReply: number;
  /** key ของกลุ่มที่มียอดขายอย่างน้อย 1 บาท */
  groupsWithRevenue: Set<string>;
}

export function buildScope(
  ads: { group: string; revenue: number }[],
  totals: { cpReply: number },
  kpiRoas = ROAS_SCALE
): DecideScope {
  const groupsWithRevenue = new Set<string>();
  for (const a of ads) if (a.revenue > 0) groupsWithRevenue.add(a.group);
  return { kpiRoas, avgCpReply: totals.cpReply || 0, groupsWithRevenue };
}

/** เรียงความสำคัญของสิ่งที่ต้องลงมือ — เงินที่กำลังไหลออกมาก่อน */
export function actionWeight(d: Decision, spend: number, revenue: number): number {
  if (d.cls === "bad") return spend - revenue; // ติดลบเยอะสุด = เร่งสุด
  if (d.cls === "poor") return (spend - revenue) * 0.6; // คืนแค่ค่าแอด — รองลงมา
  if (d.cls === "fix") return spend * 0.5;
  return 0;
}

/** ธงที่ต้องลงมือทำอะไรสักอย่าง (ใช้กรองในแถบแนะนำ / ข้อความ Telegram) */
export const NEEDS_ACTION: DecisionCls[] = ["bad", "poor", "fix"];

// ─── แปลง Digest เป็นข้อความสำหรับ LINE ──────────────────────────────
// LINE Messaging API: ข้อความละไม่เกิน 5,000 ตัวอักษร · push ได้ครั้งละ 5 ข้อความ
// เขียนให้อ่านจบบนมือถือ: บรรทัดแรก = สิ่งที่ต้องทำ 1 อย่าง แล้วค่อยไล่รายละเอียด

import type { Digest } from "./digest";

const LINE_MAX_CHARS = 4800; // เผื่อจาก 5,000
export const LINE_MAX_MESSAGES = 5;

const money = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** 2026-08-04 → "4 ส.ค. 69" (พ.ศ. 2 หลัก) */
function thDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = `${d} ${TH_MONTHS[m - 1]}`;
  return withYear ? `${base} ${String(y + 543).slice(-2)}` : base;
}

function delta(cur: number, prev: number, lowerBetter = false): string {
  if (!prev) return "";
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 1) return " (เท่าเดิม)";
  const up = p > 0;
  const good = lowerBetter ? !up : up;
  return ` (${good ? "▲" : "▼"}${Math.abs(p).toFixed(0)}%)`;
}

const TONE_ICON: Record<string, string> = { good: "🟢", bad: "🔴", warn: "🟡", info: "•" };

function section(title: string, items: { text: string; tone: string }[], limit = 6): string {
  if (!items.length) return "";
  const lines = items.slice(0, limit).map((i) => `${TONE_ICON[i.tone] || "•"} ${i.text}`);
  if (items.length > limit) lines.push(`… อีก ${items.length - limit} ข้อ (ดูบนเว็บ)`);
  return `${title}\n${lines.join("\n")}`;
}

export interface LineTextOpts {
  dashboardUrl?: string;
  /** ลิงก์เปิดอ่านฉบับเต็มโดยไม่ต้องกรอกรหัส (?share=<sig>) */
  shareUrl?: string;
}

/**
 * คืน array ของข้อความพร้อม push (สูงสุด 5 ก้อน)
 * ก้อน 1 = สิ่งที่ต้องทำ + ตัวเลขรวม + KPI  ← อ่านแค่ก้อนนี้ก็ตัดสินใจได้
 * ก้อน 2 = ได้ผล / ไม่ได้ผล รายสินค้า
 * ก้อน 3 = เรียนรู้ + จะปรับ
 * ก้อน 4 = suggest แบรนด์ + ลิงก์
 */
export function digestToLineMessages(d: Digest, opts: LineTextOpts = {}): string[] {
  const t = d.totals;
  const p = d.prevTotals;
  const range = `${thDate(d.since)}–${thDate(d.until, true)}`;
  const prevRange = `${thDate(d.prevSince)}–${thDate(d.prevUntil)}`;

  // ── ก้อน 1: หัวเรื่อง + ตัวเลข + KPI ──
  const kpiLines = d.kpiStatus.map((k) => {
    const val = k.unit === "%" ? `${k.actual.toFixed(0)}%` : k.actual.toFixed(2);
    const tgt = k.unit === "%" ? `${k.target}%` : String(k.target);
    return `${k.hit ? "✅" : "❌"} ${k.label} ${val} / เป้า ${tgt}`;
  });

  const head = [
    `📅 สรุปสัปดาห์ ${range}`,
    `เทียบกับ ${prevRange}`,
    "",
    `👉 ${d.headline}`,
    "",
    "━━━━━━━━━━━━━━",
    "💰 ตัวเลขรวม",
    `ค่าแอด ${money(t.spend)}${delta(t.spend, p.spend)}`,
    `ยอดขาย ${money(t.revenue)}${delta(t.revenue, p.revenue)}`,
    `ROAS ${t.roas.toFixed(2)}${delta(t.roas, p.roas)}`,
    `กำไรหลังค่าแอด ${money(t.revenue - t.spend)}`,
    "",
    `ทัก ${t.results.toLocaleString("th-TH")} → ตอบจริง ${t.replies.toLocaleString("th-TH")} (${t.replyRate.toFixed(0)}%)`,
    `แชทผี ${(100 - t.replyRate).toFixed(0)}% · ต้นทุนต่อคนที่คุยด้วยจริง ${money(t.cpReply)}${delta(t.cpReply, p.cpReply, true)}`,
    `ออเดอร์ ${t.purchases} · ปิดการขาย ${t.convRate.toFixed(1)}% · basket ${money(t.basket)}`,
    "",
    "🎯 KPI",
    ...kpiLines,
  ].join("\n");

  // ── ก้อน 2: ได้ผล / ไม่ได้ผล ──
  const body2 = [section("✅ ได้ผล", d.worked, 5), section("⚠️ ไม่ได้ผล", d.didntWork, 6)]
    .filter(Boolean)
    .join("\n\n");

  // ── ก้อน 3: เรียนรู้ + จะปรับ ──
  const body3 = [section("🧠 สิ่งที่เรียนรู้", d.learned, 5), section("🔧 สิ่งที่จะปรับ (สั่งได้เลย)", d.willAdjust, 6)]
    .filter(Boolean)
    .join("\n\n");

  // ── ก้อน 4: แบรนด์ + สิ่งที่ทำไปแล้ว + ลิงก์ ──
  const link = opts.shareUrl || opts.dashboardUrl;
  const body4 = [
    section("🏷️ ฝากแบรนด์ (แอดแก้เองไม่ได้)", d.brandSuggest, 5),
    section("📋 สัปดาห์นี้ทำอะไรไป", d.didThisWeek, 5),
    link ? `🔗 ดูฉบับเต็ม\n${link}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [head, body2, body3, body4]
    .filter((s) => s.trim().length > 0)
    .slice(0, LINE_MAX_MESSAGES)
    .map((s) => (s.length > LINE_MAX_CHARS ? s.slice(0, LINE_MAX_CHARS - 1) + "…" : s));
}

// ─── สรุปรายวันเข้า Telegram ─────────────────────────────────────────
// หลักคิด: **รายงาน "เมื่อวาน" แต่ตัดสินใจจาก "7 วันล่าสุด"**
//   ข้อมูลวันเดียวเหวี่ยงเกินจะสั่งปิด/สเกล (เสาร์-อาทิตย์ไม่เหมือนวันธรรมดา
//   + ออเดอร์บางส่วนมาทีหลัง) แต่คนอ่านอยากรู้ว่าเมื่อวานเป็นยังไง
//   → เลยเอาตัวเลขเมื่อวานมาโชว์ แล้วเอาธงจาก 7 วันมาสั่งงาน

import { decideAd, buildScope, actionWeight, ROAS_SCALE, ROAS_OK, ROAS_BREAKEVEN } from "./decide";
import type { Metrics } from "./types";

export const TELEGRAM_MAX_CHARS = 3900; // ลิมิตจริง 4096 — เผื่อไว้

const money = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];

function thDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = TH_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${d} ${TH_MONTHS[m - 1]}`;
}

// escape ให้ปลอดภัยกับ parse_mode=HTML ของ Telegram (ชื่อแอดมี & < > ได้)
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cmp(cur: number, base: number, lowerBetter = false): string {
  if (!base) return "";
  const p = ((cur - base) / base) * 100;
  if (Math.abs(p) < 5) return " (พอ ๆ กับค่าเฉลี่ย)";
  const up = p > 0;
  const good = lowerBetter ? !up : up;
  return ` (${good ? "▲" : "▼"}${Math.abs(p).toFixed(0)}% จากเฉลี่ย 7 วัน)`;
}

/**
 * สร้างข้อความรายวัน
 * @param day    ตัวเลขของ "เมื่อวาน" วันเดียว
 * @param week   7 วันล่าสุด (ใช้ตัดสินใจ + เป็นฐานเทียบ)
 * @param link   ลิงก์เปิด dashboard
 */
export function buildDailyMessage(day: Metrics, week: Metrics, link?: string): string {
  const scope = buildScope(
    week.groups.map((g) => ({ group: String(g.key), revenue: g.revenue })),
    { cpReply: week.cpReply },
    ROAS_SCALE
  );
  const rated = week.topAds
    .map((a) => ({ a, dec: decideAd({ ...a, adName: a.adName }, { kpiRoas: ROAS_SCALE, avgCpReply: week.cpReply, peerHasRevenue: scope.groupsWithRevenue.has(a.group) }) }))
    .filter((r) => r.dec);

  const kill = rated
    .filter((r) => r.dec!.cls === "bad" || r.dec!.cls === "poor")
    .sort((x, y) => actionWeight(y.dec!, y.a.spend, y.a.revenue) - actionWeight(x.dec!, x.a.spend, x.a.revenue))
    .slice(0, 4);
  const scale = rated.filter((r) => r.dec!.cls === "good").sort((x, y) => y.a.roas - x.a.roas).slice(0, 3);
  const fix = rated.filter((r) => r.dec!.cls === "fix").sort((x, y) => y.a.spend - x.a.spend).slice(0, 2);

  // ค่าเฉลี่ยต่อวันของ 7 วัน — ฐานเทียบที่นิ่งกว่าเทียบกับ "เมื่อวานซืน"
  const per = (n: number) => n / 7;
  const dayProfit = day.revenue - day.spend;

  const L: string[] = [];
  L.push(`<b>☀️ สรุปเมื่อวาน · ${thDay(day.since)}</b>`);
  L.push("");

  if (day.spend <= 0) {
    L.push("ไม่มีการใช้จ่ายเมื่อวาน — ทุกแอดหยุดหมด หรือข้อมูลยังไม่เข้า");
  } else {
    L.push(`ค่าแอด <b>${money(day.spend)}</b>${cmp(day.spend, per(week.spend))}`);
    L.push(`ยอดขาย <b>${money(day.revenue)}</b>${cmp(day.revenue, per(week.revenue))}`);
    L.push(`ROAS <b>${day.roas.toFixed(2)}</b> · เหลือหลังค่าแอด <b>${money(dayProfit)}</b>`);
    L.push("");
    L.push(`ทัก ${day.results} → ตอบจริง <b>${day.replies}</b> (${day.replyRate.toFixed(0)}%)`);
    L.push(`฿/คนที่คุยด้วยจริง ${money(day.cpReply)}${cmp(day.cpReply, week.cpReply, true)}`);
    L.push(`ออเดอร์ ${day.purchases} · ปิดการขาย ${day.convRate.toFixed(1)}%`);
  }

  L.push("");
  L.push(`<b>📊 7 วันล่าสุด</b> (ใช้ตัดสินใจ)`);
  L.push(`${money(week.spend)} → ${money(week.revenue)} · ROAS <b>${week.roas.toFixed(2)}</b> ${week.roas >= ROAS_SCALE ? "✅" : `❌ (เส้นสเกล ${ROAS_SCALE})`}`);

  if (kill.length) {
    L.push("");
    L.push("<b>🔴 ต้องจัดการวันนี้</b>");
    for (const { a, dec } of kill) {
      L.push(`${dec!.label} <b>${esc(a.adName || "(ไม่มีชื่อ)")}</b> <i>@${esc(a.accountName)}</i>`);
      L.push(`   ${money(a.spend)} → ${money(a.revenue)} · ROAS ${a.roas ? a.roas.toFixed(2) : "0.00"}`);
    }
    const bleed = kill.reduce((s, r) => s + (r.a.spend - r.a.revenue), 0);
    if (bleed > 0) L.push(`   <i>รวมติดลบ ${money(bleed)} ใน 7 วัน</i>`);
  }

  if (scale.length) {
    L.push("");
    L.push(`<b>🟢 เพิ่มงบได้ (ROAS ≥ ${ROAS_SCALE})</b>`);
    for (const { a } of scale) {
      L.push(`🟢 <b>${esc(a.adName || "(ไม่มีชื่อ)")}</b> <i>@${esc(a.accountName)}</i>`);
      L.push(`   ROAS ${a.roas.toFixed(2)} · ${money(a.spend)} → ${money(a.revenue)} · +20% ได้`);
    }
  } else {
    L.push("");
    L.push(`<b>🟢 เพิ่มงบได้</b> — ไม่มี (ยังไม่มีตัวไหนถึง ROAS ${ROAS_SCALE})`);
  }

  if (fix.length) {
    L.push("");
    L.push("<b>⚫ เช็คการนับยอด</b>");
    for (const { a } of fix) L.push(`⚫ ${esc(a.adName)} — ใช้ ${money(a.spend)} ยังไม่มียอดเข้าระบบ`);
  }

  if (link) {
    L.push("");
    L.push(`<a href="${link}">เปิด dashboard →</a>`);
  }

  const out = L.join("\n");
  return out.length > TELEGRAM_MAX_CHARS ? out.slice(0, TELEGRAM_MAX_CHARS - 1) + "…" : out;
}

/** สรุปสัปดาห์แบบย่อ — ส่งเพิ่มเฉพาะวันจันทร์ */
export function buildWeeklyMessage(d: {
  since: string; until: string; headline: string;
  totals: { spend: number; revenue: number; roas: number; results: number; replies: number; replyRate: number; cpReply: number; purchases: number; convRate: number; basket: number };
  kpiStatus: { label: string; actual: number; target: number; unit: string; hit: boolean }[];
  worked: { text: string }[]; didntWork: { text: string }[];
  learned: { text: string }[]; willAdjust: { text: string }[]; brandSuggest: { text: string }[];
}, link?: string): string {
  const t = d.totals;
  const L: string[] = [];
  L.push(`<b>📅 สรุปสัปดาห์ที่ผ่านมา</b>`);
  L.push(`${d.since} – ${d.until}`);
  L.push("");
  L.push(`👉 <b>${esc(d.headline)}</b>`);
  L.push("");
  L.push(`${money(t.spend)} → ${money(t.revenue)} · ROAS <b>${t.roas.toFixed(2)}</b>`);
  L.push(`ทัก ${t.results} → ตอบจริง ${t.replies} (${t.replyRate.toFixed(0)}%) · ฿/คนตอบ ${money(t.cpReply)}`);
  L.push(`ออเดอร์ ${t.purchases} · ปิด ${t.convRate.toFixed(1)}% · basket ${money(t.basket)}`);
  L.push("");
  L.push("<b>🎯 KPI</b>");
  for (const k of d.kpiStatus) {
    const v = k.unit === "%" ? `${k.actual.toFixed(0)}%` : k.actual.toFixed(2);
    const g = k.unit === "%" ? `${k.target}%` : String(k.target);
    L.push(`${k.hit ? "✅" : "❌"} ${k.label} ${v} / ${g}`);
  }
  const sec = (title: string, items: { text: string }[], n = 4) => {
    if (!items.length) return;
    L.push("");
    L.push(`<b>${title}</b>`);
    for (const i of items.slice(0, n)) L.push(`• ${esc(i.text)}`);
    if (items.length > n) L.push(`<i>… อีก ${items.length - n} ข้อ</i>`);
  };
  sec("✅ ได้ผล", d.worked, 3);
  sec("⚠️ ไม่ได้ผล", d.didntWork, 4);
  sec("🧠 เรียนรู้", d.learned, 3);
  sec("🔧 จะปรับ", d.willAdjust, 4);
  sec("🏷️ ฝากแบรนด์", d.brandSuggest, 3);
  if (link) { L.push(""); L.push(`<a href="${link}">อ่านฉบับเต็ม →</a>`); }
  const out = L.join("\n");
  return out.length > TELEGRAM_MAX_CHARS ? out.slice(0, TELEGRAM_MAX_CHARS - 1) + "…" : out;
}

export { ROAS_SCALE, ROAS_OK, ROAS_BREAKEVEN };

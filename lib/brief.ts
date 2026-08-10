// ─── สรุป 17:00 — "วันนี้เป็นไง พรุ่งนี้ทำอะไร" ──────────────────────
//
// ⚠️ กติกาข้อสำคัญที่สุดของไฟล์นี้:
//    ตอน 17:00 วันยังไม่จบ และ "ยอดขายมาช้ากว่าค่าแอดเสมอ"
//    (คนทักตอนเย็น ปิดการขายตอนดึก บางออเดอร์เข้าพรุ่งนี้)
//    → ตัวเลขวันนี้เอาไว้ "ดูจังหวะ" เท่านั้น
//    → ทุกคำสั่ง scale/หยุด/clone ตัดจาก 7 วันล่าสุด ไม่ใช่จากวันนี้
//    ถ้าเอา ROAS ตอนบ่ายมาสั่งปิด จะปิดตัวที่กำลังจะทำเงินตอนกลางคืนทิ้ง

import {
  buildAdViews, callFor, fatigueOf, funnelBreakdown, funnelByProduct, namingGaps,
  contentSignals, audienceTodos, cloneChecks, cloneFamilies, cannibalCheck, boardSignal,
  ACTION_META, FUNNEL_LABEL, MAX_CLONES_PER_PARENT,
  type AdView, type AeAction, type AeCall, type FunnelRow, type FunnelByProductRow,
  type NamingGap, type ContentSignal, type CloneCheck, type CloneFamily, type Cannibal, type BoardSignal,
} from "./ae";
import { ROAS_SCALE } from "./decide";
import type { AdRow } from "./types";

export interface BriefItem {
  action: AeAction; icon: string; label: string;
  adName: string; accountName: string; product: string; funnel: string;
  spend: number; revenue: number; roas: number; replies: number;
  roasRecent: number | null; // ROAS 3 วันล่าสุด (null = ข้อมูลไม่พอ) — ต่างจาก roas ทั้งช่วงคือสัญญาณเทรนด์
  why: string; how: string; money: number;
}

export interface Brief {
  date: string; generatedAt: string; dayComplete: boolean;
  today: { spend: number; revenue: number; roas: number; results: number; replies: number; replyRate: number; purchases: number; cpReply: number };
  avg7: { spend: number; revenue: number; roas: number; results: number; replies: number; cpReply: number };
  week: { since: string; until: string; spend: number; revenue: number; roas: number; results: number; replies: number; replyRate: number; purchases: number; convRate: number; cpReply: number };
  headline: string;
  items: BriefItem[];
  moneySaved: number;   // เงินที่หยุดไหลออกถ้าทำตาม "หยุด/ลดงบ"
  moneyUpside: number;  // กำไรหลังค่าแอดของตัวที่สั่งเพิ่มงบ
  funnel: { rows: FunnelRow[]; notes: string[] };
  funnelByProduct: FunnelByProductRow[];
  content: ContentSignal[];
  audience: string[];
  clones: { adName: string; parent: string; verdict: string; why: string }[];
  cloneFamilies: CloneFamily[];   // ตัวแม่ที่แตกเกิน 3 ตัว
  cannibal: Cannibal[];           // สินค้าที่ใช้เงินเพิ่มแต่ยอดรวมไม่โต
  board: BoardSignal;             // ทั้งกระดานร่วงพร้อมกัน → ลากแอดก่อนปิดรัว
  unnamed: { count: number; spend: number; share: number; rows: NamingGap[] };
  churn: { stopped: number; spend: number; wasted: number }; // แอดที่หยุดไปแล้วในช่วงนี้
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function agg(rows: AdRow[]) {
  const t = { spend: 0, revenue: 0, results: 0, replies: 0, purchases: 0 };
  for (const r of rows) {
    t.spend += r.spend; t.revenue += r.revenue || 0; t.results += r.results;
    t.replies += r.replies || 0; t.purchases += r.purchases || 0;
  }
  return {
    ...t,
    roas: t.spend ? r2(t.revenue / t.spend) : 0,
    replyRate: t.results ? r2((t.replies / t.results) * 100) : 0,
    convRate: t.results ? r2((t.purchases / t.results) * 100) : 0,
    cpReply: t.replies ? r2(t.spend / t.replies) : 0,
  };
}

/**
 * @param todayRows  แถวของ "วันนี้" (อาจยังไม่จบวัน)
 * @param weekRows   แถวของ 7 วันล่าสุดที่ "จบวันแล้ว" (เมื่อวานย้อนไป 7 วัน) — ใช้ตัดสินใจ
 */
export function buildBrief(opts: {
  date: string; todayRows: AdRow[]; weekRows: AdRow[]; weekSince: string; weekUntil: string;
  dayComplete?: boolean; nowISO?: string;
}): Brief {
  const { date, todayRows, weekRows, weekSince, weekUntil } = opts;
  const today = agg(todayRows);
  const week = agg(weekRows);
  const avg7 = {
    spend: r2(week.spend / 7), revenue: r2(week.revenue / 7), roas: week.roas,
    results: Math.round(week.results / 7), replies: Math.round(week.replies / 7), cpReply: week.cpReply,
  };

  // ── ตัดสินใจจาก 7 วัน ไม่ใช่จากวันนี้ ──
  const views = buildAdViews(weekRows, weekUntil, 3, 4);
  const withSpend = views.filter((v) => v.all.spend > 0);

  // กลุ่มไหนมียอดขาย (ไว้แยก "ขายไม่ออก" ออกจาก "ยอดไม่เข้าระบบ")
  const prodRevenue = new Map<string, number>();
  for (const v of withSpend) prodRevenue.set(v.product, (prodRevenue.get(v.product) || 0) + v.all.revenue);
  const avgFreq = (() => {
    const imp = withSpend.reduce((s, v) => s + v.all.impressions, 0);
    const rch = withSpend.reduce((s, v) => s + v.all.reach, 0);
    return rch ? imp / rch : 1;
  })();

  const items: BriefItem[] = [];
  for (const v of withSpend) {
    const call = callFor(v, { peerHasRevenue: (prodRevenue.get(v.product) || 0) > 0, avgFreq, windowStart: weekSince, windowEnd: weekUntil });
    if (!call) continue;
    const m = ACTION_META[call.action];
    items.push({
      action: call.action, icon: m.icon, label: m.label,
      adName: v.adName, accountName: v.accountName, product: v.product,
      funnel: FUNNEL_LABEL[v.funnel],
      spend: r2(v.all.spend), revenue: r2(v.all.revenue), roas: r2(v.all.roas), replies: v.all.replies,
      roasRecent: v.recent.spend > 200 ? r2(v.recent.roas) : null,
      why: call.why, how: call.how, money: r2(call.money),
    });
  }
  // เรียง: เรื่องด่วน (หยุด/ลดงบ) ก่อน แล้วภายในกลุ่มเรียงตามเงิน
  items.sort((a, b) => ACTION_META[a.action].order - ACTION_META[b.action].order || b.money - a.money);

  const moneySaved = items.filter((i) => i.action === "STOP" || i.action === "REDUCE").reduce((s, i) => s + Math.max(0, i.money), 0);
  const moneyUpside = items.filter((i) => i.action === "SCALE").reduce((s, i) => s + Math.max(0, i.money), 0);

  const funnel = funnelBreakdown(withSpend);
  const byProduct = funnelByProduct(withSpend);
  const content = contentSignals(withSpend);
  const audience = audienceTodos(withSpend);
  const clones = cloneChecks(withSpend)
    .filter((c) => c.verdict !== "keep")
    .map((c) => ({ adName: c.clone.adName, parent: c.parent.adName, verdict: c.verdict, why: c.why }));
  const families = cloneFamilies(withSpend).filter((f) => f.over);
  const cannibal = cannibalCheck(withSpend);
  const board = boardSignal(withSpend);
  const gaps = namingGaps(withSpend);
  const unnamed = { count: gaps.rows.length, spend: gaps.spend, share: r2(gaps.share), rows: gaps.rows };

  // แอดที่หยุดไปแล้วในช่วง 7 วัน — เยอะผิดปกติ = เปิด-ปิดถี่เกิน ไม่มีตัวไหนได้พ้น learning
  const stoppedList = withSpend.filter((v) => v.lastSeen < weekUntil);
  const churn = {
    stopped: stoppedList.length,
    spend: r2(stoppedList.reduce((s, v) => s + v.all.spend, 0)),
    wasted: r2(stoppedList.filter((v) => v.all.revenue === 0).reduce((s, v) => s + v.all.spend, 0)),
  };

  // ── หัวเรื่อง: สิ่งเดียวที่ต้องทำก่อนเพื่อน ──
  const M = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
  const stops = items.filter((i) => i.action === "STOP");
  const scales = items.filter((i) => i.action === "SCALE");
  const clonesTodo = items.filter((i) => i.action === "CLONE");
  // ทั้งกระดานร่วงพร้อมกันแต่คนยังคุยเท่าเดิม = เรื่องระบบ/ยอดยังไม่เข้า มาก่อนทุกคำสั่งรายตัว
  const headline = board.wobble
    ? `ทำ "ลากแอด" ก่อน — ${board.headline}`
    : stops.length
    ? `พรุ่งนี้เช้าปิด ${stops.length} ตัวก่อน — หยุดเงินไหลออก ${M(moneySaved)}${scales.length ? ` แล้วเอางบไป ${scales[0].adName}` : ""}`
    : scales.length
      ? `พรุ่งนี้ดันงบ ${scales.length} ตัวที่ ROAS ผ่าน ${ROAS_SCALE} (+20% ต่อตัว)`
      : clonesTodo.length
        ? `ตัวชนะเริ่มอิ่มกลุ่ม — แตก ${clonesTodo.length} ตัวไปกลุ่มใหม่แทนการดันงบ`
        : `ยังไม่มีตัวไหนถึงเส้นสเกล ${ROAS_SCALE} — พรุ่งนี้โฟกัสแก้คอนเทนต์/คุณภาพแชท อย่าเพิ่งเติมงบ`;

  return {
    date, generatedAt: opts.nowISO || "", dayComplete: opts.dayComplete ?? false,
    today: { spend: r2(today.spend), revenue: r2(today.revenue), roas: today.roas, results: today.results,
             replies: today.replies, replyRate: today.replyRate, purchases: today.purchases, cpReply: today.cpReply },
    avg7,
    week: { since: weekSince, until: weekUntil, spend: r2(week.spend), revenue: r2(week.revenue), roas: week.roas,
            results: week.results, replies: week.replies, replyRate: week.replyRate, purchases: week.purchases,
            convRate: week.convRate, cpReply: week.cpReply },
    headline, items, moneySaved: r2(moneySaved), moneyUpside: r2(moneyUpside),
    funnel, funnelByProduct: byProduct, content, audience,
    clones, cloneFamilies: families, cannibal, board, unnamed, churn,
  };
}

// ─── ข้อความ Telegram (สั้น อ่านจบบนมือถือ) ───────────────────────────
const money = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function delta(cur: number, base: number, lowerBetter = false): string {
  if (!base) return "";
  const p = ((cur - base) / base) * 100;
  if (Math.abs(p) < 8) return " (พอ ๆ กับปกติ)";
  const good = lowerBetter ? p < 0 : p > 0;
  return ` (${good ? "▲" : "▼"}${Math.abs(p).toFixed(0)}% จากค่าเฉลี่ย)`;
}

export function briefToTelegram(b: Brief, link?: string): string {
  const L: string[] = [];
  L.push(`<b>📋 สรุปบ่าย ${b.date} · แผนพรุ่งนี้</b>`);
  L.push("");
  L.push(`👉 <b>${esc(b.headline)}</b>`);
  if (b.board.wobble) L.push(`<i>${esc(b.board.detail)}</i>`);
  L.push("");

  L.push(`<b>วันนี้ถึงตอนนี้</b>${b.dayComplete ? "" : " <i>(ยังไม่จบวัน)</i>"}`);
  if (b.today.spend <= 0) {
    L.push("ยังไม่มีค่าใช้จ่ายเข้าระบบวันนี้");
  } else {
    L.push(`ค่าแอด ${money(b.today.spend)}${delta(b.today.spend, b.avg7.spend)}`);
    L.push(`ทัก ${b.today.results} → ตอบจริง <b>${b.today.replies}</b> (${b.today.replyRate.toFixed(0)}%)`);
    L.push(`ยอดที่เข้าระบบแล้ว ${money(b.today.revenue)} · ออเดอร์ ${b.today.purchases}`);
    if (!b.dayComplete) L.push(`<i>ยอดขายมาช้ากว่าค่าแอดเสมอ — เลขนี้จะขยับขึ้นอีกคืนนี้ อย่าเพิ่งตัดสินจากตรงนี้</i>`);
  }
  L.push("");
  L.push(`<b>ฐานตัดสินใจ · 7 วัน</b> (${b.week.since}–${b.week.until})`);
  L.push(`${money(b.week.spend)} → ${money(b.week.revenue)} · ROAS <b>${b.week.roas.toFixed(2)}</b> ${b.week.roas >= ROAS_SCALE ? "✅" : `❌ เส้นสเกล ${ROAS_SCALE}`}`);
  L.push(`ตอบจริง ${b.week.replies}/${b.week.results} (${b.week.replyRate.toFixed(0)}%) · ปิด ${b.week.convRate.toFixed(1)}%`);

  // สั่งงานรายตัว — โชว์เฉพาะกลุ่มที่ต้องลงมือ
  const groups: [AeAction, number][] = [["STOP", 4], ["REDUCE", 3], ["NEW_CREATIVE", 3], ["FIX_OFFER", 3], ["CLONE", 2], ["SCALE", 3], ["FIX_TRACKING", 2]];
  for (const [act, cap] of groups) {
    const g = b.items.filter((i) => i.action === act);
    if (!g.length) continue;
    const m = ACTION_META[act];
    L.push("");
    L.push(`<b>${m.icon} ${m.label} (${g.length})</b>`);
    for (const i of g.slice(0, cap)) {
      L.push(`• <b>${esc(i.adName)}</b> <i>@${esc(i.accountName)}</i>`);
      L.push(`  ${esc(i.why)}`);
    }
    if (g.length > cap) L.push(`  <i>… อีก ${g.length - cap} ตัว ดูบนเว็บ</i>`);
  }

  if (b.moneySaved > 0 || b.moneyUpside > 0) {
    L.push("");
    const p: string[] = [];
    if (b.moneySaved > 0) p.push(`หยุดเงินไหลออก ${money(b.moneySaved)}`);
    if (b.moneyUpside > 0) p.push(`ต่อยอดกำไร ${money(b.moneyUpside)}`);
    L.push(`💰 ทำครบวันนี้: ${p.join(" · ")} (ตัวเลข 7 วัน)`);
  }

  const needNew = b.content.filter((c) => c.needNew);
  if (needNew.length) {
    L.push("");
    L.push("<b>🎬 สินค้าที่ต้องยิงคอนเทนต์ใหม่</b>");
    for (const c of needNew.slice(0, 3)) {
      L.push(`• <b>${esc(c.product)}</b> — ${esc(c.why)}`);
      if (c.winners.length) L.push(`  มุมที่ยังทำเงิน: ${c.winners.slice(0, 2).map((w) => `${esc(w.theme)} (${w.roas.toFixed(2)})`).join(" · ")} → ขยี้ต่อ`);
    }
  }

  const winners = b.content.filter((c) => !c.needNew && c.winners.length);
  if (winners.length) {
    L.push("");
    L.push("<b>✨ มุมที่เวิร์ค — ทำเพิ่มแนวเดียวกัน</b>");
    for (const c of winners.slice(0, 3))
      L.push(`• ${esc(c.product)}: ${c.winners.slice(0, 2).map((w) => `${esc(w.theme)} ROAS ${w.roas.toFixed(2)}`).join(" · ")}`);
  }

  if (b.funnel.notes.length) {
    L.push("");
    L.push("<b>🔺 สมดุล funnel</b>");
    L.push(b.funnel.rows.map((r) => `${r.stage} ${(r.share * 100).toFixed(0)}%`).join(" · "));
    for (const n of b.funnel.notes.slice(0, 2)) L.push(`• ${esc(n)}`);
  }

  if (b.unnamed.count > 0) {
    L.push("");
    L.push(`<b>🏷️ แอดที่ตั้งชื่อไม่ครบ (${b.unnamed.count} ตัว · ${money(b.unnamed.spend)} = ${(b.unnamed.share * 100).toFixed(0)}% ของงบ)</b>`);
    for (const g of b.unnamed.rows.slice(0, 3))
      L.push(`• ${esc(g.adName)} → <b>${esc(g.suggested || "")}</b> <i>(${money(g.spend)})</i>`);
    if (b.unnamed.rows.length > 3) L.push(`  <i>… อีก ${b.unnamed.rows.length - 3} ตัว ดูรายการเต็มบนเว็บ</i>`);
  }

  if (b.cannibal.length) {
    L.push("");
    L.push("<b>⚔️ ใช้เงินเพิ่มแต่ยอดรวมไม่โต (แคมเปญแย่งกันเอง)</b>");
    for (const c of b.cannibal.slice(0, 2)) L.push(`• <b>${esc(c.product)}</b> — ${esc(c.why)}`);
    L.push("<i>หยุดแตกตัวเพิ่ม แล้วคัดให้เหลือแต่ตัวที่ทำกำไร</i>");
  }

  if (b.cloneFamilies.length) {
    L.push("");
    L.push(`<b>🧬 แตกเกิน ${MAX_CLONES_PER_PARENT} ตัวต่อตัวแม่</b>`);
    for (const f of b.cloneFamilies.slice(0, 2))
      L.push(`• ${esc(f.parent)} — โคลน ${f.clones} ตัว (${money(f.spend)} · ROAS ${f.roas.toFixed(2)})`);
  }

  if (b.churn.stopped >= 10) {
    L.push("");
    L.push(`<b>♻️ เปิด-ปิดถี่</b> — 7 วันนี้หยุดไป <b>${b.churn.stopped} ตัว</b> กินงบ ${money(b.churn.spend)}${b.churn.wasted > 0 ? ` (ในนั้นยอด ๐ ${money(b.churn.wasted)})` : ""}`);
    L.push(`<i>เปิดปิดเร็วเกินแอดไม่ทันพ้น learning — ตั้งงบทดสอบต่อตัวแล้วปล่อยให้ครบ 3 วันก่อนตัดสิน</i>`);
  }

  if (b.audience.length) {
    L.push("");
    L.push("<b>👥 กลุ่มเป้าหมายที่ควรเปิดเพิ่ม</b>");
    for (const a of b.audience.slice(0, 3)) L.push(`• ${esc(a)}`);
  }

  if (b.clones.length) {
    L.push("");
    L.push("<b>🧬 clone ที่ต้องเช็ค</b>");
    for (const c of b.clones.slice(0, 3)) L.push(`• ${esc(c.adName)} — ${esc(c.why)}`);
  }

  // ── ตัดให้พอดีลิมิต Telegram โดย "ตัดทีละบรรทัด" ไม่ใช่ตัดกลางข้อความ ──
  // ถ้าตัดกลาง tag HTML (เช่น <b>ชื่อแอ) Telegram จะตอบ 400 แล้วไม่ส่งเลยทั้งข้อความ
  // ทุกบรรทัดในนี้ปิด tag ในตัวเอง → ตัดทั้งบรรทัดจึงปลอดภัยเสมอ
  // บรรทัดท้าย ๆ = เรื่องสำคัญน้อยสุด (clone/กลุ่มเป้าหมาย) เลยยอมให้หายก่อน
  const LIMIT = 3900;
  const tail = link ? `\n\n<a href="${link}">เปิดดูฉบับเต็ม →</a>` : "";
  const CUT_NOTE = "\n<i>… ตัดเพราะยาวเกินลิมิต Telegram — ดูฉบับเต็มบนเว็บ</i>";
  if (L.join("\n").length + tail.length <= LIMIT) return L.join("\n") + tail;
  const cut = [...L];
  while (cut.length && cut.join("\n").length + CUT_NOTE.length + tail.length > LIMIT) cut.pop();
  while (cut.length && cut[cut.length - 1].trim() === "") cut.pop();
  return cut.join("\n") + CUT_NOTE + tail;
}

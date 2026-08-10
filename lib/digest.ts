import type { Metrics, ContentDim, TopAd } from "./types";

// ─── Weekly Digest ───────────────────────────────────────────────────
// 5 หัวข้อตามที่ผู้ใช้กำหนด: ทำอะไรไป / ได้ผลไหมเทียบ KPI / เรียนรู้อะไร /
// จะปรับอะไร / suggest แบรนด์  — คิดจากข้อมูลจริง ไม่มีการเดา

export interface DigestKPI { roas: number; replyRate: number; convRate: number }

export interface DigestItem { text: string; tone: "good" | "bad" | "warn" | "info" }

export interface Digest {
  since: string; until: string; prevSince: string; prevUntil: string;
  headline: string;
  totals: {
    spend: number; revenue: number; roas: number;
    results: number; replies: number; replyRate: number; cpReply: number;
    purchases: number; convRate: number; basket: number;
  };
  prevTotals: { spend: number; revenue: number; roas: number; replyRate: number; cpReply: number; convRate: number };
  kpi: DigestKPI;
  kpiStatus: { key: string; label: string; actual: number; target: number; unit: string; pct: number; hit: boolean }[];
  didThisWeek: DigestItem[];   // 1) ทำอะไรไปแล้วบ้าง
  worked: DigestItem[];        // 2a) ได้ผล
  didntWork: DigestItem[];     // 2b) ไม่ได้ผล
  learned: DigestItem[];       // 3) เรียนรู้
  willAdjust: DigestItem[];    // 4) จะปรับ
  brandSuggest: DigestItem[];  // 5) suggest แบรนด์
  products: ContentDim[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pctChange = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : 0);
const money = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");

export function buildDigest(cur: Metrics, prev: Metrics, kpi: DigestKPI): Digest {
  const prevSince = prev.since, prevUntil = prev.until;
  const dSpend = pctChange(cur.spend, prev.spend);
  const dRevenue = pctChange(cur.revenue, prev.revenue);
  const dRoas = pctChange(cur.roas, prev.roas);
  const dReply = cur.replyRate - prev.replyRate;
  const dCpReply = pctChange(cur.cpReply, prev.cpReply);

  // ── KPI ──
  const kpiStatus = [
    { key: "roas", label: "ROAS", actual: cur.roas, target: kpi.roas, unit: "", pct: kpi.roas ? (cur.roas / kpi.roas) * 100 : 0, hit: cur.roas >= kpi.roas },
    { key: "replyRate", label: "% คนกลับมาตอบ", actual: cur.replyRate, target: kpi.replyRate, unit: "%", pct: kpi.replyRate ? (cur.replyRate / kpi.replyRate) * 100 : 0, hit: cur.replyRate >= kpi.replyRate },
    { key: "convRate", label: "% ปิดการขาย", actual: cur.convRate, target: kpi.convRate, unit: "%", pct: kpi.convRate ? (cur.convRate / kpi.convRate) * 100 : 0, hit: cur.convRate >= kpi.convRate },
  ];

  // ── 1) ทำอะไรไปแล้วบ้าง (จากข้อมูลจริง: แอดใหม่ / แอดที่หยุด / งบที่ขยับ) ──
  const curAdNames = new Set(cur.topAds.map((a) => a.adName));
  const prevAdNames = new Set(prev.topAds.map((a) => a.adName));
  const newAds = cur.topAds.filter((a) => !prevAdNames.has(a.adName) && a.spend > 0);
  const stoppedAds = prev.topAds.filter((a) => !curAdNames.has(a.adName) && a.spend > 100);
  const didThisWeek: DigestItem[] = [
    { text: `ใช้งบ ${money(cur.spend)} (${dSpend >= 0 ? "+" : ""}${dSpend.toFixed(0)}% จากสัปดาห์ก่อน) · ${cur.accounts.length} บัญชี`, tone: "info" },
    { text: `ยอดขาย ${money(cur.revenue)} · ROAS ${cur.roas.toFixed(2)} · ${cur.purchases} ออเดอร์`, tone: cur.roas >= kpi.roas ? "good" : "warn" },
  ];
  if (newAds.length) didThisWeek.push({ text: `เปิดแอดใหม่ ${newAds.length} ตัว: ${newAds.slice(0, 4).map((a) => a.adName).join(" · ")}${newAds.length > 4 ? ` (+${newAds.length - 4})` : ""}`, tone: "info" });
  if (stoppedAds.length) didThisWeek.push({ text: `หยุดแอด ${stoppedAds.length} ตัวที่เคยยิงสัปดาห์ก่อน: ${stoppedAds.slice(0, 3).map((a) => a.adName).join(" · ")}`, tone: "info" });

  // ── 2) ได้ผล / ไม่ได้ผล ──
  const prods = (cur.content?.products || []).filter((p) => p.spend > 0);
  const prevProdMap = new Map((prev.content?.products || []).map((p) => [p.key, p]));
  const worked: DigestItem[] = [];
  const didntWork: DigestItem[] = [];

  for (const p of prods.sort((a, b) => b.spend - a.spend)) {
    const pp = prevProdMap.get(p.key);
    const dr = pp ? pctChange(p.roas, pp.roas) : 0;
    const note = pp ? ` (สัปดาห์ก่อน ROAS ${pp.roas.toFixed(2)}${dr ? `, ${dr >= 0 ? "+" : ""}${dr.toFixed(0)}%` : ""})` : " (ใหม่สัปดาห์นี้)";
    const line = `${p.key} — ${money(p.spend)} · ROAS ${p.roas.toFixed(2)} · ตอบ ${p.replyRate.toFixed(0)}% · ปิด ${p.convRate.toFixed(0)}%${note}`;
    if (p.roas >= kpi.roas) worked.push({ text: line, tone: "good" });
    else if (p.roas < 1) didntWork.push({ text: line, tone: "bad" });
    else didntWork.push({ text: line, tone: "warn" });
  }

  // แอดเด่น/แย่รายตัว
  const topAd = [...cur.topAds].filter((a) => a.spend > 200 && a.roas > 0).sort((a, b) => b.roas - a.roas)[0];
  if (topAd) worked.push({ text: `แอดดีสุด: ${topAd.adName} @${topAd.accountName} — ROAS ${topAd.roas.toFixed(2)} · ฿/คนตอบ ${money(topAd.cpReply)}`, tone: "good" });
  const worstAd = [...cur.topAds].filter((a) => a.spend > 500).sort((a, b) => a.roas - b.roas)[0];
  if (worstAd && worstAd.roas < 1) didntWork.push({ text: `แอดแย่สุด: ${worstAd.adName} @${worstAd.accountName} — ${money(worstAd.spend)} ได้ ROAS ${worstAd.roas.toFixed(2)}`, tone: "bad" });

  // ── 3) เรียนรู้ (pattern จากข้อมูล ไม่ใช่คำแนะนำทั่วไป) ──
  const learned: DigestItem[] = [];
  // คุณภาพแชท
  learned.push({
    text: `ทัก ${cur.results} คน → กลับมาตอบจริง ${cur.replies} (${cur.replyRate.toFixed(0)}%) = แชทผี ${(100 - cur.replyRate).toFixed(0)}% · ต้นทุนจริงต่อคนที่คุยด้วย ${money(cur.cpReply)} (ไม่ใช่ ${money(cur.cpr)} ตามค่าทัก)`,
    tone: cur.replyRate >= kpi.replyRate ? "good" : "warn",
  });
  // ค่าทักถูกแต่ ROAS แย่ = กับดัก
  const trap = prods.find((p) => p.cpr > 0 && p.cpr <= (cur.cpr || 0) && p.roas < 1 && p.spend > 500);
  if (trap) learned.push({ text: `กับดัก: ${trap.key} ค่าทักถูก (${money(trap.cpr)}) แต่ ROAS แค่ ${trap.roas.toFixed(2)} — ค่าทักถูกไม่ได้แปลว่าทำกำไร`, tone: "bad" });
  // แชทผีเยอะผิดปกติ
  const ghost = prods.filter((p) => p.replyRate > 0 && p.replyRate < 40 && p.spend > 300);
  for (const g of ghost) learned.push({ text: `${g.key} คนกลับมาตอบแค่ ${g.replyRate.toFixed(0)}% (ปกติ ${kpi.replyRate}%) — คนทักไม่ตรงกลุ่ม หรือแชทตอบช้า`, tone: "bad" });
  // basket ผิดปกติ
  const prevBasket = prev.basket;
  if (prevBasket > 0 && cur.basket > 0 && cur.basket < prevBasket * 0.7 && cur.purchases >= prev.purchases) {
    learned.push({ text: `ออเดอร์ไม่ได้ลด (${prev.purchases}→${cur.purchases}) แต่ basket ร่วง ${money(prevBasket)}→${money(cur.basket)} — เช็คว่ามูลค่าถูกส่งเข้าระบบครบไหม (tracking) ก่อนสรุปว่ายอดตก`, tone: "warn" });
  }
  if (dCpReply > 20) learned.push({ text: `ต้นทุนต่อคนตอบแพงขึ้น ${dCpReply.toFixed(0)}% (${money(prev.cpReply)}→${money(cur.cpReply)}) — creative เริ่มล้า หรือกลุ่มอิ่ม`, tone: "warn" });

  // ── 4) จะปรับ (สั่งได้เลย) ──
  const willAdjust: DigestItem[] = [];
  const scaleP = prods.filter((p) => p.roas >= kpi.roas).sort((a, b) => b.roas - a.roas);
  const killP = prods.filter((p) => p.roas < 1 && p.spend > 300).sort((a, b) => b.spend - a.spend);
  for (const p of scaleP.slice(0, 2)) {
    const share = cur.spend > 0 ? (p.spend / cur.spend) * 100 : 0;
    willAdjust.push({ text: `เพิ่มงบ ${p.key} +20% (ROAS ${p.roas.toFixed(2)} แต่ได้งบแค่ ${share.toFixed(0)}% ของทั้งหมด)`, tone: "good" });
  }
  for (const p of killP.slice(0, 2)) {
    const wasted = p.spend - p.revenue;
    willAdjust.push({ text: `หยุด/ลด ${p.key} — ใช้ ${money(p.spend)} ได้กลับ ${money(p.revenue)} (ติดลบ ${money(wasted)})`, tone: "bad" });
  }
  if (killP.length && scaleP.length) {
    const move = killP.reduce((s, p) => s + p.spend, 0);
    const gain = move * (scaleP[0].roas - 1);
    willAdjust.push({ text: `ย้ายงบ ${money(move)} จากตัวขาดทุน → ${scaleP[0].key} คาดได้กำไรเพิ่ม ~${money(gain)}/สัปดาห์`, tone: "info" });
  }
  const badReplyAds = cur.topAds.filter((a) => a.spend > 300 && a.replyRate > 0 && a.replyRate < 40);
  if (badReplyAds.length) willAdjust.push({ text: `เปลี่ยน creative ${badReplyAds.length} ตัวที่คนตอบต่ำกว่า 40%: ${badReplyAds.slice(0, 3).map((a) => a.adName).join(" · ")}`, tone: "warn" });

  // ── 5) suggest แบรนด์ (เรื่องที่แอดแก้เองไม่ได้) ──
  const brandSuggest: DigestItem[] = [];
  if (cur.replyRate < kpi.replyRate) brandSuggest.push({ text: `คนกลับมาตอบ ${cur.replyRate.toFixed(0)}% ต่ำกว่าเป้า ${kpi.replyRate}% — ขอให้ทีมแชทตอบเร็วขึ้น/ปรับสคริปต์ทักแรก (ตรงนี้แอดช่วยไม่ได้)`, tone: "warn" });
  if (cur.convRate < kpi.convRate) brandSuggest.push({ text: `ปิดการขาย ${cur.convRate.toFixed(0)}% ต่ำกว่าเป้า ${kpi.convRate}% — ทบทวนราคา/โปร/ของแถม หรือสคริปต์ปิดการขาย`, tone: "warn" });
  const lowBasket = prods.filter((p) => p.basket > 0 && p.basket < cur.basket * 0.5 && p.spend > 300);
  for (const p of lowBasket) brandSuggest.push({ text: `${p.key} basket แค่ ${money(p.basket)} (เฉลี่ยรวม ${money(cur.basket)}) — ควรทำเซ็ต/อัปเซลเพิ่ม AOV ไม่งั้นยิงเท่าไหร่ก็ไม่คุ้ม`, tone: "warn" });
  const noSale = prods.filter((p) => p.spend > 500 && p.purchases === 0);
  for (const p of noSale) brandSuggest.push({ text: `${p.key} ใช้ ${money(p.spend)} แต่ยอดขาย 0 — เช็คสต๊อก/หน้าเพจ/ทีมตอบ หรือยอดขายไม่ได้ถูกบันทึก`, tone: "bad" });
  if (!brandSuggest.length) brandSuggest.push({ text: "ทุก KPI อยู่ในเกณฑ์ — ยังไม่มีเรื่องที่ต้องให้แบรนด์แก้", tone: "good" });

  // ── headline ──
  // ปลายทางของงบต้องเป็น "ชื่อสินค้าจริง" เสมอ — ถ้าสัปดาห์นี้ไม่มีตัวไหนถึงเป้า
  // ให้ใช้ตัวที่ ROAS ดีสุดเท่าที่มี (ขอแค่ยังไม่ขาดทุน) แทนคำลอย ๆ ว่า "ตัวที่ดีสุด"
  const bestP = scaleP[0] || prods.filter((p) => p.roas >= 1).sort((a, b) => b.roas - a.roas)[0];
  const dest = bestP ? `${bestP.key} (ROAS ${bestP.roas.toFixed(2)})` : "";
  const headline = killP.length
    ? dest
      ? `หยุด ${killP[0].key} (ติดลบ ${money(killP[0].spend - killP[0].revenue)}) แล้วย้ายงบไป ${dest}`
      : `หยุด ${killP[0].key} (ติดลบ ${money(killP[0].spend - killP[0].revenue)}) — สัปดาห์นี้ยังไม่มีตัวไหนคืนทุน อย่าเพิ่งเติมงบที่ไหน`
    : cur.roas >= kpi.roas
      ? `ROAS ${cur.roas.toFixed(2)} ผ่านเป้า — เพิ่มงบ ${dest || "ตัวชนะ"} +20%`
      : `ROAS ${cur.roas.toFixed(2)} ต่ำกว่าเป้า ${kpi.roas} — โฟกัสแก้คุณภาพแชท/ปิดการขายก่อนเพิ่มงบ`;

  return {
    since: cur.since, until: cur.until, prevSince, prevUntil,
    headline,
    totals: {
      spend: r2(cur.spend), revenue: r2(cur.revenue), roas: cur.roas,
      results: cur.results, replies: cur.replies, replyRate: cur.replyRate, cpReply: cur.cpReply,
      purchases: cur.purchases, convRate: cur.convRate, basket: cur.basket,
    },
    prevTotals: { spend: r2(prev.spend), revenue: r2(prev.revenue), roas: prev.roas, replyRate: prev.replyRate, cpReply: prev.cpReply, convRate: prev.convRate },
    kpi, kpiStatus,
    didThisWeek, worked, didntWork, learned, willAdjust, brandSuggest,
    products: prods,
  };
}

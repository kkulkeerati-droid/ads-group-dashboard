#!/usr/bin/env node
// ─── เทสกติกาตัดสินใจด้วยสถานการณ์ที่ประกอบขึ้นเอง ────────────────────
//
// ทำไมต้องมี: กติกาหลายข้อ (ลากแอด / แอดมด 30% / แตกโคลนเกิน / ด่าน 5 วัน)
// "ยังไม่เคยทำงานเลย" กับข้อมูลจริง เพราะบ้านนี้ยังไม่เข้าเงื่อนไข
// → ไม่มีทางรู้ว่ามันถูกจนกว่าวันนั้นจะมาถึง ซึ่งสายเกินไป
// ไฟล์นี้เลยประกอบสถานการณ์ขึ้นมาเองให้แต่ละกติกาได้ทำงานจริงอย่างน้อย 1 ครั้ง
//
// รัน:  node scripts/selftest.mjs      (คืน exit code 1 ถ้ามีข้อไหนไม่ผ่าน)

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "adsdash-selftest-"));
try {
  // คอมไพล์เป็น CommonJS — ถ้า emit ESM ตัว import จะไม่มีนามสกุล .js แล้ว Node resolve ไม่เจอ
  // rootDir . เพื่อให้ผลลัพธ์อยู่ที่ <out>/lib/*.js เหมือนโครงต้นฉบับ
  execSync(
    `npx tsc lib/ae.ts lib/decide.ts lib/content.ts lib/supabase.ts --outDir "${out}" --rootDir . ` +
      `--module commonjs --target es2022 --moduleResolution node --skipLibCheck`,
    { stdio: "pipe", cwd: ROOT }
  );
} catch (e) {
  console.error("❌ คอมไพล์ lib ไม่ผ่าน:\n" + (e.stdout?.toString() || e.message));
  process.exit(1);
}

const entry = join(out, "lib/ae.js");
if (!existsSync(entry)) {
  console.error("❌ คอมไพล์แล้วแต่หา " + entry + " ไม่เจอ");
  process.exit(1);
}
const ae = createRequire(import.meta.url)(entry);
const {
  buildAdViews, callFor, classifyFunnel, suggestName, budgetFromName, adLabel,
  scaleVerdict, boardSignal, cannibalCheck, cloneFamilies, funnelBreakdown, namingGaps,
} = ae;

// ─── helper ───────────────────────────────────────────────────────────
const UNTIL = "2026-08-09";
const day = (n) => new Date(Date.UTC(2026, 7, 9) + n * 86400000).toISOString().slice(0, 10);
// day(0)=วันสุดท้าย · day(-1),(−2) = อยู่ในช่วง "3 วันล่าสุด" · day(-3)..(-6) = ช่วงก่อนหน้า

/** สร้างแถวรายวันของแอด 1 ตัว · perDay = {d: [spend, revenue, results, replies, purchases]}
 *  opts.adId = ad_id จริงจาก Meta · ไม่ใส่ = จำลองข้อมูลเก่าก่อน migration 0003 */
function ad(name, perDay, opts = {}) {
  const rows = [];
  for (const [d, v] of Object.entries(perDay)) {
    const [spend, revenue, results = 10, replies = 5, purchases = 0] = v;
    rows.push({
      platform: "meta", accountId: opts.acct || "1", accountName: opts.acctName || "ACC",
      adId: opts.adId, adName: name, adsetId: opts.adset,
      spend, revenue, results, replies, purchases,
      impressions: opts.impressions ?? Math.round(spend * 20),
      reach: opts.reach ?? Math.round(spend * 12),
      date: day(Number(d)),
    });
  }
  return rows;
}
const spread = (days, v) => Object.fromEntries(days.map((d) => [d, v]));
const call = (rows, name, ctx = {}) => {
  const views = buildAdViews(rows, UNTIL);
  const v = views.find((x) => x.adName === name);
  if (!v) throw new Error("ไม่เจอแอด " + name);
  return callFor(v, { peerHasRevenue: true, avgFreq: 1.2, windowStart: day(-6), windowEnd: UNTIL, ...ctx });
};

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : `\n     ได้ ${JSON.stringify(got)} · ควรได้ ${JSON.stringify(want)}`}`);
}

console.log("\n━━━ 1) กติกาแอดมด — กินงบเกิน 30% ของงบวันแล้วยังไม่มีออเดอร์ (ebook บทที่ 34) ━━━");
{
  // งบในชื่อ 600 → เส้นปิด ฿180 · ใช้ไป ฿200 · ออเดอร์ 0 · เพื่อนในกลุ่มขายได้
  // ถ้าไม่มีกฎนี้จะได้ WAIT เพราะ ฿200 < MIN_SPEND_TO_JUDGE (฿300)
  const rows = ad("AI/AW/600/1Aug", spread([-6, -5, -4, -3, -2, -1, 0], [28.6, 0, 8, 0, 0]));
  const c = call(rows, "AI/AW/600/1Aug");
  check("ใช้ ฿200 จากงบ ฿600 ยังไม่มีออเดอร์ → สั่งปิด", c.action, "STOP");
  check("  เหตุผลอ้างกติกาแอดมด", c.how.includes("กติกาแอดมด"), true);

  // ยังไม่ถึง 30% → ห้ามปิด
  const rows2 = ad("AI/AW/600/1Aug", spread([-6, -5, -4, -3, -2, -1, 0], [14, 0, 5, 2, 0]));
  check("ใช้ ฿98 (ยังไม่ถึง 30%) → ยังไม่ปิด", call(rows2, "AI/AW/600/1Aug").action, "WAIT");

  // ชื่อไม่บอกงบ → กฎต้องไม่ทำงาน (กันเคส budgetFromName อ่านผิดแล้วปิดมั่ว)
  const rows3 = ad("1 cut view msg", spread([-6, -5, -4, -3, -2, -1, 0], [28.6, 0, 8, 0, 0]));
  check("ชื่อไม่บอกงบ → กฎไม่ทำงาน", call(rows3, "1 cut view msg").action, "WAIT");
}

console.log("\n━━━ 2) ด่าน 5 วัน — 'แอดติดหลอก 3 วันดี วันที่ 4 ตาย' (ebook บทที่ 55) ━━━");
{
  // ROAS 5 · 12 ออเดอร์ · แต่เพิ่งยิงมา 4 วัน → ห้ามเพิ่มงบ
  const young = ad("AI/AW/600/5Aug", spread([-3, -2, -1, 0], [500, 2500, 40, 25, 3]));
  const c1 = call(young, "AI/AW/600/5Aug");
  check("ROAS 5 · 12 ออเดอร์ · ยิงมา 4 วัน → ยังไม่ให้เพิ่มงบ", c1.action, "KEEP");
  check("  บอกเหตุผลว่ายังไม่ครบ 5 วัน", c1.how.includes("5 วัน"), true);

  // ยิงมา 7 วัน ต้นทุนต่อออเดอร์นิ่ง → สเกลได้
  const mature = ad("AI/AW/600/1Aug", spread([-6, -5, -4, -3, -2, -1, 0], [500, 2500, 40, 25, 3]));
  check("ROAS 5 · 21 ออเดอร์ · ยิงมา 7 วัน ต้นทุนนิ่ง → เพิ่มงบได้", call(mature, "AI/AW/600/1Aug").action, "SCALE");
}

console.log("\n━━━ 3) สเกลผ่าน/ไม่ผ่าน — วัดที่กำไรหลังค่าแอดต่อวัน (ebook บทที่ 31) ━━━");
{
  // ดันงบ 300→800/วัน · กำไรต่อวัน 600→100 = สเกลไม่ผ่าน → ถอยงบกลับ
  const bad = ad("AI/AW/600/1Aug", {
    ...spread([-6, -5, -4, -3], [300, 900, 20, 12, 3]),   // กำไร 600/วัน
    ...spread([-2, -1, 0], [800, 900, 30, 15, 3]),        // กำไร 100/วัน
  });
  const c = call(bad, "AI/AW/600/1Aug");
  check("ดันงบแล้วกำไรต่อวันหด → ลดงบ", c.action, "REDUCE");
  check("  เหตุผลบอกว่าสเกลไม่ผ่าน", c.why.includes("สเกลไม่ผ่าน"), true);

  // ดันงบแล้วกำไรโตตาม = สเกลผ่าน (ROAS ลดลงจาก 3.0 → 2.6 แต่เงินเข้ามากขึ้น)
  const good = ad("AI/AW/600/1Aug", {
    ...spread([-6, -5, -4, -3], [300, 900, 20, 12, 3]),   // กำไร 600/วัน
    ...spread([-2, -1, 0], [900, 2340, 40, 20, 8]),       // กำไร 1440/วัน
  });
  const sv = scaleVerdict(buildAdViews(good, UNTIL)[0]);
  check("ดันงบแล้วกำไรต่อวันโต → สเกลผ่าน", sv.passed, true);

  // กำไรขยับลงนิดเดียว (< 10%) ยังไม่นับว่าไม่ผ่าน — กันเลขรายวันเหวี่ยง
  const noise = ad("AI/AW/600/1Aug", {
    ...spread([-6, -5, -4, -3], [300, 900, 20, 12, 3]),   // กำไร 600/วัน
    ...spread([-2, -1, 0], [800, 1370, 30, 15, 4]),       // กำไร 570/วัน (−5%)
  });
  check("กำไรลง 5% → ยังถือว่าผ่าน (เผื่อ 10%)", scaleVerdict(buildAdViews(noise, UNTIL)[0]).passed, true);
}

console.log("\n━━━ 4) FIX_OFFER — ทัก+กลับมาคุยแต่ยังไม่ซื้อ ห้ามปิด (ebook บทที่ 4) ━━━");
{
  const chatty = ad("AI/AW/600/1Aug", spread([-6, -5, -4, -3, -2, -1, 0], [100, 0, 20, 12, 0]));
  const c = call(chatty, "AI/AW/600/1Aug", { peerHasRevenue: true });
  check("มีคนกลับมาคุย 84 คน แต่ยังไม่ซื้อ → แก้ข้อเสนอ ไม่ใช่ปิด", c.action, "FIX_OFFER");

  // ไม่มีใครกลับมาตอบเลย = ยิงผิดกลุ่มจริง → ปิดได้
  const ghost = ad("AI/AW/600/1Aug", spread([-6, -5, -4, -3, -2, -1, 0], [100, 0, 20, 0, 0]));
  check("ทักแล้วไม่มีใครกลับมาตอบเลย → ปิด", call(ghost, "AI/AW/600/1Aug").action, "STOP");

  // ทั้งกลุ่มไม่มียอดเลย → เป็นเรื่องการนับยอด ไม่ใช่แอด
  check("ทั้งกลุ่มไม่มียอดเข้าระบบ → เช็คการนับยอด",
    call(chatty, "AI/AW/600/1Aug", { peerHasRevenue: false }).action, "FIX_TRACKING");
}

console.log("\n━━━ 5) ลากแอด — ทั้งกระดานร่วงแต่คนยังคุยเท่าเดิม (ebook บทที่ 41) ━━━");
{
  // ROAS 4.0 → 2.0 (ร่วง 50%) แต่คนกลับมาคุยเท่าเดิม → ยอดยังไม่เข้าระบบ ไม่ใช่แอดพัง
  const rows = [
    ...ad("AI/AW/600/1Aug", { ...spread([-6, -5, -4, -3], [400, 1600, 40, 20, 5]), ...spread([-2, -1, 0], [400, 800, 40, 20, 3]) }),
    ...ad("A2/RE180/600/1Aug", { ...spread([-6, -5, -4, -3], [300, 1200, 30, 15, 4]), ...spread([-2, -1, 0], [300, 600, 30, 15, 2]) }),
  ];
  const sig = boardSignal(buildAdViews(rows, UNTIL));
  check("ROAS ร่วงครึ่ง แต่คนคุยเท่าเดิม → ขึ้นสัญญาณลากแอด", sig.wobble, true);
  check("  บอกวิธีทำ (ลากแอด)", sig.detail.includes("ลากแอด"), true);

  // ROAS ร่วงพร้อมกับคนคุยหายไปด้วย = ของจริง ไม่ใช่เรื่องการนับยอด
  const real = [
    ...ad("AI/AW/600/1Aug", { ...spread([-6, -5, -4, -3], [400, 1600, 40, 20, 5]), ...spread([-2, -1, 0], [400, 800, 12, 5, 3]) }),
    ...ad("A2/RE180/600/1Aug", { ...spread([-6, -5, -4, -3], [300, 1200, 30, 15, 4]), ...spread([-2, -1, 0], [300, 600, 9, 4, 2]) }),
  ];
  check("ROAS ร่วง + คนคุยหายด้วย → ไม่ขึ้นสัญญาณ (ของจริง)", boardSignal(buildAdViews(real, UNTIL)).wobble, false);
}

console.log("\n━━━ 6) แคมเปญแย่งกันเอง + แตกโคลนเกินโควตา (ebook บทที่ 50) ━━━");
{
  // ค่าแอด/วัน 500→800 แต่ยอดขาย/วัน เท่าเดิม = แบ่งเงินก้อนเดิมออกไปหลายทาง
  const rows = ad("AI/AW/Ultra/600/1Aug", {
    ...spread([-6, -5, -4, -3], [500, 1500, 30, 15, 4]),
    ...spread([-2, -1, 0], [800, 1500, 40, 20, 4]),
  });
  const cn = cannibalCheck(buildAdViews(rows, UNTIL));
  check("ใช้เงินเพิ่มแต่ยอดรวมไม่โต → ขึ้นเตือน", cn.length, 1);
  check("  ระบุสินค้าถูกตัว", cn[0]?.product, "1 Click Ultra");

  // ยอดโตตามงบ = สเกลจริง ไม่ต้องเตือน
  const grow = ad("AI/AW/Ultra/600/1Aug", {
    ...spread([-6, -5, -4, -3], [500, 1500, 30, 15, 4]),
    ...spread([-2, -1, 0], [800, 2500, 40, 20, 7]),
  });
  check("ใช้เงินเพิ่มแล้วยอดโตตาม → ไม่เตือน", cannibalCheck(buildAdViews(grow, UNTIL)).length, 0);

  // ตัวแม่ 1 + โคลน 4 = เกินโควตา (1-3)
  const many = [
    ...ad("AI/AW/600/1Aug", spread([-3, -2, -1, 0], [200, 600, 20, 10, 2])),
    ...[1, 2, 3, 4].flatMap((i) =>
      ad(`AI/AW/600/1Aug - สำเนา ${i}`, spread([-3, -2, -1, 0], [100, 300, 10, 5, 1]), { acct: "1" })),
  ];
  const fams = cloneFamilies(buildAdViews(many, UNTIL));
  check("ตัวแม่เดียวโคลน 4 ตัว → ขึ้นเตือนเกินโควตา", fams[0]?.over, true);

  const few = [
    ...ad("AI/AW/600/1Aug", spread([-3, -2, -1, 0], [200, 600, 20, 10, 2])),
    ...[1, 2].flatMap((i) => ad(`AI/AW/600/1Aug - สำเนา ${i}`, spread([-3, -2, -1, 0], [100, 300, 10, 5, 1]))),
  ];
  check("โคลน 2 ตัว → ยังไม่เตือน", cloneFamilies(buildAdViews(few, UNTIL))[0]?.over, false);
}

console.log("\n━━━ 7) อ่าน funnel จากชื่อ (regression — เทียบกับ targeting จริงใน Meta แล้ว 24/24) ━━━");
{
  const cases = [
    ["AI/RE180/Exซื้อ/Omni/600/8Jul", "MOF", true, "RE มาก่อน Ex เสมอ"],
    ["A2/RE60/600/11Jul", "BOF", true, "RE ≤90 วัน = คนใกล้ซื้อ"],
    ["Ai/LAL1-3%/Omni/500/14Jul", "TOF", true, "LAL ติดตัวเลข"],
    ["AI/Ex180/Omni/600/8Jul", "TOF", true, "ตัดคนเก่าออก = ล่าคนใหม่"],
    ["AI/Exซื้อ/600/9Jul", "TOF", true, "Ex ภาษาไทย"],
    ["1 cut ยอดขาย ลูกค้าใหม่ 26JULY", "TOF", true, "ระบุว่าลูกค้าใหม่"],
    ["1 cut view msg", "TOF", true, "view ไม่มี RE = ยิงกว้าง (user ยืนยัน)"],
    ["1 cut view msg RE365", "MOF", true, "view + RE = retarget"],
    ["1 cut ส่วนร่วม ซื้อ 700 19JULY", "TOF", true, "ส่วนร่วม = objective ยิงกว้าง (user ยืนยัน)"],
    ["AI/ยอดขาย/1CC/600/28Jul", "TOF", false, "ชื่อไม่บอกกลุ่ม → เดาเป็นปล่อยกว้าง"],
    ["GRD/600/30/Jul", "TOF", false, "ชื่อไม่บอกกลุ่ม"],
  ];
  for (const [name, stage, sure, note] of cases) {
    const f = classifyFunnel(name);
    check(`${note} · ${name}`, `${f.stage}/${f.sure}`, `${stage}/${sure}`);
  }
}

console.log("\n━━━ 8) เสนอชื่อใหม่ต้องไม่ทำให้ชื่อชนกัน (ชื่อซ้ำ = ข้อมูล 2 แอดถูกยำเป็นตัวเดียว) ━━━");
{
  const names = [
    "1 cut ยอดขาย ซื้อ - 700 19JULY",
    "1 cut ยอดขาย ซื้อ 500 > 700 19JULY",
    "GRD/600/30/Jul",
    "GRD conv ยอดขาย msg 04 AUG",
    "AI/ยอดขาย/1CC/600/28Jul",
    "AI/Buy/1CC/600/21Jul - สำเนา",
  ];
  const sug = names.map((n) => suggestName(n));
  check("ชื่อที่เสนอไม่ซ้ำกัน", new Set(sug).size, names.length);
  check("เสนอแล้วอ่าน funnel ออกทุกตัว", sug.every((s) => classifyFunnel(s).sure), true);
  check("ชื่อที่อ่านออกอยู่แล้วไม่ถูกเสนอให้แก้", suggestName("AI/AW/600/12Jul"), null);
  check("ไม่ทิ้งข้อความเดิม", suggestName("GRD conv ยอดขาย msg 04 AUG"), "GRD/AW/conv ยอดขาย msg 04 AUG");
}

console.log("\n━━━ 9) อ่านงบจากชื่อ — input ของกติกาแอดมด (เคยอ่านเวลา clone เป็นงบ) ━━━");
{
  check("งบปกติ", budgetFromName("AI/AW/600/12Jul"), 600);
  check("ดันงบ 500 > 700 → เอาตัวล่าสุด", budgetFromName("1 cut ยอดขาย ซื้อ 500 > 700 19JULY"), 700);
  check("ไม่อ่านเวลา clone เป็นงบ", budgetFromName("AI/Ultra/600/7Aug Clone 2026-08-09 1306"), 600);
  check("ไม่อ่านช่วงอายุเป็นงบ", budgetFromName("1 CUT view msg 001 - 36-45"), null);
  check("ไม่อ่าน 55++ เป็นงบ", budgetFromName("1 CUT view msg 001 - 55++"), null);
  check("ไม่อ่าน RE180 เป็นงบ", budgetFromName("AI/RE180/Ultra/300/7Aug"), 300);
  check("ไม่อ่าน LAL1-3% เป็นงบ", budgetFromName("Ai/LAL1-3%/Omni/500/14Jul"), 500);
  check("ชื่อไม่มีงบ → null", budgetFromName("1 cut"), null);
}

console.log("\n━━━ 10) ผลรวมต้องไม่หายไปไหน (reverse-check) ━━━");
{
  const rows = [
    ...ad("AI/AW/600/1Aug", spread([-6, -5, -4, -3, -2, -1, 0], [100, 300, 10, 5, 1])),
    ...ad("AI/RE180/1CC/600/1Aug", spread([-6, -5, -4, -3, -2, -1, 0], [200, 400, 20, 10, 2])),
    ...ad("A2/RE60/600/1Aug", spread([-6, -5, -4, -3, -2, -1, 0], [50, 200, 5, 3, 1])),
    ...ad("GRD/600/1Aug", spread([-6, -5, -4, -3, -2, -1, 0], [300, 100, 30, 12, 1])),
  ];
  const views = buildAdViews(rows, UNTIL);
  const total = views.reduce((s, v) => s + v.all.spend, 0);
  const fb = funnelBreakdown(views);
  check("ผลรวมรายชั้น = ค่าแอดรวม", Math.round(fb.rows.reduce((s, r) => s + r.spend, 0)), Math.round(total));
  check("สัดส่วนรวมกันได้ 100%", Math.round(fb.rows.reduce((s, r) => s + r.share, 0) * 100), 100);
  const gaps = namingGaps(views);
  check("นับแอดที่ชื่อไม่ครบถูกตัว (GRD ตัวเดียว)", gaps.rows.length, 1);
  check("  งบของแอดนั้นถูกต้อง", Math.round(gaps.spend), 2100);
}

console.log("\n━━━ 11) ⭐ ชื่อแอดซ้ำกันต้องไม่ถูกยุบเป็นตัวเดียว (บั๊กราก 11 ส.ค. 69) ━━━");
{
  // เคสจริง: P-FLOW 2 ยิง 1:1:3 ตั้งชื่อทุกตัวในชุดเหมือนกันเป๊ะ
  // AI/Ultra/600/7Aug มี 4 ad ID — ตัวเดียวแบกทั้งชุด ที่เหลือยอด ๐
  const NAME = "AI/Ultra/600/7Aug";
  const D = [-6, -5, -4, -3, -2, -1, 0];
  const per = (spend, rev, pur) => spread(D, [spend / 7, rev / 7, 10, 5, pur]);
  const rows = [
    ...ad(NAME, per(429.66, 6080, 1), { adId: "120247438208910686" }),
    ...ad(NAME, per(148.14, 0, 0), { adId: "120247438208890686" }),
    ...ad(NAME, per(138.88, 0, 0), { adId: "120247499809670686" }),
    ...ad(NAME, per(138.19, 0, 0), { adId: "120247499809680686" }),
  ];
  const views = buildAdViews(rows, UNTIL);
  check("4 ad_id ชื่อเดียวกัน → ได้ 4 แถว ไม่ใช่ 1", views.length, 4);

  const winner = views.find((v) => v.adId === "120247438208910686");
  check("  ตัวชนะ ROAS 14.15 ไม่ถูกเฉลี่ยจนเหลือ 6.49", Math.round(winner.all.roas * 100) / 100, 14.15);
  check("  ค่าแอดตัวชนะแยกออกมาถูกต้อง", Math.round(winner.all.spend * 100) / 100, 429.66);
  check("  รู้ว่าชื่อนี้ซ้ำกัน 4 ตัว", winner.nameDupes, 4);
  check("  ตัวชนะขึ้นอันดับ 1 ของกลุ่มชื่อซ้ำ (ค่าแอดสูงสุด)", winner.dupeRank, 1);
  check("  ป้ายที่โชว์ต่อท้ายด้วย ad_id 6 ตัว", adLabel(winner), `${NAME}  …910686`);

  // ผลรวมต้องไม่หายไปไหน — แยกแถวแล้วเงินต้องเท่าเดิม
  const sum = views.reduce((s, v) => s + v.all.spend, 0);
  check("  ผลรวมค่าแอดยังเท่าเดิม (ไม่มีอะไรหาย)", Math.round(sum * 100) / 100, 854.87);

  // ข้อมูลเก่าที่ยังไม่มี ad_id → ยังยุบรวมอยู่ (ตั้งใจ) แต่ต้องไม่พัง
  const old = [
    ...ad(NAME, per(429.66, 6080, 1)),
    ...ad(NAME, per(148.14, 0, 0)),
    ...ad(NAME, per(138.88, 0, 0)),
    ...ad(NAME, per(138.19, 0, 0)),
  ];
  const oldViews = buildAdViews(old, UNTIL);
  check("ไม่มี ad_id (ข้อมูลเก่า) → ยังรวมเป็น 1 แถว", oldViews.length, 1);
  // ยุบรวมแล้ว ROAS ตัวชนะ 14.15 ถูกเฉลี่ยกับพี่น้องยอด ๐ เหลือ 7.11 = อาการเดียวกับที่ user จับได้
  check("  ยุบรวมแล้วตัวชนะถูกกลบ (7.11 ไม่ใช่ 14.15)", Math.round(oldViews[0].all.roas * 100) / 100, 7.11);
  check("  ป้ายไม่ต่อท้ายอะไรเมื่อไม่ซ้ำ", adLabel(oldViews[0]), NAME);
}

console.log("\n━━━ 12) ⭐ บันไดออเดอร์ต้องนับเฉพาะออเดอร์ที่มีมูลค่าจริง ━━━");
{
  // Meta นับ onsite_conversion.purchase เป็น "ซื้อ" แม้มูลค่า ๐
  // วัดจริง 3 ส.ค. 69 (P-FLOW 2): 35 จาก 61 ซื้อ = 57% ไม่มีมูลค่าเลย
  // แอดหนึ่งใช้ ฿6.41 นับ 11 ซื้อ มูลค่า ๐ — ถ้านับเลขดิบ บันไดนี้จะเปิดไฟเขียวให้สเกล
  const rows = [
    ...ad("AI/AW/600/1Aug", spread([-6, -5, -4, -3, -2, -1], [100, 0, 10, 5, 5])), // 30 ซื้อผี
    ...ad("AI/AW/600/1Aug", { 0: [100, 3500, 10, 5, 2] }),                          // 2 ซื้อจริง
  ];
  const views = buildAdViews(rows, UNTIL);
  const v = views[0];
  check("Meta นับรวม 32 ซื้อ", v.all.purchases, 32);
  check("  แต่มีมูลค่าจริงแค่ 2", v.all.purchasesValued, 2);
  check("  ROAS ยังคิดถูก (3500/700)", Math.round(v.all.roas * 100) / 100, 5);

  const c = callFor(v, { peerHasRevenue: true, avgFreq: 1.2, windowStart: day(-6), windowEnd: UNTIL });
  check("ROAS 5 แต่ออเดอร์จริง 2 → ห้ามสเกล", c.action, "KEEP");
  check("  บอกด้วยว่า Meta นับกี่ตัวและผีกี่ตัว", c.why.includes("มูลค่า ๐"), true);
}

console.log("\n━━━ 13) ตารางชื่อไม่ครบต้องรวมเป็นบรรทัดเดียวต่อชื่อ ━━━");
{
  // หลังแยกราย ad_id แล้ว ถ้าไม่รวม จะเสนอชื่อใหม่ซ้ำกัน 3 บรรทัดติด = อ่านไม่รู้เรื่อง
  const NAME = "GRD/600/1Aug"; // ชื่อไม่บอกกลุ่มเป้าหมาย → เข้าตารางนี้
  const D = [-6, -5, -4, -3, -2, -1, 0];
  const rows = [
    ...ad(NAME, spread(D, [100, 300, 10, 5, 1]), { adId: "aaa111" }),
    ...ad(NAME, spread(D, [100, 300, 10, 5, 1]), { adId: "bbb222" }),
    ...ad(NAME, spread(D, [100, 300, 10, 5, 1]), { adId: "ccc333" }),
  ];
  const views = buildAdViews(rows, UNTIL);
  check("แยกเป็น 3 แอดจริง", views.length, 3);
  const gaps = namingGaps(views);
  check("แต่ตารางชื่อโชว์บรรทัดเดียว", gaps.rows.length, 1);
  check("  บอกว่ามี 3 ตัวที่ต้องไปเปลี่ยนชื่อ", gaps.rows[0].ads, 3);
  check("  งบเป็นผลรวมของทั้ง 3 ตัว", Math.round(gaps.rows[0].spend), 2100);
}

console.log("\n━━━ 14) clone ต้องจับคู่กับ 'ตัวแม่ที่เกิดก่อน' ไม่ใช่ตัวที่เจอทีหลัง ━━━");
{
  const PARENT = "AI/AW/600/1Aug";
  const rows = [
    // ตัวแม่จริง — เริ่มยิงตั้งแต่วันแรกของช่วง ต้นทุนต่อคนตอบถูก
    ...ad(PARENT, spread([-6, -5, -4, -3, -2, -1, 0], [100, 500, 20, 10, 1]), { adId: "parent-old" }),
    // ชื่อเดียวกันแต่เพิ่งเกิด + ต้นทุนแพงกว่ามาก (ถ้าจับคู่ผิดตัว คำตัดสิน clone จะกลับด้าน)
    ...ad(PARENT, spread([-1, 0], [100, 0, 20, 2, 0]), { adId: "parent-new" }),
    // clone ที่แพงกว่าตัวแม่จริง 5 เท่า → ต้องสั่ง kill
    ...ad(`${PARENT} Clone 2026-08-08 1305`, spread([-2, -1, 0], [200, 0, 20, 2, 0]), { adId: "clone-1" }),
  ];
  const views = buildAdViews(rows, UNTIL);
  const cc = ae.cloneChecks(views);
  check("จับ clone ได้ 1 ตัว", cc.length, 1);
  check("  ตัวแม่ที่จับคู่คือตัวที่เกิดก่อน", cc[0].parent.adId, "parent-old");
  check("  clone แพงกว่าตัวแม่ → สั่งปิด", cc[0].verdict, "kill");
}

console.log("\n━━━ 15) ⭐ งบเป็นของ adset ไม่ใช่ของแอด — กติกาแอดมดต้องตัดสินทั้งชุด ━━━");
{
  // ยิง 1:1:3 = 3 แอดหารงบ ฿600 ก้อนเดียวกัน · เส้นปิด = 30% ของ 600 = ฿180
  // แต่ละตัวใช้แค่ ฿70 (ไม่ถึงเส้น) แต่ทั้งชุดใช้ ฿210 (ถึงเส้น) และไม่มีออเดอร์เลย
  const N = "AI/AW/600/1Aug", D = [-6, -5, -4, -3, -2, -1, 0];
  const rows = [
    ...ad(N, spread(D, [10, 0, 8, 0, 0]), { adId: "a1", adset: "set-1" }),
    ...ad(N, spread(D, [10, 0, 8, 0, 0]), { adId: "a2", adset: "set-1" }),
    ...ad(N, spread(D, [10, 0, 8, 0, 0]), { adId: "a3", adset: "set-1" }),
  ];
  const views = buildAdViews(rows, UNTIL);
  check("รู้ว่าอยู่ชุดเดียวกัน 3 แอด", views[0].setAds, 3);
  check("  ยอดใช้ทั้งชุดถูกต้อง", Math.round(views[0].setSpend), 210);
  const c = callFor(views[0], { peerHasRevenue: true, avgFreq: 1.2, windowStart: day(-6), windowEnd: UNTIL });
  check("รายตัวใช้ ฿70 (ไม่ถึงเส้น) แต่ทั้งชุด ฿210 (ถึง) → สั่งปิด", c.action, "STOP");
  check("  บอกว่าปิดทั้งชุด ไม่ใช่ทีละตัว", c.how.includes("ปิดทั้งชุด"), true);

  // แอดเดี่ยว ๆ (ไม่ได้อยู่ชุด) ต้องทำงานเหมือนเดิมทุกอย่าง
  const solo = ad(N, spread(D, [10, 0, 8, 0, 0]), { adId: "s1", adset: "set-solo" });
  check("แอดเดี่ยวใช้ ฿70 → ยังไม่ถึงเส้น ไม่ปิด", call(solo, N).action, "WAIT");
}

console.log("\n━━━ 16) ⭐ ตัวประกอบในชุด 1:1:3 ที่ยอด ๐ ห้ามสั่งปิด ━━━");
{
  // "หน้าที่ของ 3 ตัวไม่ใช่ให้เก่งเท่ากัน แต่มีไว้หาตัวแบก" — งบไหลไปหาตัวชนะเอง
  // ก่อนแก้ ad_id ทั้ง 3 ตัวถูกยุบเป็นแถวเดียวเลยไม่เจอปัญหานี้
  // พอแยกแล้ว ตัวประกอบยอด ๐ จะโดนสั่งปิดทีละตัว = ทำลายกลไกคัดตัว
  const N = "AI/AW/600/1Aug", D = [-6, -5, -4, -3, -2, -1, 0];
  const rows = [
    ...ad(N, spread(D, [200, 857.14, 20, 10, 2]), { adId: "carrier", adset: "set-2" }), // ตัวแบก ฿1,400 → ฿6,000
    ...ad(N, spread(D, [50, 0, 20, 3, 0]), { adId: "extra-1", adset: "set-2" }),        // ฿350 ยอด ๐
    ...ad(N, spread(D, [50, 0, 20, 3, 0]), { adId: "extra-2", adset: "set-2" }),
  ];
  const views = buildAdViews(rows, UNTIL);
  const dud = views.find((v) => v.adId === "extra-1");
  check("ตัวประกอบใช้ ฿350 ยอด ๐", Math.round(dud.all.spend), 350);
  check("  แต่ทั้งชุดขายได้ ฿6,000", Math.round(dud.setRevenue), 6000);
  const c = callFor(dud, { peerHasRevenue: true, avgFreq: 1.2, windowStart: day(-6), windowEnd: UNTIL });
  check("ยอด ๐ แต่ชุดขายได้ → ห้ามปิด", c.action, "KEEP");
  check("  อธิบายด้วยหลัก 1:1:3", c.how.includes("1:1:3"), true);
}

console.log("\n━━━ 17) แต่ตัวที่กินงบเกิน 40% ของชุดโดยไม่มียอด = รูรั่วจริง ต้องปิด ━━━");
{
  // กันไม่ให้ข้อ 16 กลายเป็นใบผ่านให้แอดเผาเงินฟรี
  const N = "AI/AW/600/1Aug", D = [-6, -5, -4, -3, -2, -1, 0];
  const rows = [
    ...ad(N, spread(D, [57.14, 428.57, 20, 10, 1]), { adId: "carrier", adset: "set-3" }), // ฿400 → ฿3,000
    ...ad(N, spread(D, [128.57, 0, 20, 0, 0]), { adId: "leak", adset: "set-3" }),          // ฿900 ยอด ๐ ไม่มีคนตอบ
  ];
  const views = buildAdViews(rows, UNTIL);
  const leak = views.find((v) => v.adId === "leak");
  check("ตัวรั่วกินงบเกิน 40% ของชุด", leak.all.spend > leak.setSpend * 0.4, true);
  const c = callFor(leak, { peerHasRevenue: true, avgFreq: 1.2, windowStart: day(-6), windowEnd: UNTIL });
  check("กินงบเกินสัดส่วน + ไม่มีใครตอบ → ยังสั่งปิด", c.action, "STOP");
}

console.log("\n━━━ 18) ⭐ ตัวเขียนลง Supabase — จุดที่บั๊กรากเกิด (เดิมไม่มีเทสเลย) ━━━");
{
  process.env.SUPABASE_URL = "https://selftest.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "selftest-key";
  const sb = createRequire(import.meta.url)(join(out, "lib/supabase.js"));

  const calls = [];
  const okRes = { ok: true, status: 200, json: async () => [], text: async () => "" };
  const errRes = (msg) => ({ ok: false, status: 400, json: async () => ({}), text: async () => msg });
  /** failFirstN = ให้ N ครั้งแรกตอบ error แบบ schema (จำลอง DB ที่ยังไม่ได้ migrate) */
  const mockFetch = (failWith = null) => {
    let n = 0;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (failWith && n++ === 0) return errRes(failWith);
      return okRes;
    };
  };
  const row = (adId, adName, spend, revenue, purchases) => ({
    platform: "meta", accountId: "acc1", accountName: "ACC", adId, adName,
    spend, impressions: 100, reach: 80, results: 5, replies: 2,
    purchases, revenue, purchasesValued: revenue > 0 ? purchases : 0, date: "2026-08-07",
  });

  // 18.1 — 4 แอดชื่อเดียวกัน คนละ ad_id · วันเดียวกัน → ต้องส่งไป 4 แถว ไม่ใช่ 1
  calls.length = 0; mockFetch();
  await sb.upsertRows([
    row("id-1", "AI/Ultra/600/7Aug", 429.66, 6080, 4),
    row("id-2", "AI/Ultra/600/7Aug", 148.14, 0, 0),
    row("id-3", "AI/Ultra/600/7Aug", 138.88, 0, 0),
    row("id-4", "AI/Ultra/600/7Aug", 138.19, 0, 0),
  ], "2026-08-11T10:00:00.000Z");
  check("ชื่อซ้ำ 4 ตัว → ส่งลง DB 4 แถว", calls[0].body.length, 4);
  check("  on_conflict ชี้ที่ ad_id", calls[0].url.includes("on_conflict=platform,account_id,ad_id,date"), true);
  check("  ส่ง updated_at ไปด้วย (ไม่งั้น prune หาแถวค้างไม่เจอ)", calls[0].body[0].updated_at, "2026-08-11T10:00:00.000Z");
  check("  ตัวชนะยังเป็น ฿429.66 ไม่ถูกบวกรวม", calls[0].body[0].spend, 429.66);

  // 18.2 — ad_id เดียวกันซ้ำในหน้าเดียว → ต้องรวม (กัน Postgres 21000)
  calls.length = 0; mockFetch();
  await sb.upsertRows([row("id-9", "X", 100, 500, 1), row("id-9", "X", 50, 200, 1)]);
  check("ad_id ซ้ำในก้อนเดียว → รวมเหลือแถวเดียว", calls[0].body.length, 1);
  check("  ยอดถูกบวกเข้าด้วยกัน", calls[0].body[0].spend, 150);

  // 18.3 — ⭐ DB ยังไม่ได้ migrate → ต้องถอยไปรวมตามชื่อ ไม่ใช่แค่ตัดคอลัมน์ทิ้ง
  //        (ถ้าตัดคอลัมน์เฉย ๆ แถวชื่อซ้ำยังอยู่ครบ → ชน unique เก่า = 21000 พังทั้งรอบ)
  calls.length = 0;
  mockFetch(`Supabase 400: {"message":"Could not find the 'ad_id' column of 'ad_metrics_daily'","code":"PGRST204"}`);
  await sb.upsertRows([
    row("id-1", "AI/Ultra/600/7Aug", 429.66, 6080, 4),
    row("id-2", "AI/Ultra/600/7Aug", 148.14, 0, 0),
    row("id-3", "AI/Ultra/600/7Aug", 138.88, 0, 0),
    row("id-4", "AI/Ultra/600/7Aug", 138.19, 0, 0),
  ]);
  check("DB เก่า → ยิงใหม่อีกรอบ (ไม่ throw)", calls.length, 2);
  check("  รอบถอยรวมเหลือแถวเดียวตามชื่อ", calls[1].body.length, 1);
  check("  ยอดรวมครบ ไม่มีอะไรหาย", Math.round(calls[1].body[0].spend * 100) / 100, 854.87);
  check("  on_conflict ถอยไปที่ ad_name", calls[1].url.includes("on_conflict=platform,account_id,ad_name,date"), true);
  check("  ไม่ส่งคอลัมน์ที่ DB ยังไม่มี", "ad_id" in calls[1].body[0], false);

  // 18.4 — pruneStale ต้องแตะเฉพาะบัญชีที่ระบุ + เฉพาะแถวที่เก่ากว่ารอบ sync นี้
  calls.length = 0; mockFetch();
  await sb.pruneStale("meta", "2026-08-04", "2026-08-07", "2026-08-11T10:00:00.000Z", ["acc1", "acc2"]);
  const q = calls[0].url;
  check("prune ใช้ DELETE", calls[0].method, "DELETE");
  check("  จำกัดช่วงวันที่", q.includes("date=gte.2026-08-04") && q.includes("date=lte.2026-08-07"), true);
  check("  ลบเฉพาะแถวที่รอบนี้ไม่ได้แตะ", q.includes("updated_at=lt."), true);
  check("  ลบเฉพาะบัญชีที่ส่งมา", q.includes('account_id=in.("acc1","acc2")'), true);
  check("  ไม่ข้ามแพลตฟอร์ม", q.includes("platform=eq.meta"), true);

  // 18.5 — ไม่มีบัญชีที่ดึงสำเร็จ → ห้ามลบอะไรเลย (กันเคส Meta ล่มแล้วข้อมูลหายเกลี้ยง)
  calls.length = 0; mockFetch();
  const gone = await sb.pruneStale("meta", "2026-08-04", "2026-08-07", "2026-08-11T10:00:00.000Z", []);
  check("ไม่มีบัญชีที่ดึงได้ → ไม่ยิง DELETE เลย", calls.length, 0);
  check("  คืนค่า 0", gone, 0);
}

rmSync(out, { recursive: true, force: true });
console.log(`\n${"━".repeat(60)}\nผ่าน ${pass} · ไม่ผ่าน ${fail}\n`);
process.exit(fail ? 1 : 0);

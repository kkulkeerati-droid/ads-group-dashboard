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
    `npx tsc lib/ae.ts lib/decide.ts lib/content.ts --outDir "${out}" --rootDir . ` +
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
  buildAdViews, callFor, classifyFunnel, suggestName, budgetFromName,
  scaleVerdict, boardSignal, cannibalCheck, cloneFamilies, funnelBreakdown, namingGaps,
} = ae;

// ─── helper ───────────────────────────────────────────────────────────
const UNTIL = "2026-08-09";
const day = (n) => new Date(Date.UTC(2026, 7, 9) + n * 86400000).toISOString().slice(0, 10);
// day(0)=วันสุดท้าย · day(-1),(−2) = อยู่ในช่วง "3 วันล่าสุด" · day(-3)..(-6) = ช่วงก่อนหน้า

/** สร้างแถวรายวันของแอด 1 ตัว · perDay = {d: [spend, revenue, results, replies, purchases]} */
function ad(name, perDay, opts = {}) {
  const rows = [];
  for (const [d, v] of Object.entries(perDay)) {
    const [spend, revenue, results = 10, replies = 5, purchases = 0] = v;
    rows.push({
      platform: "meta", accountId: opts.acct || "1", accountName: opts.acctName || "ACC",
      adName: name, spend, revenue, results, replies, purchases,
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

rmSync(out, { recursive: true, force: true });
console.log(`\n${"━".repeat(60)}\nผ่าน ${pass} · ไม่ผ่าน ${fail}\n`);
process.exit(fail ? 1 : 0);

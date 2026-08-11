#!/usr/bin/env node
// ─── ส่งโค้ดไป repo ที่แชร์ให้คนนอกได้ (ads-dashboard-starter) ────────────
//
// ทำไมต้องมีสคริปต์ ไม่ก๊อปมือ:
//   repo หลักมีรหัส/ชื่อบัญชี/URL จริงอยู่ใน git history → เชิญคนนอกเข้าไม่ได้ตลอดกาล
//   ต้องมี repo คู่ที่สะอาด · ก๊อปมือทุกรอบ = วันหนึ่งจะหลุด เพราะคนลืมได้ สคริปต์ลืมไม่ได้
//
// ⭐ ด่านสุดท้ายคือ "สแกนแล้ว fail" ไม่ใช่ "ล้างแล้วเชื่อว่าล้างครบ"
//    ถ้าเจอของลับหลงเหลือ สคริปต์จะไม่เขียนอะไรเลยและคืน exit 1
//
// รัน:  node scripts/sync-starter.mjs [--dry]

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = join(process.env.HOME, "Desktop/claude/ads-dashboard-starter");
const DRY = process.argv.includes("--dry");

if (!existsSync(join(DEST, ".git"))) {
  console.error(`❌ ไม่เจอ repo ปลายทางที่ ${DEST}`);
  process.exit(1);
}

// ── 1) อะไรที่ส่งไป ──────────────────────────────────────────────────
// whitelist ไม่ใช่ blacklist — ของใหม่ที่ยังไม่ได้ตรวจจะ "ไม่ถูกส่ง" โดยอัตโนมัติ
// (blacklist พลาดแล้วของหลุด · whitelist พลาดแล้วแค่ของไม่ไป ซึ่งแก้ทีหลังได้)
const SEND = [
  "app", "lib", "supabase/migrations", ".github/workflows",
  "scripts/selftest.mjs", "scripts/deploy-api.mjs",
  "middleware.ts", "next.config.mjs", "tsconfig.json", "package.json",
  "next-env.d.ts", "vercel.json", ".gitignore", ".env.local.example",
  "DEV-HANDOFF.md",
];

// ── 2) อะไรที่ห้ามส่งเด็ดขาด ─────────────────────────────────────────
// เอกสารภายในมีข้อมูลลูกค้า ตัวเลขจริง กติกาจาก ebook ที่ซื้อมา และชื่อคู่แข่ง
const NEVER = [
  ".env.local", ".vercel", "node_modules", ".next", "tsconfig.tsbuildinfo",
  "HANDOFF.md", "NEXT-SESSION.md", "WORKFLOW.md", "guideline-checklist-FULL.txt",
  "data/snapshot.json", // ปลายทางมี demo data ที่ล้างแล้วของตัวเอง ห้ามทับ
];

// ── 3) กฎล้าง ────────────────────────────────────────────────────────
// เรียงจากเจาะจงไปกว้าง — ตัวกว้างมาก่อนจะกินตัวเจาะจงจนแทนผิด
const SCRUB = [
  // ที่อยู่ระบบจริง
  [/dashboard-ads-thanatos\.vercel\.app/g, "YOUR-APP.vercel.app"],
  [/utadlsqekppcuepcgqfj/g, "YOUR-SUPABASE-REF"],
  [/team_4MXqJ[A-Za-z0-9]*/g, "YOUR-VERCEL-TEAM-ID"],
  [/pan-s-projects15/g, "your-vercel-team"],
  [/kkulkeerati-droid/g, "your-github-user"],
  [/kkulkeerati-8562/g, "your-vercel-user"],
  [/ads-group-dashboard/g, "ads-dashboard"],
  // รหัสผ่าน
  [/Sa12345678!?/g, "YOUR-PASSWORD"],
  // ⚠️ ลำดับ 2 กฎนี้สลับไม่ได้ — account id ต้องมาก่อน ad id เสมอ
  //    ad id (18 หลัก) ถูกแปลงเป็น 15 หลัก · ถ้ากฎ 15-16 หลักมาทีหลัง มันจะกินผลลัพธ์ซ้ำ
  //    → ad id ทั้ง 4 ตัวกลายเป็นค่าเดียวกัน → เทส "ชื่อซ้ำต้องไม่ถูกยุบ" ตกทันที
  // ad account id (15-16 หลัก) — 18 หลักไม่โดนเพราะ \b ไม่มีขอบตรงกลางตัวเลข
  [/\b\d{15,16}\b/g, "AD-ACCOUNT-ID"],
  // ad id จริง — เก็บ 6 ตัวท้ายไว้ เพราะเทสยืนยันป้ายชื่อจาก 6 ตัวท้าย
  // ขึ้นต้นด้วย "ad" ไม่ใช่ตัวเลขล้วน เพราะ 2 เหตุผล:
  //   1) ด่าน FORBIDDEN แยก "เลข 15 หลักปลอม" กับ "ของจริง" ไม่ออก ถ้าใส่ตัวเลขล้วนมันจะ fail
  //   2) คนอ่านโค้ดปลายทางเห็นแล้วรู้ทันทีว่านี่คือ fixture ไม่ใช่ id จริงที่หลุดมา
  [/\b120\d{9}(\d{6})\b/g, (_m, tail) => "ad900000000" + tail],
  // ชื่อบัญชีจริง
  [/P-?FLOW\s*\d*/gi, "บัญชีตัวอย่าง"],
  [/\bRID X\s*\d*/g, "บัญชีตัวอย่าง"],
  [/\bDrX[A-Za-z0-9 ]*/g, "บัญชีตัวอย่าง"],
  [/\bGRD\s*(V\.?\d*|NEW\s*\d*|P\.?\d*\s*\d*|\d+)/g, "บัญชีตัวอย่าง"],
  [/\bUNC\s*\d\b/g, "บัญชีตัวอย่าง"],
  [/\bSEWA\s*\d\b/g, "บัญชีตัวอย่าง"],
];

// ── 4) ด่านตรวจ — เจอแล้ว fail ไม่ใช่เตือน ───────────────────────────
const FORBIDDEN = [
  /Sa12345678/, /utadlsqekppcuepcgqfj/, /dashboard-ads-thanatos/,
  /team_4MXqJ/, /pan-s-projects15/, /kkulkeerati/,
  /P-?FLOW/i, /\bRID X/, /\bDrX/, /\bGRD [V0-9N]/,
  /\b\d{15,18}\b/,
  /EAA[A-Za-z0-9_-]{20,}/,      // Meta token
  /eyJ[A-Za-z0-9_-]{20,}/,       // JWT (service_role key)
  /sbp_[a-f0-9]{20,}/,           // Supabase PAT
  /gh[pousr]_[A-Za-z0-9]{20,}/,  // GitHub token
];

const TEXT_EXT = /\.(ts|tsx|mjs|js|json|md|yml|yaml|sql|txt|css)$/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function collect() {
  const files = [];
  for (const item of SEND) {
    const p = join(SRC, item);
    if (!existsSync(p)) { console.warn(`⚠️  ไม่มี ${item} — ข้าม`); continue; }
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files.filter((f) => {
    const rel = relative(SRC, f);
    return !NEVER.some((n) => rel === n || rel.startsWith(n + "/"));
  });
}

const files = collect();
const staged = [];   // { rel, body }
const changed = [];  // ไฟล์ที่โดนล้าง

for (const f of files) {
  const rel = relative(SRC, f);
  if (!TEXT_EXT.test(f)) { staged.push({ rel, body: null, raw: f }); continue; }
  let body = readFileSync(f, "utf8");
  const before = body;
  for (const [re, to] of SCRUB) body = body.replace(re, to);
  if (body !== before) changed.push(rel);
  staged.push({ rel, body });
}

// ── ตรวจก่อนเขียน — ถ้าไม่ผ่าน ไม่เขียนอะไรเลยสักไฟล์ ──
const leaks = [];
for (const s of staged) {
  if (s.body === null) continue;
  s.body.split("\n").forEach((line, i) => {
    for (const re of FORBIDDEN) {
      if (re.test(line)) leaks.push(`${s.rel}:${i + 1}  [${re}]  ${line.trim().slice(0, 90)}`);
    }
  });
}

if (leaks.length) {
  console.error(`\n❌ เจอของลับหลงเหลือ ${leaks.length} จุด — ไม่เขียนอะไรทั้งนั้น\n`);
  for (const l of leaks.slice(0, 25)) console.error("   " + l);
  if (leaks.length > 25) console.error(`   … อีก ${leaks.length - 25} จุด`);
  console.error("\n→ เพิ่มกฎใน SCRUB แล้วรันใหม่ (อย่าแก้ FORBIDDEN ให้หลวมลง)\n");
  process.exit(1);
}

console.log(`✅ ตรวจผ่าน · ${staged.length} ไฟล์ · ล้างของลับใน ${changed.length} ไฟล์`);
if (changed.length) for (const c of changed) console.log("   ล้าง: " + c);

if (DRY) { console.log("\n(--dry) ไม่เขียนจริง"); process.exit(0); }

// ── เขียนลงปลายทาง ──
// ลบของเดิมในโฟลเดอร์ที่เราคุมก่อน กันไฟล์ที่ถูกลบใน main ค้างอยู่ที่ปลายทาง
for (const d of ["app", "lib", "supabase/migrations", ".github/workflows"]) {
  const p = join(DEST, d);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}
for (const s of staged) {
  const out = join(DEST, s.rel);
  mkdirSync(dirname(out), { recursive: true });
  if (s.body === null) cpSync(s.raw, out);
  else writeFileSync(out, s.body);
}
console.log(`\n📦 เขียนลง ${DEST} แล้ว`);

// ── 5) พิสูจน์ว่า "ของที่ส่งไป" ยังทำงานได้จริง ──────────────────────
// การล้างของลับคือการแก้โค้ดด้วย regex — มันทำโค้ดพังได้เงียบ ๆ
// เคยเกิดจริง: กฎล้าง ad id ถูกกฎล้าง account id กินซ้ำ → ad id 4 ตัวกลายเป็นค่าเดียวกัน
//              tsc ยังผ่าน แต่เทส "ชื่อซ้ำต้องไม่ถูกยุบ" ตก 5 ข้อ
// → ต้องรันเทสที่ปลายทาง ไม่ใช่เชื่อว่าต้นทางผ่านแล้วปลายทางก็ต้องผ่าน
const { execSync } = await import("node:child_process");
try {
  execSync("npx tsc --noEmit --incremental false", { cwd: DEST, stdio: "pipe" });
  const outTest = execSync("node scripts/selftest.mjs", { cwd: DEST, stdio: "pipe" }).toString();
  const line = outTest.trim().split("\n").pop();
  console.log(`✅ ที่ปลายทาง: tsc ผ่าน · ${line}`);
} catch (e) {
  console.error("\n❌ ของที่ส่งไปแล้ว 'รันไม่ผ่าน' ที่ปลายทาง — การล้างของลับทำโค้ดพัง");
  console.error((e.stdout?.toString() || "").split("\n").filter((l) => l.includes("❌")).slice(0, 10).join("\n"));
  console.error(e.stderr?.toString().slice(0, 500) || "");
  console.error("\n→ แก้กฎใน SCRUB แล้วรันใหม่ · อย่า commit ปลายทางตอนนี้\n");
  process.exit(1);
}

console.log("ต่อไป: cd ปลายทาง → git add -A && git commit && git push");

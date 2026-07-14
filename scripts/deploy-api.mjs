#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Deploy via Vercel REST API (inline files) — วิธีเดียวที่ใช้ได้จากเครื่องนี้
//
// ทำไมไม่ใช้ `vercel deploy` ปกติ: CLI upload + git integration ของ
// project นี้พังถาวร (deployment ค้าง UNKNOWN, build ไม่รัน) —
// REST API แนบไฟล์ base64 ใน request เดียว build วิ่งปกติ ~1 นาที
//
// ใช้: node scripts/deploy-api.mjs   (จากโฟลเดอร์ dashboard/)
// ═══════════════════════════════════════════════════════════════════
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const TEAM_ID = "team_4MXqJhoOsIyixboE4kEGtfPO"; // pan-s-projects15
const PROJECT = "dashboard";

// token จาก Vercel CLI login (npx vercel login)
const authPath = path.join(os.homedir(), "Library/Application Support/com.vercel.cli/auth.json");
const { token } = JSON.parse(fs.readFileSync(authPath, "utf8"));

// ไฟล์ = ทุกอย่างที่ git track (ไม่มี node_modules/.next)
const files = execSync("git ls-files", { encoding: "utf8" })
  .trim().split("\n")
  .filter((f) => fs.existsSync(f) && fs.statSync(f).isFile())
  .map((f) => ({ file: f, data: fs.readFileSync(f).toString("base64"), encoding: "base64" }));
console.log(`files: ${files.length}`);

const res = await fetch(
  `https://api.vercel.com/v13/deployments?teamId=${TEAM_ID}&skipAutoDetectionConfirmation=1`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: PROJECT, project: PROJECT, target: "production",
      files, projectSettings: { framework: "nextjs" },
    }),
  }
);
const dep = await res.json();
if (dep.error) { console.error("ERROR:", dep.error); process.exit(1); }
console.log(`deployment: ${dep.url}\nstate: ${dep.readyState}`);

// รอจน READY / ERROR
for (;;) {
  await new Promise((r) => setTimeout(r, 8000));
  const s = await fetch(
    `https://api.vercel.com/v13/deployments/${dep.id}?teamId=${TEAM_ID}`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then((r) => r.json());
  console.log("state:", s.readyState);
  if (s.readyState === "READY") { console.log("aliases:", (s.alias || []).join(", ")); break; }
  if (["ERROR", "CANCELED"].includes(s.readyState)) { console.error(s.errorMessage || s.readyState); process.exit(1); }
}

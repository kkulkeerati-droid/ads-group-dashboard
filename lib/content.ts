// ─── Content Ads analyzer ────────────────────────────────────────────
// แกะ "ชื่อแอด" (convention: GROUP/AUDIENCE/BUDGET/THEME/DATE) ออกเป็น 2 มิติ:
//   1) audience — กลุ่มเป้าหมายที่ยิง (LAL / Retarget / Broad / ENG)
//   2) theme    — มุมคอนเทนต์ (ดราม่า / Ultra / 1CC / โกดัง ...)
// เพื่อวิเคราะห์ว่า "คอนเทนต์มุมไหน + กลุ่มไหน" ค่าทักถูก/แพง (แนวคิด: คิดจากกลุ่มก่อน แล้วทำคอนเทนต์ให้เหมาะกับกลุ่ม)

export function parseAudience(name: string): string {
  const n = name.toUpperCase();
  if (/LAL/.test(n)) return "LAL (คล้ายลูกค้า)";
  if (/RE\s?\d+|RERUN|\bRE\b\//.test(n)) return "Retarget (RE)";
  if (/\bAW\b/.test(n)) return "Broad (AW)";
  if (/\bENG\b|ส่วนร่วม/.test(n)) return "Engagement";
  if (/VIEW/.test(n)) return "View video";
  return "ไม่ระบุ";
}

// keyword → ป้ายมุมคอนเทนต์ (เรียงเฉพาะเจาะจงก่อน)
const THEMES: { re: RegExp; label: string }[] = [
  { re: /ดราม่า|DRAMA/i, label: "ดราม่า" },
  { re: /ละคร/, label: "ละคร" },
  { re: /ULTRA/i, label: "Ultra" },
  { re: /1\s?CC|1\s?CLICK|1\s?CUT/i, label: "1 Click/Cut" },
  { re: /ผลไม้/, label: "ผลไม้" },
  { re: /โกดัง/, label: "โกดัง" },
  { re: /แฟชั่น|เเฟชั่น/, label: "แฟชั่น" },
  { re: /GEM/i, label: "GEM" },
  { re: /OMNI/i, label: "Omni" },
  { re: /ตัวไหล/, label: "ตัวไหล" },
];

export function parseTheme(name: string): string {
  for (const t of THEMES) if (t.re.test(name)) return t.label;
  return "ทั่วไป";
}

// ── สินค้า (ตามที่ผู้ใช้กำหนด) — เรียงเฉพาะเจาะจงก่อน กัน 1 click ultra/cart ชนกัน ──
const PRODUCTS: { re: RegExp; label: string }[] = [
  { re: /1\s*click\s*ultra|1\s*cc\s*ultra|(?=.*\bultra\b)(?=.*1\s*c)/i, label: "1 Click Ultra" },
  { re: /1\s*click\s*cart|1\s*cc\s*cart|ปักตะกร้า|cart/i, label: "1 Click Cart" },
  { re: /gpt\s*storyboard|storyboard|gpt|สตอรี่บอร์ด/i, label: "GPT Storyboard" },
  { re: /all\s*post|allpost|ออลโพส/i, label: "All Post" },
  { re: /1\s*cut|1cut|1\s*คัท/i, label: "1 Cut" },
  { re: /\bgrd\b|กรดไหลย้อน|hashi/i, label: "GRD" },
  { re: /\bultra\b/i, label: "1 Click Ultra" }, // Ultra เดี่ยว ๆ = ultra
  { re: /1\s*cc|1\s*click/i, label: "1 Click Ultra" },
];

export function parseProduct(name: string): string {
  for (const p of PRODUCTS) if (p.re.test(name)) return p.label;
  return "อื่น ๆ";
}

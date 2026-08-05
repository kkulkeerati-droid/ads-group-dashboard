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
// คีย์เวิร์ดที่ทีมใช้จริงในชื่อ ads: Ultra / GPT / 1CC / A2 / 1 Cut / GRD
// (ยืนยันกับผู้ใช้แล้ว: 1CC = 1 Click Cart, A2 = All Post)
const PRODUCTS: { re: RegExp; label: string }[] = [
  { re: /\bgrd\b|กรดไหลย้อน|hashi/i, label: "GRD" },
  { re: /gpt|storyboard|สตอรี่บอร์ด/i, label: "GPT Storyboard" },
  { re: /1\s*cut|1cut|1\s*คัท/i, label: "1 Cut" }, // ก่อน 1CC — "1 Cut" ต้องไม่โดน 1CC จับ
  { re: /1\s*c\.?c\.?\b|1\s*click\s*cart|ปักตะกร้า|\bcart\b/i, label: "1 Click Cart" },
  { re: /\ba2\b|all\s*post|allpost|ออลโพส/i, label: "All Post" },
  { re: /\bultra\b|1\s*click\s*ultra/i, label: "1 Click Ultra" },
];

export function parseProduct(name: string): string {
  for (const p of PRODUCTS) if (p.re.test(name)) return p.label;
  return "อื่น ๆ";
}

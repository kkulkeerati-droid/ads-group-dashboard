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

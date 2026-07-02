// ─── กติกาแบ่งกลุ่มตาม prefix ชื่อ ads ───────────────────────────────
// ค่า default อยู่ที่นี่ · ผู้ใช้แก้ใน UI ได้ (เก็บ localStorage แล้วส่งมาที่ API)
// การจับคู่: ชื่อ ads ต้อง "ขึ้นต้น" ด้วย keyword และตามด้วยตัวคั่น
// (เว้นวรรค / - _ | หรือจบสตริง) กัน false-match เช่น "aigen" ไม่เข้า ai

export type GroupKey = string;

export interface GroupDef {
  key: GroupKey;
  label: string;
  keywords: string[]; // เทียบแบบ case-insensitive
  color: string;
}

export const GROUPS: GroupDef[] = [
  { key: "grd", label: "GRD", keywords: ["grd"], color: "#2563eb" },
  { key: "ai", label: "AI", keywords: ["ai"], color: "#7c3aed" },
  { key: "a2", label: "A2", keywords: ["a2"], color: "#0891b2" },
  { key: "สายพาน", label: "สายพาน", keywords: ["สายพาน"], color: "#059669" },
  { key: "ap2", label: "AP2", keywords: ["ap2"], color: "#db2777" },
  { key: "others", label: "Others", keywords: [], color: "#64748b" },
];

export const OTHERS_KEY = "others";

// keyword ต้องตามด้วยตัวคั่นหรือจบสตริง (ไม่ใช่ตัวอักษร/ตัวเลขต่อกัน)
function startsWithToken(name: string, keyword: string): boolean {
  if (!keyword) return false;
  if (!name.startsWith(keyword)) return false;
  const next = name.charAt(keyword.length);
  if (next === "") return true;
  return /[^a-z0-9ก-๙]/.test(next);
}

export interface Classifier {
  groups: GroupDef[];
  classify: (adName: string) => GroupKey;
  othersKey: string;
}

// สร้างตัวจัดกลุ่มจาก config (ปรับได้จาก UI) — ถ้าไม่ส่งใช้ default
export function buildClassifier(groups: GroupDef[] = GROUPS): Classifier {
  const list = groups && groups.length ? groups : GROUPS;
  const othersKey = list.find((g) => g.keywords.length === 0)?.key || OTHERS_KEY;
  // เรียง keyword ยาว→สั้น กัน ap2 โดน a2 แย่งจับ
  const matchers = list
    .filter((g) => g.keywords.length > 0)
    .flatMap((g) => g.keywords.map((k) => ({ key: g.key, kw: k.toLowerCase() })))
    .sort((a, b) => b.kw.length - a.kw.length);

  const classify = (adName: string): GroupKey => {
    const n = (adName || "").trim().toLowerCase();
    for (const m of matchers) {
      if (startsWithToken(n, m.kw)) return m.key;
    }
    return othersKey;
  };

  // ให้แน่ใจว่ามี others bucket เสมอ
  const withOthers = list.some((g) => g.key === othersKey)
    ? list
    : [...list, { key: OTHERS_KEY, label: "Others", keywords: [], color: "#64748b" }];

  return { groups: withOthers, classify, othersKey };
}

export function parseGroupsParam(raw: string | null): GroupDef[] {
  if (!raw) return GROUPS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((g) => g.key && Array.isArray(g.keywords))) {
      return parsed;
    }
  } catch {
    /* ignore, fallback default */
  }
  return GROUPS;
}

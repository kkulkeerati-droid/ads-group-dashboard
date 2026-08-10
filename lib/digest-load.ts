// ─── โหลดข้อมูล + สร้าง Digest (ใช้ร่วมกันระหว่างหน้าเว็บกับ LINE) ────
// แยกออกมาเพื่อไม่ให้ /api/digest กับ /api/digest/line คำนวณคนละแบบ
// (เคยพลาดแนวนี้มาแล้ว: เลข 2 ที่ไม่ตรงกัน = เชื่อไม่ได้ทั้งคู่)

import { supabaseEnabled, readRows } from "./supabase";
import { aggregate } from "./aggregate";
import { buildDigest, type Digest, type DigestKPI } from "./digest";
import type { GroupDef } from "./groups";
import type { AdRow } from "./types";

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

export const DEFAULT_KPI: DigestKPI = { roas: 2, replyRate: 60, convRate: 15 };

export type DigestLoad = { ok: true; digest: Digest } | { ok: false; error: string; status: number };

/** 7 วันล่าสุด (จบที่ until) เทียบกับ 7 วันก่อนหน้า */
export async function loadDigest(opts: {
  until?: string;
  kpi?: DigestKPI;
  groupsConfig?: GroupDef[];
}): Promise<DigestLoad> {
  const until = opts.until || new Date().toISOString().slice(0, 10);
  const since = addDays(until, -6);
  const prevUntil = addDays(since, -1);
  const prevSince = addDays(prevUntil, -6);
  const kpi = opts.kpi || DEFAULT_KPI;

  if (!supabaseEnabled()) {
    return { ok: false, status: 503, error: "Digest ต้องใช้ Supabase cache (ยังไม่ได้ตั้ง)" };
  }

  try {
    const [curRows, prevRows] = await Promise.all([
      readRows("all", since, until),
      readRows("all", prevSince, prevUntil),
    ]);
    if (curRows.length === 0) {
      return { ok: false, status: 404, error: `ไม่มีข้อมูลในช่วง ${since}–${until}` };
    }
    const cur = aggregate(curRows as AdRow[], { source: "supabase", platform: "all", since, until, groupsConfig: opts.groupsConfig });
    const prev = aggregate(prevRows as AdRow[], { source: "supabase", platform: "all", since: prevSince, until: prevUntil, groupsConfig: opts.groupsConfig });
    return { ok: true, digest: buildDigest(cur, prev, kpi) };
  } catch (e: any) {
    return { ok: false, status: 500, error: e?.message || String(e) };
  }
}

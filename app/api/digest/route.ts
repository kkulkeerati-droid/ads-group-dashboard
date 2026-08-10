import { NextRequest, NextResponse } from "next/server";
import { supabaseEnabled, readRows } from "@/lib/supabase";
import { aggregate } from "@/lib/aggregate";
import { parseGroupsParam } from "@/lib/groups";
import { buildDigest } from "@/lib/digest";
import type { AdRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

// Weekly Digest — เทียบ 7 วันล่าสุด vs 7 วันก่อนหน้า แล้วสรุปเป็น 5 หัวข้อ
// (ใช้ cache เท่านั้น — ต้องการข้อมูล 14 วันย้อนหลัง ดึงสดจะ timeout)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const until = sp.get("until") || new Date().toISOString().slice(0, 10);
  const since = addDays(until, -6);
  const prevUntil = addDays(since, -1);
  const prevSince = addDays(prevUntil, -6);
  const groupsConfig = parseGroupsParam(sp.get("groups"));
  // KPI เป้า (ปรับผ่าน query ได้): ROAS, %ตอบกลับ, %ปิดการขาย
  const kpi = {
    roas: parseFloat(sp.get("kpiRoas") || "2"),
    replyRate: parseFloat(sp.get("kpiReply") || "60"),
    convRate: parseFloat(sp.get("kpiConv") || "15"),
  };

  if (!supabaseEnabled()) {
    return NextResponse.json({ error: "Digest ต้องใช้ Supabase cache (ยังไม่ได้ตั้ง)" }, { status: 503 });
  }

  try {
    const [curRows, prevRows] = await Promise.all([
      readRows("all", since, until),
      readRows("all", prevSince, prevUntil),
    ]);
    if (curRows.length === 0) {
      return NextResponse.json({ error: `ไม่มีข้อมูลในช่วง ${since}–${until}` }, { status: 404 });
    }
    const cur = aggregate(curRows as AdRow[], { source: "supabase", platform: "all", since, until, groupsConfig });
    const prev = aggregate(prevRows as AdRow[], { source: "supabase", platform: "all", since: prevSince, until: prevUntil, groupsConfig });
    return NextResponse.json(buildDigest(cur, prev, kpi));
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

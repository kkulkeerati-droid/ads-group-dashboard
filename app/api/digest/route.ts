import { NextRequest, NextResponse } from "next/server";
import { parseGroupsParam } from "@/lib/groups";
import { loadDigest, DEFAULT_KPI } from "@/lib/digest-load";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Weekly Digest — เทียบ 7 วันล่าสุด vs 7 วันก่อนหน้า แล้วสรุปเป็น 5 หัวข้อ
// (ใช้ cache เท่านั้น — ต้องการข้อมูล 14 วันย้อนหลัง ดึงสดจะ timeout)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const res = await loadDigest({
    until: sp.get("until") || undefined,
    groupsConfig: parseGroupsParam(sp.get("groups")),
    // KPI เป้า (ปรับผ่าน query ได้): ROAS, %ตอบกลับ, %ปิดการขาย
    kpi: {
      roas: parseFloat(sp.get("kpiRoas") || String(DEFAULT_KPI.roas)),
      replyRate: parseFloat(sp.get("kpiReply") || String(DEFAULT_KPI.replyRate)),
      convRate: parseFloat(sp.get("kpiConv") || String(DEFAULT_KPI.convRate)),
    },
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.digest);
}

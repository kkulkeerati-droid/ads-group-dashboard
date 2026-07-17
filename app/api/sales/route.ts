import { NextRequest, NextResponse } from "next/server";
import { supabaseEnabled, readSalesByGroup, upsertSales } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/sales?since=YYYY-MM-DD&until=YYYY-MM-DD → รวมยอดขายจริงต่อกลุ่มในช่วง
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const since = sp.get("since");
  const until = sp.get("until");
  if (!supabaseEnabled()) return NextResponse.json({ enabled: false, byGroup: {} });
  if (!since || !until) return NextResponse.json({ error: "ต้องมี since + until" }, { status: 400 });
  try {
    const byGroup = await readSalesByGroup(since, until);
    return NextResponse.json({ enabled: true, byGroup });
  } catch (e: any) {
    return NextResponse.json({ enabled: true, byGroup: {}, error: e.message || String(e) }, { status: 502 });
  }
}

// POST /api/sales  body: { date: "YYYY-MM-DD", entries: { [groupKey]: number } }
export async function POST(req: NextRequest) {
  if (!supabaseEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Supabase ยังไม่ได้ตั้งค่า — เปิด Supabase (SUPABASE_URL + SERVICE_ROLE_KEY) ก่อนถึงจะเก็บยอดขายจริงแบบแชร์ทีมได้" },
      { status: 400 }
    );
  }
  const body = await req.json().catch(() => null);
  if (!body?.date || !body?.entries || typeof body.entries !== "object") {
    return NextResponse.json({ ok: false, error: "ต้องมี date + entries" }, { status: 400 });
  }
  const rows = Object.entries(body.entries as Record<string, unknown>)
    .filter(([, v]) => v !== "" && v != null && !isNaN(Number(v)))
    .map(([groupKey, sales]) => ({ date: body.date as string, groupKey, sales: Number(sales) }));
  if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0 });
  try {
    const n = await upsertSales(rows);
    return NextResponse.json({ ok: true, upserted: n });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 502 });
  }
}

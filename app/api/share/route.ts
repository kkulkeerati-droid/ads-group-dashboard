import { NextResponse } from "next/server";
import { shareTokenFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

// คืน share sig สำหรับสร้างลิงก์แชร์แบบไม่บอกรหัส
// (route นี้อยู่หลัง middleware — คนที่ login แล้วเท่านั้นที่ขอได้)
export async function GET() {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return NextResponse.json({ share: null }); // ไม่ล็อก = ไม่ต้องมี sig
  return NextResponse.json({ share: await shareTokenFor(pw) });
}

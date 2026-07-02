import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return NextResponse.json({ ok: true }); // ไม่ได้ตั้งรหัส = ผ่านเลย

  const body = await req.json().catch(() => ({}));
  if (body.password !== pw) {
    return NextResponse.json({ ok: false, error: "รหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await tokenFor(pw), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 วัน
  });
  return res;
}

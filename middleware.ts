import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

// ล็อกทั้งเว็บด้วยรหัสผ่าน (ตั้ง DASHBOARD_PASSWORD)
// ถ้าไม่ตั้ง = ไม่ล็อก (สะดวกตอน dev/demo)
export async function middleware(req: NextRequest) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // ยกเว้น: หน้า login, api login, และ /api/sync (cron — กันด้วย CRON_SECRET เองแล้ว)
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/sync")
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  const expected = await tokenFor(pw);
  if (cookie === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor, shareTokenFor } from "@/lib/auth";

// ล็อกทั้งเว็บด้วยรหัสผ่าน (ตั้ง DASHBOARD_PASSWORD)
// ถ้าไม่ตั้ง = ไม่ล็อก (สะดวกตอน dev/demo)
export async function middleware(req: NextRequest) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // ยกเว้น: หน้า login, api login, และ route ที่ cron ยิง (กันด้วย CRON_SECRET เองแล้ว)
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/sync") ||
    pathname.startsWith("/api/digest/telegram")
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  const expected = await tokenFor(pw);
  if (cookie === expected) return NextResponse.next();

  // signed share link (?share=<sig>) — ลูกค้าเปิดได้โดยไม่รู้รหัส
  // sig ถูกต้อง → set cookie แล้ว redirect ตัด share ออกจาก URL (กัน sig ค้างใน address bar)
  const shareSig = req.nextUrl.searchParams.get("share");
  if (shareSig && shareSig === (await shareTokenFor(pw))) {
    const clean = req.nextUrl.clone();
    clean.searchParams.delete("share");
    const res = NextResponse.redirect(clean);
    res.cookies.set(AUTH_COOKIE, expected, {
      httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 30, path: "/",
    });
    return res;
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

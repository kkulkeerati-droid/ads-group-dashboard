import { NextRequest, NextResponse } from "next/server";
import { loadRows, addDays } from "@/lib/digest-load";
import { buildBrief, briefToTelegram } from "@/lib/brief";
import { readAdsets } from "@/lib/supabase";
import { shareTokenFor } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── สรุปบ่าย + แผนพรุ่งนี้ ───────────────────────────────────────────
//   /api/brief                                → JSON (ต้องล็อกอิน — หน้า /brief เรียกตัวนี้)
//   /api/brief?key=<CRON_SECRET>&send=1       → ส่งเข้า Telegram
//   /api/brief?key=<CRON_SECRET>&send=1&dry=1 → ดูข้อความก่อน ไม่ส่งจริง
//   &date=YYYY-MM-DD                          → เลือกวัน (default = วันนี้ เวลาไทย)
//
// ⚠️ วันนี้ยังไม่จบ → ตัวเลขวันนี้ใช้ "ดูจังหวะ" เท่านั้น
//    คำสั่ง scale/หยุด/clone ทั้งหมดตัดจาก 7 วันที่จบวันแล้ว

function todayBangkok(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

async function handle(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const send = sp.get("send") === "1";
  const dry = sp.get("dry") === "1";

  // โหมดส่ง = cron เรียก → ต้องมี CRON_SECRET (path นี้อยู่นอกกำแพงรหัส)
  if (send) {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้ง CRON_SECRET" }, { status: 403 });
    if ((sp.get("key") || req.headers.get("x-cron-key")) !== secret)
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const date = sp.get("date") || todayBangkok();
  // ฐานตัดสินใจ = 7 วันที่จบวันแล้ว (เมื่อวานย้อนไป) — ไม่เอาวันนี้ที่ยังไม่จบมาปน
  const weekUntil = addDays(date, -1);
  const weekSince = addDays(weekUntil, -6);

  const [todayRows, weekRows] = await Promise.all([loadRows(date, date), loadRows(weekSince, weekUntil)]);
  if (!todayRows || !weekRows)
    return NextResponse.json({ ok: false, error: "ต้องตั้ง Supabase ก่อน (สรุปนี้อ่านจาก cache)" }, { status: 503 });
  if (weekRows.length === 0)
    return NextResponse.json({ ok: false, error: `ไม่มีข้อมูลช่วง ${weekSince}–${weekUntil}` }, { status: 404 });

  // targeting/งบจริง — ถ้ายังไม่ได้รัน migration 0003 จะได้ [] แล้วถอยไปเดาจากชื่อเหมือนเดิม
  const adsets = await readAdsets("all").catch(() => []);

  const brief = buildBrief({
    date, todayRows, weekRows, weekSince, weekUntil,
    dayComplete: date < todayBangkok(),
    nowISO: new Date().toISOString(),
    adsets,
  });

  if (!send) return NextResponse.json(brief);

  const origin = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const pw = process.env.DASHBOARD_PASSWORD;
  const link = `${origin}/brief${pw ? `?share=${await shareTokenFor(pw)}` : ""}`;
  const text = briefToTelegram(brief, link);

  if (dry)
    return NextResponse.json({
      ok: true, dry: true, date, chars: text.length,
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), text,
    });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chats = (process.env.TELEGRAM_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || !chats.length)
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID", hint: "ใช้ &dry=1 ดูข้อความได้" },
      { status: 503 }
    );

  const failed: { chat: string; error: any }[] = [];
  let sent = 0;
  for (const chat of chats) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.ok !== false) sent++;
    else failed.push({ chat, error: body?.description || res.status });
  }
  return NextResponse.json({ ok: !failed.length, date, sent, failed }, { status: failed.length && !sent ? 502 : 200 });
}

export const GET = handle;
export const POST = handle;

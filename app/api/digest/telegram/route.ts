import { NextRequest, NextResponse } from "next/server";
import { loadDigest, loadDay, loadWeek, addDays, DEFAULT_KPI } from "@/lib/digest-load";
import { buildDailyMessage, buildWeeklyMessage } from "@/lib/daily";
import { shareTokenFor } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── ส่งสรุปเข้า Telegram ─────────────────────────────────────────────
// ยิงจาก GitHub Actions ทุกเช้า (ดู .github/workflows/daily-telegram.yml)
//
//   /api/digest/telegram?key=<CRON_SECRET>         → ส่งสรุปเมื่อวาน
//   /api/digest/telegram?key=...&dry=1             → ดูข้อความ ไม่ส่งจริง
//   /api/digest/telegram?key=...&date=YYYY-MM-DD   → เลือกวันที่จะสรุป
//   /api/digest/telegram?key=...&weekly=1          → บังคับแนบสรุปสัปดาห์
//
// วันจันทร์จะแนบ "สรุปสัปดาห์ที่ผ่านมา" เป็นข้อความที่ 2 ให้เอง
//
// route นี้อยู่นอกกำแพงรหัสผ่าน จึงกันด้วย CRON_SECRET เอง
// env ที่ต้องมี: TELEGRAM_BOT_TOKEN (จาก @BotFather) · TELEGRAM_CHAT_ID (หลายห้องคั่น ,)

async function sendTelegram(token: string, chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(`Telegram ${res.status}: ${body?.description || JSON.stringify(body).slice(0, 200)}`);
  }
}

async function handle(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // ── ด่าน 1: กันคนนอก ──
  const secret = process.env.CRON_SECRET;
  const key = sp.get("key") || req.headers.get("x-cron-key");
  if (!secret) return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้ง CRON_SECRET" }, { status: 403 });
  if (key !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const dry = sp.get("dry") === "1";
  // default = เมื่อวาน (วันที่จบแล้ว) — ไม่เอาวันนี้ที่ยังไม่จบมาสรุป
  const date = sp.get("date") || addDays(new Date().toISOString().slice(0, 10), -1);

  // ── ด่าน 2: ประกอบข้อความ ──
  let day, week;
  try {
    [day, week] = await Promise.all([loadDay(date), loadWeek(date)]);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
  if (!day || !week) {
    return NextResponse.json({ ok: false, error: "ต้องตั้ง Supabase ก่อน (สรุปรายวันอ่านจาก cache)" }, { status: 503 });
  }

  const origin = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const pw = process.env.DASHBOARD_PASSWORD;
  const sig = pw ? `?share=${await shareTokenFor(pw)}` : "";
  const messages = [buildDailyMessage(day, week, `${origin}/${sig}`)];

  // วันจันทร์ (หรือสั่งเอง) → แนบสรุปสัปดาห์
  const [y, m, d] = date.split("-").map(Number);
  const isMonday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0; // สรุปของอาทิตย์ = ส่งเช้าวันจันทร์
  if (isMonday || sp.get("weekly") === "1") {
    const wk = await loadDigest({ until: date, kpi: DEFAULT_KPI });
    if (wk.ok) messages.push(buildWeeklyMessage(wk.digest, `${origin}/digest${sig}`));
  }

  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, note: "ยังไม่ได้ส่งจริง — เอา &dry=1 ออกเพื่อส่ง",
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      date, weekRange: `${week.since} – ${week.until}`,
      count: messages.length, chars: messages.map((m) => m.length), messages,
    });
  }

  // ── ด่าน 3: ส่งจริง ──
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chats = (process.env.TELEGRAM_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || chats.length === 0) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN และ/หรือ TELEGRAM_CHAT_ID", hint: "ระหว่างนี้ใช้ &dry=1 ดูข้อความได้" },
      { status: 503 }
    );
  }

  const failed: { chat: string; error: string }[] = [];
  let sent = 0;
  for (const chat of chats) {
    for (const text of messages) {
      try { await sendTelegram(token, chat, text); sent++; }
      catch (e: any) { failed.push({ chat, error: e?.message || String(e) }); }
    }
  }
  return NextResponse.json(
    { ok: failed.length === 0, date, sent, failed },
    { status: failed.length && !sent ? 502 : 200 }
  );
}

export const GET = handle;
export const POST = handle;

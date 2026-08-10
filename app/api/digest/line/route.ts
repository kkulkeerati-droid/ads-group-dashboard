import { NextRequest, NextResponse } from "next/server";
import { loadDigest, DEFAULT_KPI } from "@/lib/digest-load";
import { digestToLineMessages, LINE_MAX_MESSAGES } from "@/lib/digest-text";
import { shareTokenFor } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── ส่ง Weekly Digest เข้า LINE ──────────────────────────────────────
// ยิงจาก GitHub Actions ทุกวันจันทร์เช้า (ดู .github/workflows/weekly-digest-line.yml)
//
//   /api/digest/line?key=<CRON_SECRET>          → สร้าง digest แล้ว push เข้า LINE
//   /api/digest/line?key=<CRON_SECRET>&dry=1    → คืนข้อความที่จะส่ง (ไม่ส่งจริง) — ใช้ทดสอบ
//   &until=YYYY-MM-DD                            → ส่งสรุปของสัปดาห์ที่จบวันนั้น
//
// route นี้อยู่นอกกำแพงรหัสผ่าน (middleware) จึงต้องกันด้วย CRON_SECRET เองเสมอ
//
// ต้องตั้ง env 2 ตัวถึงจะส่งได้จริง:
//   LINE_CHANNEL_ACCESS_TOKEN  = Channel access token (long-lived) ของ LINE OA
//   LINE_TO                    = userId / groupId ปลายทาง (ใส่หลายตัวคั่นด้วย ,)

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

async function pushToLine(token: string, to: string, messages: string[]) {
  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: messages.slice(0, LINE_MAX_MESSAGES).map((text) => ({ type: "text", text })) }),
  });
  if (!res.ok) throw new Error(`LINE ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function handle(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // ── ด่าน 1: กันคนนอกยิง ──
  const secret = process.env.CRON_SECRET;
  const key = sp.get("key") || req.headers.get("x-cron-key");
  if (!secret) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้ง CRON_SECRET — ต้องตั้งก่อนถึงจะยิง route นี้ได้" }, { status: 403 });
  }
  if (key !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const dry = sp.get("dry") === "1";

  // ── ด่าน 2: สร้าง digest (ตัวเดียวกับที่หน้าเว็บใช้) ──
  const res = await loadDigest({ until: sp.get("until") || undefined, kpi: DEFAULT_KPI });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });

  // ลิงก์เปิดอ่านฉบับเต็มโดยไม่ต้องกรอกรหัส (ถ้าตั้งรหัสไว้)
  const origin = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const pw = process.env.DASHBOARD_PASSWORD;
  const shareUrl = pw ? `${origin}/digest?share=${await shareTokenFor(pw)}` : `${origin}/digest`;
  const messages = digestToLineMessages(res.digest, { shareUrl });

  if (dry) {
    return NextResponse.json({
      ok: true,
      dry: true,
      note: "ยังไม่ได้ส่งจริง — เอา &dry=1 ออกเพื่อส่ง",
      lineConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_TO),
      range: `${res.digest.since} – ${res.digest.until}`,
      count: messages.length,
      chars: messages.map((m) => m.length),
      messages,
    });
  }

  // ── ด่าน 3: ส่งจริง ──
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = (process.env.LINE_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || to.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN และ/หรือ LINE_TO — ดูวิธีตั้งใน WORKFLOW.md (PHASE 9)",
        hint: "ระหว่างนี้ใช้ &dry=1 ดูข้อความที่จะส่งได้",
      },
      { status: 503 }
    );
  }

  const sent: string[] = [];
  const failed: { to: string; error: string }[] = [];
  for (const dest of to) {
    try {
      await pushToLine(token, dest, messages);
      sent.push(dest);
    } catch (e: any) {
      failed.push({ to: dest, error: e?.message || String(e) });
    }
  }
  return NextResponse.json(
    { ok: failed.length === 0, range: `${res.digest.since} – ${res.digest.until}`, messages: messages.length, sent: sent.length, failed },
    { status: failed.length && !sent.length ? 502 : 200 }
  );
}

export const GET = handle;
export const POST = handle;

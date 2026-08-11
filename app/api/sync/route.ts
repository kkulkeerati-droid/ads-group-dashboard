import { NextRequest, NextResponse } from "next/server";
import { fetchMetaAds, fetchMetaAdsets } from "@/lib/meta";
import { fetchTikTokAds } from "@/lib/tiktok";
import { supabaseEnabled, upsertRows, pruneStale, upsertAdsets } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// cron-job.org / Vercel cron จะยิงมาที่ /api/sync?key=CRON_SECRET ทุก 5 นาที
// ดึงข้อมูลล่าสุดจากทุกแพลตฟอร์ม → เก็บลง Supabase
function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function handle(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") || req.headers.get("x-cron-key");
  const secret = process.env.CRON_SECRET;
  const fromVercelCron = req.headers.get("x-vercel-cron") !== null;
  // บังคับต้องมี CRON_SECRET เสมอ (กันคนนอกยิงให้ระบบดึง Meta รัว ๆ / เปลืองโควตา)
  if (!secret && !fromVercelCron) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้ง CRON_SECRET — ต้องตั้งก่อนถึงจะยิง /api/sync ได้ (กันคนนอก)" },
      { status: 403 }
    );
  }
  if (secret && key !== secret && !fromVercelCron) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supabaseEnabled()) {
    return NextResponse.json({
      ok: false,
      error: "Supabase ยังไม่ได้ตั้งค่า — ใส่ SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ก่อน",
    });
  }

  // sync ย้อนหลัง N วัน (ครอบข้อมูลที่ยัง settle ไม่นิ่ง)
  // — หรือระบุช่วงเองผ่าน ?since=YYYY-MM-DD&until=YYYY-MM-DD สำหรับ backfill ย้อนหลังเป็นก้อน ๆ
  const days = parseInt(process.env.SYNC_DAYS || "7", 10);
  const qSince = req.nextUrl.searchParams.get("since");
  const qUntil = req.nextUrl.searchParams.get("until");
  const since = qSince || isoDaysAgo(days);
  const until = qUntil || isoDaysAgo(0);

  const metaToken = process.env.META_ACCESS_TOKEN;
  const ttToken = process.env.TIKTOK_ACCESS_TOKEN;
  // prune = ลบแถวในช่วงนี้ที่รอบ sync ปัจจุบันไม่ได้แตะ (แอดถูกลบ/archive → Meta ไม่คืนมาแล้ว)
  // เปิดไว้เป็นค่าเริ่มต้น: upsert อย่างเดียวไม่มีวันลบแถวค้าง และหลัง migration 0003
  // แถวเก่า (ad_id = ชื่อแอด) จะอยู่คู่กับแถวใหม่ (ad_id = ตัวเลข) → ตัวเลขเป็นสองเท่า
  const prune = req.nextUrl.searchParams.get("prune") !== "0";
  // targeting/งบระดับ adset — ⚠️ payload หนักมาก ต้อง "ขอเอง" เท่านั้น (?adsets=1)
  // เคยเปิดเป็นค่าเริ่มต้นแล้ว sync ทั้งรอบโดน FUNCTION_INVOCATION_TIMEOUT (60s)
  // ตัวนี้เปลี่ยนช้า วันละครั้งพอ — มี workflow แยกยิงให้ (adsets-snapshot.yml)
  const wantAdsets = req.nextUrl.searchParams.get("adsets") === "1";
  const t0 = Date.now();
  const syncedAt = new Date().toISOString();
  const result: any = { ok: true, since, until, prune, platforms: {} };

  try {
    if (metaToken) {
      const accountIds = (process.env.META_AD_ACCOUNTS || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const { rows, issues } = await fetchMetaAds({ token: metaToken, accountIds, since, until });
      const n = await upsertRows(rows, syncedAt);
      // ลบได้เฉพาะบัญชีที่ "คืนแถวจริงรอบนี้" — บัญชีที่ error หรือคืนว่าง ห้ามแตะของเก่า
      const touched = [...new Set(rows.map((r) => r.accountId))];
      const pruned = prune ? await pruneStale("meta", since, until, syncedAt, touched) : 0;
      result.platforms.meta = {
        fetched: rows.length, upserted: n, pruned, accounts: touched.length,
        issues: issues.length,
        ...(issues.length ? { issueList: issues.slice(0, 5) } : {}),
      };

      // targeting/งบ — ทำ "หลัง" ตัวเลขหลักลง DB แล้วเท่านั้น และเฉพาะเวลาที่เหลือ
      // เก็บได้ไม่ครบไม่เป็นไร รอบหน้าเก็บต่อ · ตัวเลขหลักต้องไม่พังเพราะของแถม
      if (wantAdsets) {
        const budgetMs = 45_000 - (Date.now() - t0);
        if (budgetMs > 5_000) {
          const r = await fetchMetaAdsets({
            token: metaToken, accountIds, deadline: t0 + 45_000,
          });
          result.platforms.meta.adsets = r.adsets.length ? await upsertAdsets(r.adsets) : 0;
          result.platforms.meta.adsetAccounts = `${r.done}/${r.total}`;
          if (r.issues.length) result.platforms.meta.adsetIssues = r.issues.slice(0, 3);
        } else {
          result.platforms.meta.adsets = "ข้าม (เวลาไม่พอ)";
        }
      }
    }
    if (ttToken) {
      const advertiserIds = (process.env.TIKTOK_ADVERTISER_IDS || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const rows = await fetchTikTokAds({ token: ttToken, advertiserIds, since, until });
      const n = await upsertRows(rows, syncedAt);
      const touched = [...new Set(rows.map((r) => r.accountId))];
      const pruned = prune ? await pruneStale("tiktok", since, until, syncedAt, touched) : 0;
      result.platforms.tiktok = { fetched: rows.length, upserted: n, pruned };
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 502 });
  }

  result.tookMs = Date.now() - t0;
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;

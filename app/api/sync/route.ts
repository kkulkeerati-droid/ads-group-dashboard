import { NextRequest, NextResponse } from "next/server";
import { fetchMetaAds } from "@/lib/meta";
import { fetchTikTokAds } from "@/lib/tiktok";
import { supabaseEnabled, upsertRows } from "@/lib/supabase";

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
  const days = parseInt(process.env.SYNC_DAYS || "7", 10);
  const since = isoDaysAgo(days);
  const until = isoDaysAgo(0);

  const metaToken = process.env.META_ACCESS_TOKEN;
  const ttToken = process.env.TIKTOK_ACCESS_TOKEN;
  const result: any = { ok: true, since, until, platforms: {} };

  try {
    if (metaToken) {
      const accountIds = (process.env.META_AD_ACCOUNTS || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const { rows, issues } = await fetchMetaAds({ token: metaToken, accountIds, since, until });
      const n = await upsertRows(rows);
      result.platforms.meta = { fetched: rows.length, upserted: n, issues: issues.length };
    }
    if (ttToken) {
      const advertiserIds = (process.env.TIKTOK_ADVERTISER_IDS || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const rows = await fetchTikTokAds({ token: ttToken, advertiserIds, since, until });
      const n = await upsertRows(rows);
      result.platforms.tiktok = { fetched: rows.length, upserted: n };
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 502 });
  }

  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;

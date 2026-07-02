import { NextRequest, NextResponse } from "next/server";
import { fetchMetaAds } from "@/lib/meta";
import { fetchTikTokAds } from "@/lib/tiktok";
import { supabaseEnabled, readRows } from "@/lib/supabase";
import { aggregate, buildDemoSeries } from "@/lib/aggregate";
import { parseGroupsParam } from "@/lib/groups";
import type { AdRow, AccountIssue } from "@/lib/types";
import snapshot from "@/data/snapshot.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function resolveRange(preset: string, qsince?: string, quntil?: string) {
  if (qsince && quntil) return { since: qsince, until: quntil };
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  const start = new Date();
  switch (preset) {
    case "today": break;
    case "last_7d": start.setDate(start.getDate() - 6); break;
    case "this_month": start.setDate(1); break;
    case "last_30d":
    default: start.setDate(start.getDate() - 29); break;
  }
  return { since: iso(start), until: iso(end) };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const platform = (sp.get("platform") || "all") as "meta" | "tiktok" | "all";
  const preset = sp.get("preset") || "last_30d";
  const { since, until } = resolveRange(preset, sp.get("since") || undefined, sp.get("until") || undefined);
  const groupsConfig = parseGroupsParam(sp.get("groups"));

  const metaToken = process.env.META_ACCESS_TOKEN;
  const ttToken = process.env.TIKTOK_ACCESS_TOKEN;
  const wantMeta = platform === "all" || platform === "meta";
  const wantTikTok = platform === "all" || platform === "tiktok";
  const warnings: string[] = [];

  // ── ชั้น 1: Supabase (ถ้าตั้งค่า) — เร็วสุด มีประวัติ ──
  if (supabaseEnabled()) {
    try {
      const rows = await readRows(platform, since, until);
      if (rows.length > 0) {
        return NextResponse.json(
          aggregate(rows, { source: "supabase", platform, since, until, groupsConfig, warnings })
        );
      }
      warnings.push("Supabase ยังไม่มีข้อมูลในช่วงนี้ — รอ cron sync หรือยิง /api/sync");
    } catch (e: any) {
      warnings.push("อ่าน Supabase ไม่ได้: " + (e.message || e));
    }
  }

  // ── ชั้น 2: Live API (ถ้ามี token) ──
  const hasLive = (wantMeta && metaToken) || (wantTikTok && ttToken);
  if (hasLive) {
    const rows: AdRow[] = [];
    const accountIssues: AccountIssue[] = [];
    try {
      if (wantMeta && metaToken) {
        const accountIds = (process.env.META_AD_ACCOUNTS || "")
          .split(",").map((s) => s.trim()).filter(Boolean);
        const r = await fetchMetaAds({ token: metaToken, accountIds, since, until });
        rows.push(...r.rows);
        accountIssues.push(...r.issues);
      }
      if (wantTikTok && ttToken) {
        const advertiserIds = (process.env.TIKTOK_ADVERTISER_IDS || "")
          .split(",").map((s) => s.trim()).filter(Boolean);
        rows.push(...(await fetchTikTokAds({ token: ttToken, advertiserIds, since, until })));
      } else if (wantTikTok && !ttToken) {
        warnings.push("TikTok: ยังไม่ได้ authorize / ตั้ง token");
      }
    } catch (e: any) {
      return NextResponse.json({ error: e.message || String(e) }, { status: 502 });
    }
    return NextResponse.json(
      aggregate(rows, { source: "live", platform, since, until, groupsConfig, warnings, accountIssues })
    );
  }

  // ── ชั้น 3: Demo (snapshot จริง) ──
  const rows = (snapshot.rows as AdRow[]).filter(
    (r) => platform === "all" || r.platform === platform
  );
  warnings.push("โหมด DEMO — ใส่ META_ACCESS_TOKEN (หรือ Supabase) ใน .env.local เพื่อดึงข้อมูลสด");
  const metrics = aggregate(rows, {
    source: "demo",
    platform,
    since: snapshot.since,
    until: snapshot.until,
    currency: snapshot.currency,
    groupsConfig,
    warnings,
    accountIssues: snapshot.accountIssues as AccountIssue[],
  });
  // เติม demo trend จากยอดรวมต่อกลุ่ม (ติดธง demo)
  const groupSpend: Record<string, number> = {};
  for (const g of metrics.groups) if (g.spend > 0) groupSpend[g.key] = g.spend;
  metrics.series = buildDemoSeries(groupSpend, 14, snapshot.until);
  return NextResponse.json(metrics);
}

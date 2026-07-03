import { NextRequest, NextResponse } from "next/server";
import { fetchMetaAds } from "@/lib/meta";
import { fetchTikTokAds } from "@/lib/tiktok";
import { supabaseEnabled, readRows, earliestDate } from "@/lib/supabase";
import { aggregate, buildDemoSeries, toPrevTotals } from "@/lib/aggregate";
import { parseGroupsParam } from "@/lib/groups";
import type { AdRow, AccountIssue } from "@/lib/types";
import snapshot from "@/data/snapshot.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
function daysLen(since: string, until: string): number {
  const [a, b] = [since, until].map((s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); });
  return Math.round((b - a) / 86400000) + 1;
}

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

// deterministic scale factor สำหรับสร้างงวดก่อนในโหมด demo
function hashFactor(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 0.78 + (h % 40) / 100; // 0.78..1.17
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const platform = (sp.get("platform") || "all") as "meta" | "tiktok" | "all";
  const preset = sp.get("preset") || "last_30d";
  const { since, until } = resolveRange(preset, sp.get("since") || undefined, sp.get("until") || undefined);
  const groupsConfig = parseGroupsParam(sp.get("groups"));
  const acctFilter = (sp.get("accounts") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const filterAcc = (rows: AdRow[]) => (acctFilter.length ? rows.filter((r) => acctFilter.includes(r.accountId)) : rows);

  // งวดก่อนหน้า (ยาวเท่ากัน ต่อกันพอดี)
  const len = daysLen(since, until);
  const prevUntil = addDays(since, -1);
  const prevSince = addDays(prevUntil, -(len - 1));

  const metaToken = process.env.META_ACCESS_TOKEN;
  const ttToken = process.env.TIKTOK_ACCESS_TOKEN;
  const wantMeta = platform === "all" || platform === "meta";
  const wantTikTok = platform === "all" || platform === "tiktok";
  const warnings: string[] = [];

  // ── ชั้น 1: Supabase ──
  // ใช้ cache เฉพาะเมื่อ "ครอบช่วงที่ขอครบ" (วันเก่าสุดใน cache ≤ since)
  // ไม่งั้นตกไป live — กันโชว์ข้อมูลไม่ครบว่าเป็นยอดทั้งช่วง
  if (supabaseEnabled()) {
    try {
      const earliest = await earliestDate(platform);
      if (earliest !== null && earliest <= since) {
        const rows = filterAcc(await readRows(platform, since, until));
        if (rows.length > 0) {
          const prevRows = filterAcc(await readRows(platform, prevSince, prevUntil));
          const m = aggregate(rows, { source: "supabase", platform, since, until, groupsConfig, warnings });
          m.prev = toPrevTotals(prevRows, prevSince, prevUntil, groupsConfig);
          return NextResponse.json(m);
        }
      } else if (earliest !== null) {
        warnings.push(`Supabase cache ย้อนถึงแค่ ${earliest} — ช่วงนี้ยังไม่ครบ ดึงสดแทน (รอ backfill/cron)`);
      }
    } catch (e: any) {
      warnings.push("อ่าน Supabase ไม่ได้: " + (e.message || e));
    }
  }

  // ── ชั้น 2: Live API ──
  const hasLive = (wantMeta && metaToken) || (wantTikTok && ttToken);
  if (hasLive) {
    const all: AdRow[] = [];
    const accountIssues: AccountIssue[] = [];
    try {
      // ดึงช่วงเดียวคลุมทั้งงวดก่อน+ปัจจุบัน แล้วค่อยแยกด้วยวันที่ (ไม่ยิง API ซ้ำ)
      if (wantMeta && metaToken) {
        const accountIds = (process.env.META_AD_ACCOUNTS || "").split(",").map((s) => s.trim()).filter(Boolean);
        const r = await fetchMetaAds({ token: metaToken, accountIds, since: prevSince, until });
        all.push(...r.rows);
        accountIssues.push(...r.issues);
      }
      if (wantTikTok && ttToken) {
        const advertiserIds = (process.env.TIKTOK_ADVERTISER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
        all.push(...(await fetchTikTokAds({ token: ttToken, advertiserIds, since: prevSince, until })));
      } else if (wantTikTok && !ttToken) {
        warnings.push("TikTok: ยังไม่ได้ authorize / ตั้ง token");
      }
    } catch (e: any) {
      return NextResponse.json({ error: e.message || String(e) }, { status: 502 });
    }
    const rows = filterAcc(all.filter((r) => r.date && r.date >= since));
    const prevRows = filterAcc(all.filter((r) => r.date && r.date < since && r.date >= prevSince));
    const m = aggregate(rows, { source: "live", platform, since, until, groupsConfig, warnings, accountIssues });
    m.prev = toPrevTotals(prevRows, prevSince, prevUntil, groupsConfig);
    return NextResponse.json(m);
  }

  // ── ชั้น 3: Demo ──
  const baseRows = filterAcc((snapshot.rows as AdRow[]).filter((r) => platform === "all" || r.platform === platform));
  warnings.push("โหมด DEMO — ใส่ META_ACCESS_TOKEN (หรือ Supabase) ใน .env.local เพื่อดึงข้อมูลสด");
  const metrics = aggregate(baseRows, {
    source: "demo", platform, since: snapshot.since, until: snapshot.until,
    currency: snapshot.currency, groupsConfig, warnings,
    accountIssues: snapshot.accountIssues as AccountIssue[],
  });
  // demo trend + งวดก่อน (สังเคราะห์แบบคงที่)
  const groupSpend: Record<string, number> = {};
  for (const g of metrics.groups) if (g.spend > 0) groupSpend[g.key] = g.spend;
  metrics.series = buildDemoSeries(groupSpend, 14, snapshot.until);
  const prevRows = baseRows.map((r) => ({ ...r, spend: r.spend * hashFactor(r.adName), results: Math.round(r.results * hashFactor(r.adName + "r")) }));
  metrics.prev = toPrevTotals(prevRows, prevSince, prevUntil, groupsConfig);
  return NextResponse.json(metrics);
}

import { buildClassifier, type GroupDef } from "./groups";
import type {
  AdRow,
  Metrics,
  GroupTotal,
  AccountTotal,
  TopAd,
  SeriesPoint,
  AccountIssue,
  PrevTotals,
} from "./types";

// สรุปยอดงวดก่อนสำหรับเทียบ (ใช้ classifier เดียวกับงวดปัจจุบัน)
export function toPrevTotals(
  rows: AdRow[],
  since: string,
  until: string,
  groupsConfig?: GroupDef[]
): PrevTotals {
  const m = aggregate(rows, { source: "live", platform: "all", since, until, groupsConfig });
  const byGroup: Record<string, number> = {};
  for (const g of m.groups) byGroup[g.key] = g.spend;
  return {
    spend: m.spend, results: m.results, reach: m.reach, impressions: m.impressions,
    cpr: m.cpr, cpm: m.cpm, revenue: m.revenue, roas: m.roas, byGroup, since, until,
  };
}

interface Acc {
  spend: number;
  impressions: number;
  reach: number;
  results: number;
  revenue: number;
  purchases: number;
}
const zero = (): Acc => ({ spend: 0, impressions: 0, reach: 0, results: 0, revenue: 0, purchases: 0 });

function cpm(a: Acc) {
  return a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
}
function cpr(a: Acc) {
  return a.results > 0 ? a.spend / a.results : 0;
}
function roas(a: Acc) {
  return a.spend > 0 ? a.revenue / a.spend : 0;
}

export function aggregate(
  rows: AdRow[],
  opts: {
    source: "supabase" | "live" | "demo";
    platform: "meta" | "tiktok" | "all";
    since: string;
    until: string;
    currency?: string;
    groupsConfig?: GroupDef[];
    warnings?: string[];
    accountIssues?: AccountIssue[];
    demoSeries?: SeriesPoint[];
    realSales?: Record<string, number>; // ยอดขายจริงต่อกลุ่ม (key → บาท) สำหรับ ROAS จริง
  }
): Metrics {
  const { classify, groups: groupDefs } = buildClassifier(opts.groupsConfig);
  const realSales = opts.realSales || {};

  const groupAcc = new Map<string, Acc>();
  const groupAds = new Map<string, Set<string>>();
  const groupResultType = new Map<string, Map<string, number>>();
  for (const g of groupDefs) {
    groupAcc.set(g.key, zero());
    groupAds.set(g.key, new Set());
    groupResultType.set(g.key, new Map());
  }

  const accounts = new Map<string, AccountTotal & { _acc: Acc }>();
  const seriesMap = new Map<string, Record<string, number>>();
  const adMap = new Map<string, TopAd & { _acc: Acc }>();
  const total = zero();

  for (const r of rows) {
    const key = classify(r.adName);
    if (!groupAcc.has(key)) {
      groupAcc.set(key, zero());
      groupAds.set(key, new Set());
      groupResultType.set(key, new Map());
    }
    const ga = groupAcc.get(key)!;
    ga.spend += r.spend;
    ga.impressions += r.impressions;
    ga.reach += r.reach;
    ga.results += r.results;
    ga.revenue += r.revenue || 0;
    ga.purchases += r.purchases || 0;
    groupAds.get(key)!.add(`${r.accountId}::${r.adName}`);
    if (r.resultType) {
      const rt = groupResultType.get(key)!;
      rt.set(r.resultType, (rt.get(r.resultType) || 0) + r.results);
    }
    total.spend += r.spend;
    total.impressions += r.impressions;
    total.reach += r.reach;
    total.results += r.results;
    total.revenue += r.revenue || 0;
    total.purchases += r.purchases || 0;

    // per account
    const accKey = `${r.platform}:${r.accountId}`;
    let acc = accounts.get(accKey);
    if (!acc) {
      acc = {
        id: r.accountId,
        name: r.accountName,
        platform: r.platform,
        byGroup: {},
        _acc: zero(),
        spend: 0,
        impressions: 0,
        reach: 0,
        results: 0,
        cpm: 0,
        cpr: 0,
        revenue: 0,
        purchases: 0,
        roas: 0,
      };
      accounts.set(accKey, acc);
    }
    acc._acc.spend += r.spend;
    acc._acc.impressions += r.impressions;
    acc._acc.reach += r.reach;
    acc._acc.results += r.results;
    acc._acc.revenue += r.revenue || 0;
    acc._acc.purchases += r.purchases || 0;
    acc.byGroup[key] = (acc.byGroup[key] || 0) + r.spend;

    // series (live: มี date)
    if (r.date) {
      let pt = seriesMap.get(r.date);
      if (!pt) {
        pt = {};
        seriesMap.set(r.date, pt);
      }
      pt[key] = (pt[key] || 0) + r.spend;
    }

    // top ads
    const adKey = `${accKey}::${r.adName}`;
    let ad = adMap.get(adKey);
    if (!ad) {
      ad = {
        adName: r.adName,
        group: key,
        accountName: r.accountName,
        platform: r.platform,
        _acc: zero(),
        spend: 0,
        impressions: 0,
        reach: 0,
        results: 0,
        cpm: 0,
        cpr: 0,
        revenue: 0,
        purchases: 0,
        roas: 0,
      };
      adMap.set(adKey, ad);
    }
    ad._acc.spend += r.spend;
    ad._acc.impressions += r.impressions;
    ad._acc.reach += r.reach;
    ad._acc.results += r.results;
    ad._acc.revenue += r.revenue || 0;
    ad._acc.purchases += r.purchases || 0;
  }

  const groups: GroupTotal[] = groupDefs.map((g) => {
    const a = groupAcc.get(g.key)!;
    const rt = groupResultType.get(g.key)!;
    const topType = [...rt.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const rev = realSales[g.key] != null ? realSales[g.key] : undefined;
    return {
      key: g.key,
      label: g.label,
      color: g.color,
      spend: round2(a.spend),
      impressions: a.impressions,
      reach: a.reach,
      results: a.results,
      cpm: round2(cpm(a)),
      cpr: round2(cpr(a)),
      revenue: round2(a.revenue),
      purchases: a.purchases,
      roas: round2(roas(a)),
      share: total.spend > 0 ? a.spend / total.spend : 0,
      ads: groupAds.get(g.key)!.size,
      resultType: topType,
      target: g.target,
      roasTarget: g.roasTarget,
      realRevenue: rev,
      realRoas: rev != null && a.spend > 0 ? round2(rev / a.spend) : undefined,
    };
  });

  const accountList: AccountTotal[] = [...accounts.values()]
    .map((a) => finalizeMetric(a, a._acc))
    .sort((x, y) => y.spend - x.spend);

  const topAds: TopAd[] = [...adMap.values()]
    .sort((x, y) => y._acc.spend - x._acc.spend)
    .slice(0, 25)
    .map((a) => finalizeMetric(a, a._acc));

  let series: SeriesPoint[] = [...seriesMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, byGroup]) => ({ date, byGroup: roundMap(byGroup) }));

  // demo: ไม่มี date จริง → ใช้ series ที่ generate มา (ติดธง demo)
  if (series.length === 0 && opts.demoSeries) series = opts.demoSeries;

  return {
    source: opts.source,
    platform: opts.platform,
    since: opts.since,
    until: opts.until,
    updatedAt: new Date().toISOString(),
    currency: opts.currency || "THB",
    spend: round2(total.spend),
    impressions: total.impressions,
    reach: total.reach,
    results: total.results,
    cpm: round2(cpm(total)),
    cpr: round2(cpr(total)),
    revenue: round2(total.revenue),
    purchases: total.purchases,
    roas: round2(roas(total)),
    groups,
    accounts: accountList,
    topAds,
    series,
    accountIssues: opts.accountIssues || [],
    warnings: opts.warnings || [],
  };
}

function finalizeMetric<T extends { _acc?: Acc }>(obj: T, a: Acc): any {
  const { _acc, ...rest } = obj as any;
  return {
    ...rest,
    spend: round2(a.spend),
    impressions: a.impressions,
    reach: a.reach,
    results: a.results,
    cpm: round2(cpm(a)),
    cpr: round2(cpr(a)),
    revenue: round2(a.revenue),
    purchases: a.purchases,
    roas: round2(roas(a)),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function roundMap(o: Record<string, number>) {
  const r: Record<string, number> = {};
  for (const k of Object.keys(o)) r[k] = round2(o[k]);
  return r;
}

// สร้าง demo series แบบ deterministic กระจายจากยอดรวมต่อกลุ่ม (มีธง demo กำกับ)
export function buildDemoSeries(
  groupSpend: Record<string, number>,
  days: number,
  endDate: string
): SeriesPoint[] {
  const end = new Date(endDate + "T00:00:00Z");
  const pts: SeriesPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const byGroup: Record<string, number> = {};
    const dayIndex = days - 1 - i;
    for (const [k, total] of Object.entries(groupSpend)) {
      // น้ำหนักคงที่ต่อวัน (ไซน์เบา ๆ) — ไม่ใช้ random เพื่อให้ resume ได้
      const w = 1 + 0.35 * Math.sin((dayIndex / days) * Math.PI * 2 + k.length);
      byGroup[k] = round2((total / days) * w);
    }
    pts.push({ date: iso, byGroup, demo: true });
  }
  return pts;
}

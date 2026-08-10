import { buildClassifier, type GroupDef } from "./groups";
import { parseAudience, parseTheme, parseProduct } from "./content";
import {
  buildAdViews, classifyFunnel, funnelBreakdown, funnelByProduct, namingGaps,
  FUNNEL_LABEL, type Funnel,
} from "./ae";
import type { ContentDim, FunnelTotal, FunnelProductRow, NamingGapRow } from "./types";
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

// สีชั้น funnel — บนสุด (คนใหม่) ไปล่างสุด (ใกล้ซื้อ) · "?" เป็นเทากลาง ๆ ให้รู้ว่าอ่านไม่ออก
export const FUNNEL_COLOR: Record<string, string> = {
  TOF: "#38bdf8",
  MOF: "#a78bfa",
  BOF: "#34d399",
  "?": "#94a3b8",
};
export const FUNNEL_ORDER: Funnel[] = ["TOF", "MOF", "BOF", "?"];

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
    cpr: m.cpr, cpm: m.cpm, byGroup, since, until,
  };
}

interface Acc {
  spend: number;
  impressions: number;
  reach: number;
  results: number;
  replies: number;
  purchases: number;
  revenue: number;
}
const zero = (): Acc => ({ spend: 0, impressions: 0, reach: 0, results: 0, replies: 0, purchases: 0, revenue: 0 });

// บวก metric คุณภาพเข้า accumulator (ที่เดียว — เรียกทุกจุดที่บวก spend)
function addQ(a: Acc, r: AdRow) {
  a.replies += r.replies || 0;
  a.purchases += r.purchases || 0;
  a.revenue += r.revenue || 0;
}

function cpm(a: Acc) {
  return a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
}
function cpr(a: Acc) {
  return a.results > 0 ? a.spend / a.results : 0;
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
  }
): Metrics {
  const { classify, groups: groupDefs } = buildClassifier(opts.groupsConfig);

  const groupAcc = new Map<string, Acc>();
  const groupAds = new Map<string, Set<string>>();
  const groupResultType = new Map<string, Map<string, number>>();
  for (const g of groupDefs) {
    groupAcc.set(g.key, zero());
    groupAds.set(g.key, new Set());
    groupResultType.set(g.key, new Map());
  }

  const accounts = new Map<string, AccountTotal & { _acc: Acc }>();
  const seriesMap = new Map<string, { byGroup: Record<string, number>; byFunnel: Record<string, number> }>();
  const adMap = new Map<string, TopAd & { _acc: Acc }>();
  // วันที่ที่แต่ละ ad มีข้อมูล — ใช้ดูว่าเพิ่งเกิด (ยัง learning) หรือยิงมานานแล้ว
  const adDays = new Map<string, Set<string>>();
  const total = zero();

  for (const r of rows) {
    const key = classify(r.adName);
    if (!groupAcc.has(key)) {
      groupAcc.set(key, zero());
      groupAds.set(key, new Set());
      groupResultType.set(key, new Map());
    }
    const ga = groupAcc.get(key)!;
    ga.spend += r.spend; addQ(ga, r);
    ga.impressions += r.impressions;
    ga.reach += r.reach;
    ga.results += r.results;
    groupAds.get(key)!.add(`${r.accountId}::${r.adName}`);
    if (r.resultType) {
      const rt = groupResultType.get(key)!;
      rt.set(r.resultType, (rt.get(r.resultType) || 0) + r.results);
    }
    total.spend += r.spend; addQ(total, r);
    total.impressions += r.impressions;
    total.reach += r.reach;
    total.results += r.results;

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
        replies: 0, replyRate: 0, cpReply: 0, purchases: 0, revenue: 0, roas: 0, convRate: 0, basket: 0,
      };
      accounts.set(accKey, acc);
    }
    acc._acc.spend += r.spend; addQ(acc._acc, r);
    acc._acc.impressions += r.impressions;
    acc._acc.reach += r.reach;
    acc._acc.results += r.results;
    acc.byGroup[key] = (acc.byGroup[key] || 0) + r.spend;

    // series (live: มี date) — เก็บทั้งต่อกลุ่มและต่อชั้น funnel
    if (r.date) {
      let pt = seriesMap.get(r.date);
      if (!pt) {
        pt = { byGroup: {}, byFunnel: {} };
        seriesMap.set(r.date, pt);
      }
      pt.byGroup[key] = (pt.byGroup[key] || 0) + r.spend;
      const st = classifyFunnel(r.adName).stage;
      pt.byFunnel[st] = (pt.byFunnel[st] || 0) + r.spend;
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
        replies: 0, replyRate: 0, cpReply: 0, purchases: 0, revenue: 0, roas: 0, convRate: 0, basket: 0,
      };
      adMap.set(adKey, ad);
    }
    if (r.date) {
      let ds = adDays.get(adKey);
      if (!ds) { ds = new Set(); adDays.set(adKey, ds); }
      ds.add(r.date);
    }
    ad._acc.spend += r.spend; addQ(ad._acc, r);
    ad._acc.impressions += r.impressions;
    ad._acc.reach += r.reach;
    ad._acc.results += r.results;
  }

  const groups: GroupTotal[] = groupDefs.map((g) => {
    const a = groupAcc.get(g.key)!;
    const rt = groupResultType.get(g.key)!;
    const topType = [...rt.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
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
      ...qualityOf(a),
      share: total.spend > 0 ? a.spend / total.spend : 0,
      ads: groupAds.get(g.key)!.size,
      resultType: topType,
      target: g.target,
    };
  });

  const accountList: AccountTotal[] = [...accounts.values()]
    .map((a) => finalizeMetric(a, a._acc))
    .sort((x, y) => y.spend - x.spend);

  const topAds: TopAd[] = [...adMap.entries()]
    .sort((x, y) => y[1]._acc.spend - x[1]._acc.spend)
    .slice(0, 25)
    .map(([k, a]) => ({ ...finalizeMetric(a, a._acc), activeDays: adDays.get(k)?.size ?? 0 }));

  let series: SeriesPoint[] = [...seriesMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, pt]) => ({ date, byGroup: roundMap(pt.byGroup), byFunnel: roundMap(pt.byFunnel) }));

  // demo: ไม่มี date จริง → ใช้ series ที่ generate มา (ติดธง demo)
  if (series.length === 0 && opts.demoSeries) series = opts.demoSeries;

  // ── วิเคราะห์ content ads (มุมคอนเทนต์ / กลุ่มเป้าหมาย จากชื่อแอด) ──
  // นับต่อ "แอด" ไม่ใช่ต่อแถวรายวัน → ต้อง dedupe ชื่อก่อนนับ ads
  const themeAcc = new Map<string, Acc & { names: Set<string> }>();
  const audAcc = new Map<string, Acc & { names: Set<string> }>();
  const prodAcc = new Map<string, Acc & { names: Set<string> }>();
  const funnelAcc = new Map<string, Acc & { names: Set<string> }>();
  for (const r of rows) {
    if (!r.adName) continue;
    for (const [map, key] of [
      [themeAcc, parseTheme(r.adName)],
      [audAcc, parseAudience(r.adName)],
      [prodAcc, parseProduct(r.adName)],
      [funnelAcc, FUNNEL_LABEL[classifyFunnel(r.adName).stage]],
    ] as const) {
      let a = map.get(key);
      if (!a) { a = { ...zero(), names: new Set() }; map.set(key, a); }
      a.spend += r.spend; a.impressions += r.impressions; addQ(a, r);
      a.reach += r.reach; a.results += r.results;
      a.names.add(r.adName);
    }
  }
  const toDims = (m: Map<string, Acc & { names: Set<string> }>): ContentDim[] =>
    [...m.entries()]
      .map(([key, a]) => ({ key, spend: round2(a.spend), results: a.results, cpr: round2(cpr(a)), ads: a.names.size, ...qualityOf(a) }))
      .filter((d) => d.spend > 0)
      .sort((x, y) => y.spend - x.spend);
  const content = { themes: toDims(themeAcc), audiences: toDims(audAcc), products: toDims(prodAcc), funnels: toDims(funnelAcc) };

  // ── funnel: ใช้เครื่องเดียวกับหน้า /brief เพื่อให้ตัวเลข 2 หน้าตรงกันเสมอ ──
  const views = buildAdViews(rows, opts.until).filter((v) => v.all.spend > 0);
  const fb = funnelBreakdown(views);
  const funnelRows: FunnelTotal[] = fb.rows.map((r) => ({
    stage: r.stage,
    label: r.label,
    color: FUNNEL_COLOR[r.stage] || "#94a3b8",
    share: r.share,
    ads: r.ads,
    assumedSpend: round2(r.assumedSpend),
    assumedAds: r.assumedAds,
    spend: round2(r.spend),
    impressions: 0,
    reach: 0,
    results: r.results,
    cpm: 0,
    cpr: r.results > 0 ? round2(r.spend / r.results) : 0,
    replies: r.replies,
    replyRate: r.results > 0 ? round2((r.replies / r.results) * 100) : 0,
    cpReply: r.replies > 0 ? round2(r.spend / r.replies) : 0,
    purchases: r.purchases,
    revenue: round2(r.revenue),
    roas: round2(r.roas),
    convRate: r.results > 0 ? round2((r.purchases / r.results) * 100) : 0,
    basket: r.purchases > 0 ? round2(r.revenue / r.purchases) : 0,
  }));
  const funnelProducts: FunnelProductRow[] = funnelByProduct(views).map((p) => ({
    product: p.product,
    spend: round2(p.spend),
    roas: round2(p.roas),
    purchases: p.purchases,
    missing: p.missing,
    note: p.note,
    cells: Object.fromEntries(
      FUNNEL_ORDER.map((st) => [st, {
        spend: round2(p.cells[st].spend), share: p.cells[st].share,
        roas: round2(p.cells[st].roas), ads: p.cells[st].ads,
      }])
    ),
  }));
  const gaps = namingGaps(views);
  const naming = { count: gaps.rows.length, spend: gaps.spend, share: gaps.share, rows: gaps.rows as NamingGapRow[] };

  return {
    content,
    funnel: { rows: funnelRows, notes: fb.notes },
    funnelProducts,
    naming,
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
    ...qualityOf(total),
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
    ...qualityOf(a),
  };
}

// ตัวชี้ขาด: คนตอบจริง / ROAS / conversion / basket
function qualityOf(a: Acc) {
  return {
    replies: a.replies,
    replyRate: a.results > 0 ? round2((a.replies / a.results) * 100) : 0,
    cpReply: a.replies > 0 ? round2(a.spend / a.replies) : 0,
    purchases: a.purchases,
    revenue: round2(a.revenue),
    roas: a.spend > 0 ? round2(a.revenue / a.spend) : 0,
    convRate: a.results > 0 ? round2((a.purchases / a.results) * 100) : 0,
    basket: a.purchases > 0 ? round2(a.revenue / a.purchases) : 0,
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

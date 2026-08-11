"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import type { Metrics, MetricKey, AccountTotal, TopAd } from "@/lib/types";
import { GROUPS, type GroupDef } from "@/lib/groups";
import { decideAd, buildScope, actionWeight, ROAS_SCALE, ROAS_OK, ROAS_BREAKEVEN, type Decision, type DecideScope } from "@/lib/decide";

const PLATFORMS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "meta", label: "Meta" },
  { key: "tiktok", label: "TikTok" },
] as const;

const PRODUCT_COLORS = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#22c55e", "#64748b"];

/** ชื่อที่โชว์ในตาราง — ทีมยิง 1:1:3 ตั้งชื่อแอดในชุดเหมือนกันเป๊ะ
 *  พอ dashboard แยกราย ad_id แล้ว user จะเห็นชื่อเดียวกันหลายบรรทัด
 *  ต่อท้ายด้วย ad_id 6 ตัวสุดท้าย เพราะเอาไปค้นใน Ads Manager ได้จริง */
function adDisplay(a: { adName?: string; adId?: string; nameDupes?: number }): string {
  const name = a.adName || "(ไม่มีชื่อ)";
  if (!a.nameDupes || a.nameDupes <= 1) return name;
  return a.adId ? `${name}  …${a.adId.slice(-6)}` : name;
}

const PRESETS = [
  { key: "today", label: "วันนี้" },
  { key: "yesterday", label: "เมื่อวาน" },
  { key: "last_7d", label: "7 วัน" },
  { key: "last_14d", label: "14 วัน" },
  { key: "last_30d", label: "30 วัน" },
  { key: "this_month", label: "เดือนนี้" },
];

const METRICS: { key: MetricKey; label: string; money: boolean; lowerBetter?: boolean }[] = [
  { key: "spend", label: "ค่าใช้จ่าย", money: true },
  { key: "roas", label: "ROAS ⭐", money: false },
  { key: "revenue", label: "ยอดขาย", money: true },
  { key: "replies", label: "คนตอบจริง ⭐", money: false },
  { key: "cpReply", label: "ต้นทุน/คนตอบ", money: true, lowerBetter: true },
  { key: "replyRate", label: "% ตอบกลับ", money: false },
  { key: "purchases", label: "ออเดอร์", money: false },
  { key: "convRate", label: "% ปิดการขาย", money: false },
  { key: "basket", label: "Basket size", money: true },
  { key: "results", label: "ทัก (ดิบ)", money: false },
  { key: "cpr", label: "ต้นทุน/ทัก", money: true, lowerBetter: true },
  { key: "cpm", label: "CPM", money: true, lowerBetter: true },
  { key: "reach", label: "Reach", money: false },
  { key: "impressions", label: "Impressions", money: false },
];

const nInt = (n: number) => (n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const nMoney = (n: number) => (n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMetric = (v: number, money: boolean) => (money ? "฿" + nMoney(v) : nInt(v));

const DEFAULT_GROUPS_JSON = JSON.stringify(GROUPS);

// เส้นสเกล ROAS — นิยามอยู่ที่ lib/decide.ts ที่เดียว (ตอนนี้ 3.5 ตามที่ user กำหนด)
const KPI_ROAS = ROAS_SCALE;

// ─── เทียบงวด + สถานะเป้า/ธงตัดสินใจ ─────────────────────────────────
function Delta({ cur, prev, lowerBetter }: { cur: number; prev?: number; lowerBetter?: boolean }) {
  if (prev === undefined || prev === null || prev === 0) return null;
  const d = (cur - prev) / prev;
  if (!isFinite(d)) return null;
  if (Math.abs(d) < 0.005) return <span className="delta flat">≈0%</span>;
  const up = d > 0;
  const good = lowerBetter ? !up : up;
  return <span className={`delta ${good ? "good" : "bad"}`}>{up ? "▲" : "▼"}{Math.abs(d * 100).toFixed(0)}%</span>;
}
// สถานะ CPR เทียบเป้า → เขียว/เหลือง/แดง
function cprStatus(cpr: number, target?: number): "good" | "warn" | "bad" | "" {
  if (!target || !cpr) return "";
  if (cpr <= target) return "good";
  if (cpr > target * 1.3) return "bad";
  return "warn";
}
// % คนกลับมาตอบ — ต่ำ = แชทผีเยอะ (เกณฑ์จาก user: 60%+ ปกติ, <40% ผิดปกติ)
function replyStatus(rate: number): "good" | "warn" | "bad" | "" {
  if (!rate) return "";
  if (rate >= 60) return "good";
  if (rate >= 40) return "warn";
  return "bad";
}
// ROAS — เส้นเดียวกับธง: ≥3.5 สเกลได้ · 2-3.5 เริ่มแย่ · 1-2 ลดงบ · <1 ขาดทุน
function roasStatus(r: number): "good" | "warn" | "poor" | "bad" | "" {
  if (!r) return "";
  if (r >= ROAS_SCALE) return "good";
  if (r >= ROAS_OK) return "warn";
  if (r >= ROAS_BREAKEVEN) return "poor";
  return "bad";
}

// ธงตัดสินใจต่อ ad — logic อยู่ที่ lib/decide.ts (ROAS นำ, ค่าทักไม่ใช่ตัวตัดสินแล้ว)
// wrapper นี้แค่ผูก ad กับ scope ของชุดข้อมูลที่กำลังดูอยู่
function decide(a: TopAd, scope: DecideScope, target?: number): Decision | null {
  return decideAd(
    { spend: a.spend, results: a.results, replies: a.replies, revenue: a.revenue, roas: a.roas, cpReply: a.cpReply, cpr: a.cpr, adName: a.adName, activeDays: a.activeDays },
    { kpiRoas: scope.kpiRoas, avgCpReply: scope.avgCpReply, peerHasRevenue: scope.groupsWithRevenue.has(a.group), target }
  );
}

// ─── เรียงตาราง (คลิกหัวคอลัมน์) ─────────────────────────────────────
type SortState = { key: string; dir: 1 | -1 };

function sortRows<T>(rows: T[], sort: SortState, getVal: (r: T, key: string) => number | string): T[] {
  return [...rows].sort((a, b) => {
    const va = getVal(a, sort.key);
    const vb = getVal(b, sort.key);
    if (typeof va === "string" || typeof vb === "string") return sort.dir * String(va).localeCompare(String(vb), "th");
    return sort.dir * (va - vb);
  });
}

// คลิกคอลัมน์ใหม่ = มากไปน้อย, คลิกซ้ำ = สลับทิศ
function SortTh({ label, col, sort, setSort, style }: {
  label: ReactNode; col: string; sort: SortState; setSort: (s: SortState) => void; style?: CSSProperties;
}) {
  const active = sort.key === col;
  const toggle = () => setSort(active ? { key: col, dir: (sort.dir * -1) as 1 | -1 } : { key: col, dir: -1 });
  return (
    <th className="sortable" onClick={toggle} style={style}>
      {label}<span className="arr">{active ? (sort.dir === -1 ? " ▼" : " ▲") : ""}</span>
    </th>
  );
}

const accGetVal = (a: AccountTotal, key: string): number | string => {
  if (key === "name") return a.name.toLowerCase();
  if (key === "platform") return a.platform;
  if (key.startsWith("g:")) return a.byGroup[key.slice(2)] || 0;
  return (a as any)[key] ?? 0;
};
const adGetVal = (a: TopAd, key: string): number | string => {
  if (key === "adName") return (a.adName || "").toLowerCase();
  if (key === "group") return a.group;
  if (key === "accountName") return (a.accountName || "").toLowerCase();
  return (a as any)[key] ?? 0;
};

export default function Dashboard() {
  const [platform, setPlatform] = useState<"all" | "meta" | "tiktok">("all");
  const [preset, setPreset] = useState("last_14d");
  const [cardView, setCardViewRaw] = useState<"group" | "product" | "funnel">("group");
  const setCardView = (v: "group" | "product" | "funnel") => { setCardViewRaw(v); try { localStorage.setItem("cardView", v); } catch {} };
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [metric, setMetric] = useState<MetricKey>("spend");
  const [auto, setAuto] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [groupsCfg, setGroupsCfg] = useState<GroupDef[]>(GROUPS);
  const [editOpen, setEditOpen] = useState(false);
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [acctFilter, setAcctFilter] = useState<string[]>([]);
  const [acctOpen, setAcctOpen] = useState(false);
  const [brand, setBrand] = useState<{ name?: string; logo?: string }>({});
  const [allAccounts, setAllAccounts] = useState<{ id: string; name: string }[]>([]);
  const [accSort, setAccSort] = useState<SortState>({ key: "spend", dir: -1 });
  const [adSort, setAdSort] = useState<SortState>({ key: "spend", dir: -1 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // อ่าน state จาก URL เสร็จหรือยัง — กัน fetch ยิงด้วยค่าเริ่มต้นแข่งกับค่าจริง
  const [urlReady, setUrlReady] = useState(false);
  // ลำดับคำขอ — ผลที่มาช้ากว่าคำขอล่าสุดให้ทิ้ง (กันผลเก่าทับผลใหม่)
  const reqSeq = useRef(0);

  // อ่าน state จาก URL (รองรับลิงก์แชร์) + localStorage groups
  useEffect(() => {
    const u = new URL(window.location.href);
    const p = u.searchParams.get("platform");
    const pr = u.searchParams.get("preset");
    const m = u.searchParams.get("metric");
    if (p === "all" || p === "meta" || p === "tiktok") setPlatform(p);
    if (pr) setPreset(pr);
    const cv = localStorage.getItem("cardView");
    if (cv === "product" || cv === "group" || cv === "funnel") setCardViewRaw(cv);
    const qs2 = u.searchParams.get("since");
    const qu2 = u.searchParams.get("until");
    if (qs2 && qu2) { setCustomSince(qs2); setCustomUntil(qu2); }
    if (m) setMetric(m as MetricKey);
    if (u.searchParams.get("ro") === "1") setReadOnly(true);
    const acc = u.searchParams.get("accounts");
    if (acc) setAcctFilter(acc.split(",").filter(Boolean));
    const bn = u.searchParams.get("brand");
    const lg = u.searchParams.get("logo");
    if (bn || lg) setBrand({ name: bn || undefined, logo: lg || undefined });
    // กติกากลุ่ม: URL (ลิงก์แชร์) มาก่อน แล้วค่อย localStorage ของเครื่องนี้
    const gp = u.searchParams.get("groups");
    try {
      if (gp) setGroupsCfg(JSON.parse(gp));
      else {
        const saved = localStorage.getItem("ads-groups");
        if (saved) setGroupsCfg(JSON.parse(saved));
      }
    } catch { /* ignore */ }
    setUrlReady(true); // ← ปลดล็อกให้ load() ยิงได้ (ต้องอยู่บรรทัดสุดท้ายเสมอ)
  }, []);

  // ธีม (จำใน localStorage)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ads-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("ads-theme", theme); } catch { /* ignore */ }
  }, [theme]);

  const groupsParam = useMemo(() => {
    const j = JSON.stringify(groupsCfg);
    return j === DEFAULT_GROUPS_JSON ? "" : j;
  }, [groupsCfg]);

  const load = useCallback(async () => {
    // ยังไม่ได้อ่านค่าจาก URL = อย่าเพิ่งยิง
    // ไม่งั้นจะยิงด้วย state เริ่มต้น (14 วัน / ไม่กรองบัญชี) แข่งกับตัวที่ถูกต้อง
    // แล้วตัวที่ตอบกลับทีหลังชนะ → ลิงก์แชร์ที่ล็อกบัญชีให้ลูกค้าอาจโชว์ทุกบัญชี
    if (!urlReady) return;
    const seq = ++reqSeq.current;
    try {
      setErr(null);
      const custom = customSince && customUntil;
      const qs = new URLSearchParams({ platform, preset: custom ? "custom" : preset });
      if (custom) { qs.set("since", customSince); qs.set("until", customUntil); }
      if (groupsParam) qs.set("groups", groupsParam);
      if (acctFilter.length) qs.set("accounts", acctFilter.join(","));
      const res = await fetch(`/api/metrics?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (seq !== reqSeq.current) return; // มีคำขอใหม่กว่าแล้ว — ทิ้งผลเก่า
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      if (seq !== reqSeq.current) return;
      setErr(e.message || String(e));
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [urlReady, platform, preset, customSince, customUntil, groupsParam, acctFilter]);

  useEffect(() => { if (urlReady) { setLoading(true); load(); } }, [load, urlReady]);

  // จำรายชื่อบัญชีทั้งหมด (ตอนยังไม่กรอง) ไว้ให้ตัวเลือกเล่มรายงาน
  useEffect(() => {
    if (data && acctFilter.length === 0) setAllAccounts(data.accounts.map((a) => ({ id: a.id, name: a.name })));
  }, [data, acctFilter.length]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (auto) timer.current = setInterval(load, 15000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auto, load]);

  const groups = data?.groups ?? [];
  const mMeta = METRICS.find((m) => m.key === metric)!;
  const groupVal = (g: any) => (g[metric] as number) || 0;
  const maxVal = Math.max(1, ...groups.map(groupVal));
  // เมตริก "ยิ่งน้อยยิ่งดี" (CPR/CPM) ที่เป็น 0 = ไม่มีข้อมูล → โชว์ "–"
  const showVal = (v: number) => (mMeta.lowerBetter && !v ? "–" : fmtMetric(v, mMeta.money));

  const sortedAccounts = useMemo(() => (data ? sortRows(data.accounts, accSort, accGetVal) : []), [data, accSort]);
  const sortedTopAds = useMemo(() => (data ? sortRows(data.topAds, adSort, adGetVal) : []), [data, adSort]);

  // ภาพรวมที่เครื่องตัดสินใจต้องรู้ก่อนตัดสินรายตัว (ROAS เป้า / ต้นทุนต่อคนตอบเฉลี่ย / กลุ่มไหนมียอดขายจริง)
  // "กลุ่มไหนมียอดขาย" ดูจาก groups ทั้งชุด ไม่ใช่แค่ topAds 25 ตัว — ไม่งั้นแอดที่หลุด cap จะทำให้อ่านว่า tracking พัง
  const scope: DecideScope = useMemo(
    () =>
      buildScope(
        (data?.groups ?? []).map((g) => ({ group: String(g.key), revenue: g.revenue })),
        { cpReply: data?.cpReply ?? 0 },
        KPI_ROAS
      ),
    [data]
  );

  // topAds ถูก cap ที่ 25 ตัว — ถ้าครอบไม่ถึงยอดรวมต้องบอกให้รู้ (กันอ่านว่า "นี่คือทั้งหมด")
  const adsCoverage = useMemo(() => {
    if (!data?.topAds?.length || !data.spend) return 1;
    return data.topAds.reduce((s, a) => s + a.spend, 0) / data.spend;
  }, [data]);

  const shareLink = async () => {
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set("platform", platform);
    if (customSince && customUntil) { u.searchParams.set("since", customSince); u.searchParams.set("until", customUntil); }
    else u.searchParams.set("preset", preset);
    u.searchParams.set("metric", metric);
    u.searchParams.set("ro", "1");
    if (groupsParam) u.searchParams.set("groups", groupsParam); // พกกติกากลุ่มที่แก้ไปด้วย
    if (acctFilter.length) u.searchParams.set("accounts", acctFilter.join(",")); // เล่มรายงาน = ชุดบัญชี
    if (brand.name) u.searchParams.set("brand", brand.name);
    if (brand.logo) u.searchParams.set("logo", brand.logo);
    // แนบ signed sig — คนรับเปิดได้เลยไม่ต้องรู้รหัส (เปลี่ยนรหัส = ลิงก์เก่าตาย)
    try {
      const { share } = await fetch("/api/share").then((r) => r.json());
      if (share) u.searchParams.set("share", share);
    } catch { /* ไม่มี sig ก็แชร์แบบต้องใส่รหัสได้ */ }
    navigator.clipboard.writeText(u.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const exportCSV = () => {
    if (!data) return;
    const gk = groups.map((g) => g.label);
    const head = ["บัญชี", "แพลตฟอร์ม", ...gk.map((l) => l + " (spend)"), "รวม spend", "ผลลัพธ์", "CPR", "CPM", "reach"];
    const lines = [head.join(",")];
    for (const a of data.accounts) {
      const row = [
        `"${a.name}"`, a.platform,
        ...groups.map((g) => a.byGroup[g.key] || 0),
        a.spend, a.results, a.cpr, a.cpm, a.reach,
      ];
      lines.push(row.join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ads-groups-${preset}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>
            {brand.logo ? <img className="brand-logo" src={brand.logo} alt="" /> : null}
            {brand.name || "Ads Group Dashboard"}{" "}
            {data && <span className={`badge ${data.source}`}>{data.source.toUpperCase()}</span>}
            {readOnly && <span className="badge ro">READ-ONLY</span>}
          </h1>
          <div className="sub">
            ค่าโฆษณาแบ่งตามกลุ่มชื่อ ads · {groupsCfg.map((g) => g.label).join(" / ")}
            {data && <> · {data.since} → {data.until}</>}
            {data?.source === "demo" && (
              <span className="warn-inline"> · demo: ช่วงเวลายังคงที่ (ปรับได้จริงตอน LIVE)</span>
            )}
          </div>
        </div>
        {!readOnly && (
          <div className="controls no-print">
            <div className="seg">
              {PLATFORMS.map((p) => (
                <button key={p.key} className={platform === p.key ? "active" : ""} onClick={() => setPlatform(p.key)}>{p.label}</button>
              ))}
            </div>
            <div className="seg">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={preset === p.key && !(customSince && customUntil) ? "active" : ""}
                  onClick={() => { setPreset(p.key); setCustomSince(""); setCustomUntil(""); }}
                >{p.label}</button>
              ))}
            </div>
            <div className="daterange" title="เลือกช่วงวันที่เอง">
              <input type="date" value={customSince} max={customUntil || undefined}
                onChange={(e) => setCustomSince(e.target.value)} />
              <span>–</span>
              <input type="date" value={customUntil} min={customSince || undefined}
                onChange={(e) => setCustomUntil(e.target.value)} />
              {(customSince || customUntil) && (
                <button className="linkbtn" title="ล้างช่วงวันที่"
                  onClick={() => { setCustomSince(""); setCustomUntil(""); }}>✕</button>
              )}
            </div>
            <label className="toggle"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />auto 15s</label>
            <button className="btn" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} title="สลับธีม สว่าง/มืด">{theme === "dark" ? "☀︎" : "☾"}</button>
            <button className="btn" onClick={load}>↻</button>
            <button className="btn" onClick={() => setEditOpen((v) => !v)}>⚙︎ กลุ่ม</button>
            <div className="acct-wrap">
              <button className="btn" onClick={() => setAcctOpen((v) => !v)}>⛃ บัญชี{acctFilter.length ? ` (${acctFilter.length})` : ""}</button>
              {acctOpen && (
                <div className="acct-pop">
                  <div className="acct-head">
                    <strong>เล่มรายงาน — เลือกบัญชี</strong>
                    <button className="linkbtn" onClick={() => setAcctFilter([])}>ทั้งหมด</button>
                  </div>
                  {(allAccounts.length ? allAccounts : (data?.accounts ?? [])).map((a) => {
                    const on = acctFilter.length === 0 || acctFilter.includes(a.id);
                    return (
                      <label key={a.id} className="acct-item">
                        <input type="checkbox" checked={on} onChange={(e) => {
                          const full = (allAccounts.length ? allAccounts : (data?.accounts ?? [])).map((x) => x.id);
                          const base = acctFilter.length ? acctFilter : full;
                          const next = e.target.checked ? Array.from(new Set([...base, a.id])) : base.filter((id) => id !== a.id);
                          setAcctFilter(next.length === full.length ? [] : next);
                        }} />
                        {a.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <button className="btn" onClick={exportCSV}>⬇︎ CSV</button>
            <a className="btn primary" href="/brief" title="วันนี้เป็นไง พรุ่งนี้ scale/หยุด/clone อะไร">📋 แผนพรุ่งนี้</a>
            <a className="btn" href="/digest" title="สรุปรายสัปดาห์ 5 หัวข้อ">📅 Digest</a>
            <button className="btn" onClick={() => window.print()}>🖨 PDF</button>
            <button className="btn" onClick={shareLink}>{copied ? "✓ คัดลอกแล้ว" : "🔗 แชร์"}</button>
            <button className="btn" onClick={async () => { await fetch("/api/logout", { method: "POST" }); window.location.href = "/login"; }} title="ออกจากระบบ">⎋ ออก</button>
          </div>
        )}
      </header>

      {!readOnly && editOpen && (
        <GroupEditor
          groups={groupsCfg}
          onSave={(g) => { setGroupsCfg(g); localStorage.setItem("ads-groups", JSON.stringify(g)); setEditOpen(false); }}
          onReset={() => { setGroupsCfg(GROUPS); localStorage.removeItem("ads-groups"); setEditOpen(false); }}
          onClose={() => setEditOpen(false)}
        />
      )}

      {/* เลือกเมตริกที่จะโชว์บนการ์ด/บาร์ */}
      <div className="metric-bar no-print">
        <span className="metric-lbl">แสดงเมตริก:</span>
        <div className="seg">
          {METRICS.map((m) => (
            <button key={m.key} className={metric === m.key ? "active" : ""} onClick={() => setMetric(m.key)}>{m.label}</button>
          ))}
        </div>
      </div>

      {data?.accountIssues && data.accountIssues.length > 0 && (
        <div className="warn issue">
          🚩 <strong>{data.accountIssues.length} บัญชีดึงข้อมูลไม่ได้</strong> (ยอดอาจขาด):{" "}
          {data.accountIssues.map((a) => `${a.name} [${a.status}]`).join(" · ")}
        </div>
      )}
      {data?.warnings?.map((w, i) => <div className="warn" key={i}>⚠️ {w}</div>)}
      {/* สุขภาพข้อมูล — บอกก่อนว่าเลขไหนยังเชื่อไม่ได้ ดีกว่าให้ไปเจอตอนตัดสินใจไปแล้ว */}
      {data?.quality?.notes?.map((n, i) => <div className="warn issue" key={"q" + i}>🧪 {n}</div>)}
      {err && <div className="warn">❌ {err}</div>}

      {loading && !data ? (
        <div className="loading">กำลังโหลด…</div>
      ) : data ? (
        <>
          {/* 🎯 สรุปคำแนะนำอัตโนมัติ — ROAS เป็นตัวตัดสิน ไม่ใช่ค่าทัก
              เรียง "ปิด" ตามเงินที่ติดลบจริง (spend−revenue) ไม่ใช่ตามยอดใช้จ่าย */}
          {(() => {
            const recs = data.topAds
              .map((a) => {
                const g = data.groups.find((x) => x.key === a.group);
                return { a, g, dec: decide(a, scope, g?.target) };
              })
              .filter((r) => r.dec);
            const close = recs
              .filter((r) => r.dec!.cls === "bad" || r.dec!.cls === "poor")
              .sort((x, y) => actionWeight(y.dec!, y.a.spend, y.a.revenue) - actionWeight(x.dec!, x.a.spend, x.a.revenue))
              .slice(0, 4);
            const scale = recs.filter((r) => r.dec!.cls === "good").sort((x, y) => y.a.roas - x.a.roas).slice(0, 3);
            const fix = recs
              .filter((r) => r.dec!.cls === "fix")
              .sort((x, y) => y.a.spend - x.a.spend)
              .slice(0, 2);
            if (!close.length && !scale.length && !fix.length) return null;
            const pill = (r: (typeof recs)[0], key: string) => (
              <span className={"reco pill " + r.dec!.cls} key={key} title={`${r.a.adName}${r.a.adId ? ` · ad_id ${r.a.adId}` : ""} · ${r.a.accountName}\n${r.dec!.why}`}>
                {r.dec!.label} <b>{adDisplay(r.a)}</b> <em className="reco-acct">@{r.a.accountName}</em>{" "}
                <small>{r.dec!.why}</small>
              </span>
            );
            return (
              <div className="reco-bar">
                <span className="reco-title">🎯 แนะนำ</span>
                {close.map((r, i) => pill(r, "c" + i))}
                {scale.map((r, i) => pill(r, "s" + i))}
                {fix.map((r, i) => pill(r, "f" + i))}
              </div>
            );
          })()}
          {adsCoverage < 0.9 && (
            <div className="warn">
              ⚠️ ตาราง/คำแนะนำด้านล่างอ่านจาก <strong>Top 25 ads</strong> ซึ่งครอบแค่{" "}
              <strong>{(adsCoverage * 100).toFixed(0)}%</strong> ของค่าใช้จ่ายทั้งหมด — อีก{" "}
              {(100 - adsCoverage * 100).toFixed(0)}% (฿{nInt(data.spend * (1 - adsCoverage))}) กระจายอยู่ในแอดตัวเล็ก
              ที่ยังไม่ถูกประเมิน · อยากเห็นครบให้กรองทีละบัญชี
            </div>
          )}
          {/* สลับมุมมองการ์ด: กลุ่มตาม prefix ↔ แยกตามสินค้า (1 Cut / Cart / Ultra / GPT St.) */}
          {data.content?.products && data.content.products.length > 1 && (
            <div className="view-switch no-print">
              <span className="hint">ดูการ์ดตาม:</span>
              <div className="seg">
                <button className={cardView === "group" ? "active" : ""} onClick={() => setCardView("group")}>กลุ่ม (prefix)</button>
                <button className={cardView === "product" ? "active" : ""} onClick={() => setCardView("product")}>สินค้า</button>
                {data.funnel && data.funnel.rows.length > 0 && (
                  <button className={cardView === "funnel" ? "active" : ""} onClick={() => setCardView("funnel")}>ชั้น funnel</button>
                )}
              </div>
            </div>
          )}

          <div className="cards">
            <div className="card" style={{ ["--c" as any]: "#3b82f6" }}>
              <div className="k">รวมทั้งหมด</div>
              <div className="v">{showVal((data as any)[metric] || 0)}</div>
              <div className="m"><Delta cur={(data as any)[metric] || 0} prev={(data.prev as any)?.[metric]} lowerBetter={mMeta.lowerBetter} /> {data.accounts.length} บัญชี · {mMeta.label}</div>
            </div>
            {cardView === "funnel" && data.funnel
              ? data.funnel.rows.map((r) => (
                  <div className="card" key={r.stage} style={{ ["--c" as any]: r.color }}>
                    <div className="k"><span className="dot" />{r.label}</div>
                    <div className={"v " + (metric === "roas" ? roasStatus(r.roas) : "")}>{showVal((r as any)[metric] ?? r.spend)}</div>
                    <div className="m">
                      ฿{nInt(r.spend)} · {(r.share * 100).toFixed(0)}% · {r.ads} ads · ROAS {r.roas ? r.roas.toFixed(2) : "–"}
                      {r.assumedAds > 0 && <> · <span className="warn-inline">ชื่อไม่บอกกลุ่ม {r.assumedAds} ตัว</span></>}
                    </div>
                  </div>
                ))
              : cardView === "product" && data.content?.products
              ? data.content.products.map((p, i) => (
                  <div className="card" key={p.key} style={{ ["--c" as any]: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }}>
                    <div className="k"><span className="dot" />{p.key}</div>
                    <div className="v">{showVal((p as any)[metric] ?? p.spend)}</div>
                    <div className="m">฿{nInt(p.spend)} · {p.ads} ads · ทัก {nInt(p.results)}{p.cpr ? ` · ฿${nMoney(p.cpr)}/ทัก` : ""}</div>
                  </div>
                ))
              : groups.map((g) => (
                  <div className="card" key={g.key} style={{ ["--c" as any]: g.color }}>
                    <div className="k"><span className="dot" />{g.label}</div>
                    <div className={"v " + (metric === "cpr" ? cprStatus(g.cpr, g.target) : "")}>{showVal(groupVal(g))}</div>
                    <div className="m">
                      {metric === "spend" && <><Delta cur={g.spend} prev={data.prev?.byGroup?.[g.key]} /> </>}
                      {metric === "cpr" && g.target ? `เป้า ฿${g.target} · ` : ""}
                      ฿{nInt(g.spend)} · {g.ads} ads{g.resultType ? ` · ${g.resultType}` : ""}
                    </div>
                  </div>
                ))}
          </div>

          <div className="panel">
            <h2>{mMeta.label}ต่อกลุ่ม<span className="hint">เรียงตามชื่อ ads (prefix){mMeta.lowerBetter ? " · ยิ่งน้อยยิ่งดี" : ""}</span></h2>
            {groups.map((g) => (
              <div className="bar-row" key={g.key}>
                <div className="lbl">{g.label}</div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(groupVal(g) / maxVal) * 100}%`, background: g.color }} />
                </div>
                <div className={"amt " + (metric === "cpr" ? cprStatus(g.cpr, g.target) : "")}>{showVal(groupVal(g))}{metric === "spend" && <span className="pct">{(g.share * 100).toFixed(1)}%</span>}</div>
              </div>
            ))}
          </div>

          <TrendChart data={data} groups={groups} />

          {/* 🔺 funnel — งบกองอยู่ชั้นไหน · สินค้าไหนขาดชั้นไหน · ใครยังตั้งชื่อไม่ครบ */}
          <FunnelPanel data={data} />
          {data.funnel && data.funnel.rows.length > 0 && (
            <TrendChart data={data} groups={data.funnel.rows.map((r) => ({ key: r.stage, label: r.label, color: r.color }))} dim="funnel" share />
          )}
          <FunnelProductPanel data={data} />
          <NamingPanel data={data} />

          <div className="panel">
            <h2>แยกรายบัญชี<span className="hint">{data.accounts.length} บัญชี · spend ต่อกลุ่ม · คลิกหัวคอลัมน์เพื่อเรียง</span></h2>
            <div className="tbl-scroll">
              <table>
                <thead>
                  <tr>
                    <SortTh label="บัญชี" col="name" sort={accSort} setSort={setAccSort} />
                    <SortTh label="แพลตฟอร์ม" col="platform" sort={accSort} setSort={setAccSort} />
                    {groups.map((g) => <SortTh key={g.key} label={g.label} col={`g:${g.key}`} sort={accSort} setSort={setAccSort} />)}
                    <SortTh label="รวม" col="spend" sort={accSort} setSort={setAccSort} />
                    <SortTh label="ทัก" col="results" sort={accSort} setSort={setAccSort} />
                    <SortTh label="ตอบจริง" col="replies" sort={accSort} setSort={setAccSort} />
                    <SortTh label="%ตอบ" col="replyRate" sort={accSort} setSort={setAccSort} />
                    <SortTh label="฿/คนตอบ" col="cpReply" sort={accSort} setSort={setAccSort} />
                    <SortTh label="ROAS" col="roas" sort={accSort} setSort={setAccSort} />
                    <th style={{ width: 120 }}>สัดส่วน</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAccounts.map((a) => (
                    <tr key={a.platform + a.id}>
                      <td className="name-cell">{a.name}</td>
                      <td>{a.platform}</td>
                      {groups.map((g) => <td key={g.key}>{a.byGroup[g.key] ? nInt(a.byGroup[g.key]) : "–"}</td>)}
                      <td><strong>฿{nInt(a.spend)}</strong></td>
                      <td>{nInt(a.results)}</td>
                      <td className={a.replies ? "good" : ""}>{nInt(a.replies)}</td>
                      <td className={replyStatus(a.replyRate)}>{a.replyRate ? a.replyRate.toFixed(0) + "%" : "–"}</td>
                      <td><b>{a.cpReply ? "฿" + nMoney(a.cpReply) : "–"}</b></td>
                      <td className={roasStatus(a.roas)}>{a.roas ? a.roas.toFixed(2) : "–"}</td>
                      <td>
                        <div className="stack">
                          {groups.map((g) => a.byGroup[g.key] > 0 ? (
                            <span key={g.key} style={{ width: `${(a.byGroup[g.key] / a.spend) * 100}%`, background: g.color }} title={`${g.label}: ฿${nInt(a.byGroup[g.key])}`} />
                          ) : null)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 🎨 วิเคราะห์ Content Ads — มุมคอนเทนต์ × กลุ่มเป้าหมาย (แกะจากชื่อแอด) */}
          {data.content && (data.content.themes.length > 1 || data.content.audiences.length > 1) && (
            <div className="panel">
              <h2>🎨 Content Ads<span className="hint">แกะจากชื่อแอด — มุมไหน/กลุ่มไหน<b>ทำเงิน</b> · ตัดจาก ROAS เป้า {KPI_ROAS} (ค่าทักไว้ดูประกอบ)</span></h2>
              <div className="content-grid">
                {([["มุมคอนเทนต์", data.content.themes], ["กลุ่มเป้าหมาย", data.content.audiences]] as const).map(([title, dims]) => (
                  <div key={title}>
                    <div className="content-sub">{title}</div>
                    <table className="mini">
                      <thead><tr><th>{title}</th><th>spend</th><th>ROAS</th><th>ค่าทัก</th><th></th></tr></thead>
                      <tbody>
                        {dims.map((t) => {
                          // ตัดจาก ROAS เหมือนธงที่อื่น — ค่าทักถูกไม่ได้แปลว่ามุมนี้ขายได้
                          // ไม่มียอดขายเลย → บอกว่า "ยังไม่มียอด" ไม่ใช่ตัดสินว่าแพง/ถูก
                          const [cls, tag] = !t.revenue
                            ? (t.spend > 0 ? ["fix", "⚫ ยังไม่มียอด"] : ["", "–"])
                            : t.roas >= ROAS_SCALE ? ["good", "🟢 อัดต่อ"]
                            : t.roas >= ROAS_OK ? ["warn", "🟡 เริ่มแย่"]
                            : t.roas >= ROAS_BREAKEVEN ? ["poor", "🟠 ลดงบ"]
                            : ["bad", "🔴 ขาดทุน"];
                          return (
                            <tr key={t.key} title={t.revenue ? `฿${nInt(t.spend)} → ฿${nInt(t.revenue)}` : `ใช้ ฿${nInt(t.spend)} ยังไม่มียอดขายเข้าระบบ`}>
                              <td className="name-cell">{t.key} <small className="hint">({t.ads} ads)</small></td>
                              <td>฿{nInt(t.spend)}</td>
                              <td className={roasStatus(t.roas)}>{t.roas ? t.roas.toFixed(2) : "–"}</td>
                              <td>{t.cpr ? "฿" + nMoney(t.cpr) : "–"}</td>
                              <td><span className={"pill " + cls}>{tag}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 🏦 แยกราย ad account — บัญชีไหนมีตัวไหนควรไปต่อ / พอแค่นี้ */}
          {(() => {
            const byAcct = new Map<string, TopAd[]>();
            for (const a of data.topAds) {
              const k = a.accountName || "(ไม่ระบุบัญชี)";
              (byAcct.get(k) || byAcct.set(k, []).get(k)!).push(a);
            }
            const accts = [...byAcct.entries()]
              .map(([name, ads]) => {
                const spend = ads.reduce((s, a) => s + a.spend, 0);
                const results = ads.reduce((s, a) => s + a.results, 0);
                const revenue = ads.reduce((s, a) => s + a.revenue, 0);
                const rated = ads.map((a) => {
                  const g = data.groups.find((x) => x.key === a.group);
                  return { a, target: g?.target, dec: decide(a, scope, g?.target) };
                });
                const go = rated.filter((r) => r.dec?.cls === "good").sort((x, y) => y.a.roas - x.a.roas);
                const stop = rated
                  .filter((r) => r.dec?.cls === "bad" || r.dec?.cls === "poor" || r.dec?.cls === "fix")
                  .sort((x, y) => actionWeight(y.dec!, y.a.spend, y.a.revenue) - actionWeight(x.dec!, x.a.spend, x.a.revenue));
                return { name, spend, revenue, roas: spend ? revenue / spend : 0, results, cpr: results ? spend / results : 0, go, stop, total: ads.length };
              })
              .filter((x) => x.spend > 0)
              .sort((x, y) => y.spend - x.spend);
            if (accts.length === 0) return null;
            return (
              <div className="panel">
                <h2>🏦 แยกราย Ad Account<span className="hint">บัญชีไหน · ตัวไหนไปต่อ 🟢 / พอแค่นี้ 🔴 · ตัดสินจาก ROAS · เรียงตามค่าใช้จ่าย</span></h2>
                <div className="acct-cards">
                  {accts.map((ac) => (
                    <div className="acct-card" key={ac.name}>
                      <div className="acct-head-row">
                        <strong>{ac.name}</strong>
                        <span className="hint">
                          ฿{nInt(ac.spend)} → ขาย ฿{nInt(ac.revenue)} · <b className={roasStatus(ac.roas)}>ROAS {ac.roas ? ac.roas.toFixed(2) : "–"}</b> · ทัก {nInt(ac.results)} · {ac.total} ads
                        </span>
                      </div>
                      {ac.go.length > 0 && (
                        <div className="acct-list">
                          <span className="acct-tag good">🟢 ไปต่อ</span>
                          {ac.go.slice(0, 4).map((r, i) => (
                            <div className="acct-ad" key={"g" + i} title={r.dec!.why}>
                              <span className="name-cell">{adDisplay(r.a)}</span>
                              <span className="good">ROAS {r.a.roas.toFixed(2)}</span>
                              <small className="hint">฿{nInt(r.a.spend)} → ฿{nInt(r.a.revenue)} · ตอบจริง {r.a.replies}</small>
                            </div>
                          ))}
                        </div>
                      )}
                      {ac.stop.length > 0 && (
                        <div className="acct-list">
                          <span className="acct-tag bad">🔴 พอแค่นี้</span>
                          {ac.stop.slice(0, 4).map((r, i) => (
                            <div className="acct-ad" key={"b" + i} title={r.dec!.why}>
                              <span className="name-cell">{adDisplay(r.a)}</span>
                              <span className={r.dec!.cls}>{r.dec!.cls === "fix" ? "⚫ ไม่รู้ยอด" : r.a.revenue > 0 ? `${r.dec!.cls === "poor" ? "🟠 " : ""}ROAS ${r.a.roas.toFixed(2)}` : "ขาย ๐"}</span>
                              <small className="hint">฿{nInt(r.a.spend)} → ฿{nInt(r.a.revenue)} · ตอบจริง {r.a.replies}</small>
                            </div>
                          ))}
                        </div>
                      )}
                      {ac.go.length === 0 && ac.stop.length === 0 && <div className="hint">— ยังไม่มีตัวที่ชี้ขาด (ข้อมูลน้อย/ยังไม่พ้น learning)</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* 💰 ตัวเลขธุรกิจจริง — กรอกยอดขายช่วงนี้ → %Ads / ROAS / basket / ปิดการขาย */}
          <BizPanel spend={data.spend} results={data.results} since={data.since} until={data.until} readOnly={readOnly} />

          <div className="panel">
            <h2>
              Top ads
              <span className="hint">
                25 อันดับแรก (ตามค่าใช้จ่าย) · คลิกหัวคอลัมน์เพื่อเรียงภายใน 25 ตัว · ธงตัดจาก <b>ROAS · เส้นสเกล {KPI_ROAS}</b>{" "}
                (🟢 ≥{ROAS_SCALE} สเกล · 🟡 {ROAS_OK}–{ROAS_SCALE} เริ่มแย่ · 🟠 {ROAS_BREAKEVEN}–{ROAS_OK} ลดงบ · 🔴 &lt;{ROAS_BREAKEVEN} หรือขาย ๐ ·
                ⚫ ยังไม่มียอดเข้าระบบ · ⏳ ใช้ยังไม่ถึง ฿300) — ชี้ที่ธงเพื่อดูเหตุผล
              </span>
            </h2>
            <div className="tbl-scroll">
              <table>
                <thead>
                  <tr>
                    <SortTh label="ชื่อ ads" col="adName" sort={adSort} setSort={setAdSort} />
                    <SortTh label="กลุ่ม" col="group" sort={adSort} setSort={setAdSort} />
                    <SortTh label="บัญชี" col="accountName" sort={adSort} setSort={setAdSort} />
                    <SortTh label="spend" col="spend" sort={adSort} setSort={setAdSort} />
                    <SortTh label="ทัก" col="results" sort={adSort} setSort={setAdSort} />
                    <SortTh label="ตอบจริง" col="replies" sort={adSort} setSort={setAdSort} />
                    <SortTh label="%ตอบ" col="replyRate" sort={adSort} setSort={setAdSort} />
                    <SortTh label="฿/คนตอบ" col="cpReply" sort={adSort} setSort={setAdSort} />
                    <SortTh label="ROAS" col="roas" sort={adSort} setSort={setAdSort} />
                    <SortTh label="฿/ทัก" col="cpr" sort={adSort} setSort={setAdSort} />
                    <SortTh label="CPM" col="cpm" sort={adSort} setSort={setAdSort} />
                    <th>แนะนำ</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTopAds.map((a, i) => {
                    const g = groups.find((x) => x.key === a.group);
                    const dec = decide(a, scope, g?.target);
                    return (
                      <tr key={i}>
                        <td className="name-cell" title={a.nameDupes && a.nameDupes > 1 ? `${a.adName}\nad_id ${a.adId || "–"}\n⚠️ บัญชีนี้มีแอดชื่อนี้ ${a.nameDupes} ตัว — บรรทัดนี้คือตัวเดียว ไม่ใช่ผลรวมทั้งชุด` : a.adName}>
                          {adDisplay(a)}
                        </td>
                        <td><span className="tag" style={{ background: g?.color }}>{g?.label}</span></td>
                        <td className="name-cell">{a.accountName}</td>
                        <td>฿{nMoney(a.spend)}</td>
                        <td>{nInt(a.results)}</td>
                        <td className={a.replies ? "good" : ""}>{nInt(a.replies)}</td>
                        <td className={replyStatus(a.replyRate)}>{a.replyRate ? a.replyRate.toFixed(0) + "%" : "–"}</td>
                        <td className={a.cpReply ? "" : ""}><b>{a.cpReply ? "฿" + nMoney(a.cpReply) : "–"}</b></td>
                        <td className={roasStatus(a.roas)}>{a.roas ? a.roas.toFixed(2) : "–"}</td>
                        <td className={cprStatus(a.cpr, g?.target)}>{a.cpr ? "฿" + nMoney(a.cpr) : "–"}</td>
                        <td>{a.cpm ? "฿" + nMoney(a.cpm) : "–"}</td>
                        <td>{dec ? <span className={"pill " + dec.cls} title={dec.why}>{dec.label}</span> : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="updated">อัปเดตล่าสุด: {new Date(data.updatedAt).toLocaleString("th-TH")}{auto && " · auto-refresh 15s"}{data.source === "demo" && " · (เทรนด์ = demo)"}</div>
        </>
      ) : null}
    </div>
  );
}

// ─── 💰 ตัวเลขธุรกิจจริง (%Ads / ROAS Inbox) ─────────────────────────
// ค่าทักถูกยังไม่พอ — ต้องรู้ %ค่าแอดเทียบยอดขาย + ปิดการขาย ถึงรู้ว่ากำไรจริง
// กรอกยอดขาย+ออเดอร์ของช่วงที่ดู (จาก CRM/LINE) → เก็บ localStorage ต่อช่วง
function BizPanel({ spend, results, since, until, readOnly }: { spend: number; results: number; since: string; until: string; readOnly: boolean }) {
  const storeKey = `biz:${since}:${until}`;
  const [rev, setRev] = useState("");
  const [orders, setOrders] = useState("");
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storeKey) || "{}");
      setRev(s.rev || ""); setOrders(s.orders || "");
    } catch { setRev(""); setOrders(""); }
  }, [storeKey]);
  const save = (r: string, o: string) => {
    setRev(r); setOrders(o);
    try { localStorage.setItem(storeKey, JSON.stringify({ rev: r, orders: o })); } catch {}
  };
  const revN = parseFloat(rev) || 0;
  const ordN = parseInt(orders) || 0;
  const pctAds = revN > 0 ? (spend / revN) * 100 : 0;
  const roas = revN > 0 && spend > 0 ? revN / spend : 0;
  const basket = ordN > 0 ? revN / ordN : 0;
  const close = ordN > 0 && results > 0 ? (ordN / results) * 100 : 0;
  const pctCls = pctAds === 0 ? "" : pctAds <= 25 ? "good" : pctAds <= 40 ? "warn" : "bad";
  const closeCls = close === 0 ? "" : close >= 35 ? "good" : close >= 20 ? "warn" : "bad";
  return (
    <div className="panel">
      <h2>💰 ธุรกิจจริง<span className="hint">%ค่า Ads เทียบยอดขาย — ค่าทักถูกแต่ %Ads เกิน 100 = ขาดทุน · กรอกยอดจาก CRM ของช่วง {since} → {until}</span></h2>
      <div className="biz-row">
        {!readOnly && (
          <div className="biz-inputs">
            <label>ยอดขายช่วงนี้ (฿)
              <input inputMode="decimal" placeholder="เช่น 150000" value={rev} onChange={(e) => save(e.target.value, orders)} />
            </label>
            <label>จำนวนออเดอร์
              <input inputMode="numeric" placeholder="เช่น 180" value={orders} onChange={(e) => save(rev, e.target.value)} />
            </label>
          </div>
        )}
        <div className="biz-stats">
          <div className={"biz-stat " + pctCls}><div className="k">% ค่า Ads</div><div className="v">{revN ? pctAds.toFixed(1) + "%" : "–"}</div><small>เป้า ≤25%</small></div>
          <div className="biz-stat"><div className="k">ROAS Inbox</div><div className="v">{roas ? roas.toFixed(2) : "–"}</div><small>ยอดขาย ÷ ค่าแอด</small></div>
          <div className="biz-stat"><div className="k">Basket size</div><div className="v">{basket ? "฿" + nInt(basket) : "–"}</div><small>ยอด ÷ ออเดอร์</small></div>
          <div className={"biz-stat " + closeCls}><div className="k">% ปิดการขาย</div><div className="v">{close ? close.toFixed(1) + "%" : "–"}</div><small>ออเดอร์ ÷ ทัก {nInt(results)}</small></div>
        </div>
      </div>
    </div>
  );
}

// ─── กราฟเทรนด์ stacked area ต่อวัน ─────────────────────────────────
// dim = "group" (กลุ่มตาม prefix) หรือ "funnel" (ชั้น TOF/MOF/BOF)
// โหมด funnel มี share=true → โชว์เป็น % ของวัน เพื่อให้เห็นว่า "เดือนนี้เอียงไปทางไหน"
// (ถ้าโชว์เป็นบาท วันที่ใช้งบเยอะจะกลบภาพสัดส่วนหมด)
function TrendChart({ data, groups, dim = "group", share = false }: { data: Metrics; groups: any[]; dim?: "group" | "funnel"; share?: boolean }) {
  const raw = data.series || [];
  if (raw.length === 0) return null;
  const pick = (p: any) => (dim === "funnel" ? p.byFunnel || {} : p.byGroup || {});
  if (dim === "funnel" && !raw.some((p) => p.byFunnel && Object.keys(p.byFunnel).length)) return null;

  const keys = groups.map((g) => g.key);
  // โหมดสัดส่วน: normalize แต่ละวันให้รวมเป็น 100
  const series = share
    ? raw.map((p) => {
        const src = pick(p);
        const tot = keys.reduce((s, k) => s + (src[k] || 0), 0);
        const out: Record<string, number> = {};
        for (const k of keys) out[k] = tot ? ((src[k] || 0) / tot) * 100 : 0;
        return { ...p, _v: out };
      })
    : raw.map((p) => ({ ...p, _v: pick(p) }));

  const W = 960, H = 250, padL = 44, padR = 14, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.length;
  const totals = series.map((p) => keys.reduce((s, k) => s + (p._v[k] || 0), 0));
  const max = Math.max(1, ...totals);
  const X = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const Y = (v: number) => padT + innerH - (v / max) * innerH;

  // ซ้อนกลุ่มจากล่างขึ้นบน (stacked)
  const cum = new Array(n).fill(0);
  const layers = keys.map((k) => {
    const lower = [...cum];
    for (let i = 0; i < n; i++) cum[i] += series[i]._v[k] || 0;
    const upper = [...cum];
    const g = groups.find((x) => x.key === k);
    let area = `M ${X(0)} ${Y(upper[0])}`;
    for (let i = 1; i < n; i++) area += ` L ${X(i)} ${Y(upper[i])}`;
    for (let i = n - 1; i >= 0; i--) area += ` L ${X(i)} ${Y(lower[i])}`;
    area += " Z";
    let line = `M ${X(0)} ${Y(upper[0])}`;
    for (let i = 1; i < n; i++) line += ` L ${X(i)} ${Y(upper[i])}`;
    return { k, color: g?.color as string, area, line };
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: max * f, y: Y(max * f) }));
  const fmtK = (v: number) => (share ? Math.round(v) + "%" : v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(Math.round(v)));
  const xticks = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];
  const uid = dim + (share ? "-s" : "");

  return (
    <div className="panel">
      <h2>
        {dim === "funnel" ? "สัดส่วน funnel รายวัน" : "เทรนด์รายวัน · ค่าใช้จ่าย"}
        {dim === "funnel" && <span className="hint">% ของงบแต่ละวัน — เห็นว่าช่วงนี้เอียงไปหาคนใหม่หรือขุดถังเดิม</span>}
        {raw[0]?.demo && <span className="hint">demo — ประมาณจากยอดรวม (live = รายวันจริง)</span>}
      </h2>
      <div className="tbl-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label={dim === "funnel" ? "กราฟสัดส่วนชั้น funnel รายวัน" : "กราฟเทรนด์ค่าใช้จ่ายรายวันแยกกลุ่ม"}>
          <defs>
            {layers.map((l) => (
              <linearGradient id={`g-${uid}-${l.k}`} key={l.k} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={l.color} stopOpacity="0.45" />
                <stop offset="100%" stopColor={l.color} stopOpacity="0.05" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line className="grid" x1={padL} y1={t.y} x2={W - padR} y2={t.y} />
              <text className="axis" x={padL - 7} y={t.y + 3.5} textAnchor="end">{fmtK(t.v)}</text>
            </g>
          ))}
          {layers.map((l) => <path key={l.k} d={l.area} fill={`url(#g-${uid}-${l.k})`} />)}
          {layers.map((l) => <path key={l.k + "L"} d={l.line} fill="none" stroke={l.color} strokeWidth={1.6} strokeLinejoin="round" />)}
          {!share && <circle className="endpt" cx={X(n - 1)} cy={Y(totals[n - 1])} r={4} fill="var(--accent)" />}
          {xticks.map((i) => (
            <text key={i} className="axis" x={X(i)} y={H - 7} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
              {series[i].date?.slice(5)}
            </text>
          ))}
        </svg>
      </div>
      <div className="legend">
        {groups.map((g) => (
          <span key={g.key} className="leg"><span className="dot" style={{ background: g.color }} />{g.label}</span>
        ))}
        <span className="leg-dates">{series[0]?.date} → {series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ─── 🔺 แผง funnel — งบกองอยู่ชั้นไหน ────────────────────────────────
// ชั้น funnel = "ยิงใส่ใคร" (คนใหม่ / คนอุ่น / คนใกล้ซื้อ) แกะจากชื่อแอด
// ส่วนที่ทึบ = ชื่อบอกกลุ่มไว้จริง · ส่วนลายทาง = ชื่อไม่ได้บอก ตีเป็นปล่อยกว้างตามค่าเริ่มต้น
function FunnelPanel({ data }: { data: Metrics }) {
  const f = data.funnel;
  if (!f || f.rows.length === 0) return null;
  const rows = f.rows;
  const maxShare = Math.max(...rows.map((r) => r.share), 0.01);
  const W = 720, rowH = 54, gap = 10;
  const H = rows.length * (rowH + gap);
  const wOf = (s: number) => Math.max(90, (s / maxShare) * (W - 40));

  return (
    <div className="panel">
      <h2>
        🔺 งบกองอยู่ชั้นไหนของ funnel
        <span className="hint">แกะจากกลุ่มเป้าหมายในชื่อแอด · ลายทาง = ชื่อไม่ได้บอกกลุ่ม (ตีเป็นปล่อยกว้าง)</span>
      </h2>
      <div className="tbl-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} className="funnel-svg" role="img" aria-label="สัดส่วนงบตามชั้น funnel">
          <defs>
            <pattern id="fn-assumed" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="rgba(148,163,184,0.18)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(148,163,184,0.75)" strokeWidth="2" />
            </pattern>
          </defs>
          {rows.map((r, i) => {
            const w = wOf(r.share);
            const x = (W - w) / 2;
            const y = i * (rowH + gap);
            const aw = r.spend > 0 ? (r.assumedSpend / r.spend) * w : 0;
            return (
              <g key={r.stage}>
                <rect x={x} y={y} width={w} height={rowH} rx={8} fill={r.color} fillOpacity={0.9} />
                {aw > 1 && <rect x={x + w - aw} y={y} width={aw} height={rowH} rx={8} fill="url(#fn-assumed)" />}
                <text x={x + 12} y={y + 22} className="fn-lbl">{r.label}</text>
                <text x={x + 12} y={y + 41} className="fn-sub">
                  ฿{nInt(r.spend)} · {(r.share * 100).toFixed(0)}% · {r.ads} ads · ROAS {r.roas ? r.roas.toFixed(2) : "–"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="tbl-scroll">
        <table className="mini">
          <thead>
            <tr><th>ชั้น</th><th>งบ</th><th>สัดส่วน</th><th>ทัก</th><th>ตอบจริง</th><th>ออเดอร์</th><th>ROAS</th><th>ads</th><th>อ่านจากชื่อไม่ได้</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stage}>
                <td className="name-cell"><span className="dot" style={{ background: r.color }} /> {r.label}</td>
                <td>฿{nInt(r.spend)}</td>
                <td>{(r.share * 100).toFixed(0)}%</td>
                <td>{nInt(r.results)}</td>
                <td className={r.replies ? "good" : ""}>{nInt(r.replies)}</td>
                <td>{nInt(r.purchases)}</td>
                <td className={roasStatus(r.roas)}>{r.roas ? r.roas.toFixed(2) : "–"}</td>
                <td>{r.ads}</td>
                <td className={r.assumedSpend > 0 ? "warn" : ""}>{r.assumedSpend > 0 ? `฿${nInt(r.assumedSpend)} · ${r.assumedAds} ads` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {f.notes.map((n, i) => <div className="warn" key={i}>{n}</div>)}
    </div>
  );
}

// ─── 🔀 funnel × สินค้า — สินค้าไหนขาดชั้นไหน ─────────────────────────
function FunnelProductPanel({ data }: { data: Metrics }) {
  const rows = data.funnelProducts || [];
  const stages = data.funnel?.rows.map((r) => r.stage) || [];
  if (rows.length === 0 || stages.length === 0) return null;
  const colorOf = (st: string) => data.funnel?.rows.find((r) => r.stage === st)?.color || "#94a3b8";
  const labelOf = (st: string) => data.funnel?.rows.find((r) => r.stage === st)?.label || st;

  return (
    <div className="panel">
      <h2>🔀 funnel × สินค้า<span className="hint">ช่องว่าง = สินค้านั้นยังไม่มีท่อในชั้นนั้นเลย</span></h2>
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th>สินค้า</th>
              <th>งบ</th>
              <th>ROAS</th>
              {stages.map((st) => <th key={st} title={labelOf(st)}>{st}</th>)}
              <th style={{ minWidth: 200 }}>ต้องเติมอะไร</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.product}>
                <td className="name-cell">{p.product}</td>
                <td><strong>฿{nInt(p.spend)}</strong></td>
                <td className={roasStatus(p.roas)}>{p.roas ? p.roas.toFixed(2) : "–"}</td>
                {stages.map((st) => {
                  const c = p.cells[st];
                  if (!c || c.spend <= 0) return <td key={st} className="bad">ไม่มี</td>;
                  return (
                    <td key={st} title={`฿${nInt(c.spend)} · ${c.ads} ads · ROAS ${c.roas.toFixed(2)}`}>
                      <div className="cell-bar"><span style={{ width: `${Math.min(100, c.share * 100)}%`, background: colorOf(st) }} /></div>
                      <small>{(c.share * 100).toFixed(0)}% · {c.roas ? c.roas.toFixed(2) : "–"}</small>
                    </td>
                  );
                })}
                <td className={p.missing.length ? "warn" : ""}>{p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 🏷️ แอดที่ตั้งชื่อไม่ครบ + ชื่อที่ควรเปลี่ยนเป็น ──────────────────
function NamingPanel({ data }: { data: Metrics }) {
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const n = data.naming;
  if (!n || n.count === 0) return null;
  const rows = all ? n.rows : n.rows.slice(0, 15);
  const copy = (s: string) => {
    navigator.clipboard?.writeText(s).then(() => { setCopied(s); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  };

  return (
    <div className="panel">
      <h2>
        🏷️ แอดที่ตั้งชื่อไม่ครบ
        <span className="hint">{n.count} ตัว · ฿{nInt(n.spend)} = {(n.share * 100).toFixed(0)}% ของงบ · เรียงตามงบมากไปน้อย</span>
      </h2>
      <div className="warn">
        ชื่อพวกนี้บอกแค่ <b>วัตถุประสงค์</b> (ยอดขาย/Buy/msg/conv) ไม่ได้บอก <b>กลุ่มเป้าหมาย</b> —
        ตอนนี้นับเป็น TOF ตามค่าเริ่มต้น (ปล่อยกว้าง/Advantage+) แต่พิสูจน์จากชื่อไม่ได้
        · เปลี่ยนชื่อตามคอลัมน์ขวาแล้ว ROAS รายชั้นจะเชื่อได้จริง
      </div>
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr><th>ชื่อตอนนี้</th><th title="แอดชื่อนี้ในบัญชีนี้มีกี่ตัว — เปลี่ยนชื่อทีต้องแก้ครบทุกตัว">กี่ตัว</th><th>บัญชี</th><th>สินค้า</th><th>งบ</th><th>ROAS</th><th style={{ minWidth: 240 }}>ชื่อที่ควรเปลี่ยนเป็น</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.accountName + r.adName}>
                <td className="name-cell">{r.adName}</td>
                <td>{r.ads > 1 ? <b title="ชื่อซ้ำกันหลายตัว — งบ/ROAS ช่องขวาคือผลรวมของทั้งกลุ่ม">×{r.ads}</b> : "1"}</td>
                <td>{r.accountName}</td>
                <td>{r.product}</td>
                <td><strong>฿{nInt(r.spend)}</strong></td>
                <td className={roasStatus(r.roas)}>{r.roas ? r.roas.toFixed(2) : "–"}</td>
                <td className="name-cell">
                  {r.suggested ? (
                    <>
                      <code>{r.suggested}</code>{" "}
                      <button className="mini-btn no-print" onClick={() => copy(r.suggested!)}>
                        {copied === r.suggested ? "ก๊อปแล้ว ✓" : "ก๊อป"}
                      </button>
                    </>
                  ) : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {n.rows.length > 15 && (
        <button className="mini-btn no-print" onClick={() => setAll(!all)}>
          {all ? "ย่อ" : `ดูทั้งหมด ${n.rows.length} ตัว`}
        </button>
      )}
    </div>
  );
}

// ─── ตัวแก้กติกากลุ่มใน UI ───────────────────────────────────────────
function GroupEditor({ groups, onSave, onReset, onClose }: {
  groups: GroupDef[]; onSave: (g: GroupDef[]) => void; onReset: () => void; onClose: () => void;
}) {
  const [rows, setRows] = useState<GroupDef[]>(groups.map((g) => ({ ...g, keywords: [...g.keywords] })));
  const upd = (i: number, patch: Partial<GroupDef>) => setRows((r) => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const add = () => setRows((r) => [...r.slice(0, -1), { key: "new" + r.length, label: "ใหม่", keywords: ["kw"], color: "#f59e0b" }, r[r.length - 1]]);
  const del = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  return (
    <div className="panel editor">
      <h2>แก้กติกากลุ่ม<span className="hint">prefix ชื่อ ads · เป้า฿ = ต้นทุนต่อผลลัพธ์ที่รับได้ (ใช้ไฮไลต์ + ธง scale/kill)</span></h2>
      {rows.map((g, i) => {
        const isOthers = g.keywords.length === 0;
        return (
          <div className="erow" key={i}>
            <input className="ein" value={g.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="ชื่อกลุ่ม" />
            <input className="ein wide" disabled={isOthers} value={g.keywords.join(", ")} onChange={(e) => upd(i, { keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder={isOthers ? "(อัตโนมัติ)" : "keyword คั่นด้วย ,"} />
            <input className="ein tgt" type="number" min={0} value={g.target ?? ""} onChange={(e) => upd(i, { target: e.target.value ? Number(e.target.value) : undefined })} placeholder="เป้า฿" title="เป้า CPR (บาท)" />
            <input className="ecolor" type="color" value={g.color} onChange={(e) => upd(i, { color: e.target.value })} />
            {!isOthers ? <button className="btn" onClick={() => del(i)}>✕</button> : <span className="others-tag">others</span>}
          </div>
        );
      })}
      <div className="erow-actions">
        <button className="btn" onClick={add}>+ เพิ่มกลุ่ม</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onReset}>คืนค่าเริ่มต้น</button>
        <button className="btn" onClick={onClose}>ยกเลิก</button>
        <button className="btn primary" onClick={() => onSave(rows)}>บันทึก</button>
      </div>
    </div>
  );
}

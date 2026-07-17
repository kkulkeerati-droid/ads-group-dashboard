"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import type { Metrics, MetricKey, AccountTotal, TopAd } from "@/lib/types";
import { GROUPS, type GroupDef } from "@/lib/groups";

const PLATFORMS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "meta", label: "Meta" },
  { key: "tiktok", label: "TikTok" },
] as const;

const PRESETS = [
  { key: "today", label: "วันนี้" },
  { key: "yesterday", label: "เมื่อวาน" },
  { key: "last_3d", label: "3 วัน" },
  { key: "last_7d", label: "7 วัน" },
  { key: "last_14d", label: "14 วัน" },
  { key: "last_30d", label: "30 วัน" },
  { key: "this_month", label: "เดือนนี้" },
  { key: "last_month", label: "เดือนที่แล้ว" },
];

const METRICS: { key: MetricKey; label: string; money: boolean; lowerBetter?: boolean; higherBetter?: boolean; ratio?: boolean }[] = [
  { key: "spend", label: "ค่าใช้จ่าย", money: true },
  { key: "roas", label: "ROAS", money: false, higherBetter: true, ratio: true },
  { key: "revenue", label: "ยอดขาย (Meta)", money: true, higherBetter: true },
  { key: "results", label: "ผลลัพธ์/ทัก", money: false },
  { key: "cpr", label: "ต้นทุน/ผลลัพธ์", money: true, lowerBetter: true },
  { key: "cpm", label: "CPM", money: true, lowerBetter: true },
  { key: "reach", label: "Reach", money: false },
  { key: "impressions", label: "Impressions", money: false },
];
const fmtRoas = (v: number) => (v || 0).toFixed(2) + "x";

const nInt = (n: number) => (n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const nMoney = (n: number) => (n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMetric = (v: number, money: boolean) => (money ? "฿" + nMoney(v) : nInt(v));

const DEFAULT_GROUPS_JSON = JSON.stringify(GROUPS);

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
// สถานะ ROAS เทียบเป้า (ยิ่งมากยิ่งดี) → เขียว≥เป้า / เหลือง≥60% เป้า / แดง
function roasStatus(roas: number, target?: number): "good" | "warn" | "bad" | "" {
  const t = target || 3;
  if (!roas) return "";
  if (roas >= t) return "good";
  if (roas >= t * 0.6) return "warn";
  return "bad";
}
// ธงตัดสินใจต่อ ad: 🟢 สเกล / 🔴 ปิด / 🟡 เฝ้าดู
function adDecision(cpr: number, results: number, spend: number, target?: number): { label: string; cls: string } | null {
  if (!target) return null;
  if (results === 0 && spend > target) return { label: "🔴 ปิด", cls: "bad" };
  if (!cpr) return null;
  if (cpr <= target * 0.9 && results >= 5) return { label: "🟢 สเกล", cls: "good" };
  if (cpr > target * 1.3) return { label: "🔴 ปิด", cls: "bad" };
  return { label: "🟡 เฝ้าดู", cls: "warn" };
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
  const [preset, setPreset] = useState("last_30d");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [metric, setMetric] = useState<MetricKey>("spend");
  const [auto, setAuto] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [groupsCfg, setGroupsCfg] = useState<GroupDef[]>(GROUPS);
  const [editOpen, setEditOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
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

  // อ่าน state จาก URL (รองรับลิงก์แชร์) + localStorage groups
  useEffect(() => {
    const u = new URL(window.location.href);
    const p = u.searchParams.get("platform");
    const pr = u.searchParams.get("preset");
    const m = u.searchParams.get("metric");
    if (p === "all" || p === "meta" || p === "tiktok") setPlatform(p);
    if (pr) setPreset(pr);
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
    try {
      setErr(null);
      const custom = customSince && customUntil;
      const qs = new URLSearchParams({ platform, preset: custom ? "custom" : preset });
      if (custom) { qs.set("since", customSince); qs.set("until", customUntil); }
      if (groupsParam) qs.set("groups", groupsParam);
      if (acctFilter.length) qs.set("accounts", acctFilter.join(","));
      const res = await fetch(`/api/metrics?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [platform, preset, customSince, customUntil, groupsParam, acctFilter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

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
  // เมตริกที่วัดคุณภาพ (CPR/CPM/ROAS/ยอดขาย) ถ้าเป็น 0 = ไม่มีข้อมูล → โชว์ "–"
  const showVal = (v: number) => {
    if ((mMeta.lowerBetter || mMeta.higherBetter) && !v) return "–";
    return mMeta.ratio ? fmtRoas(v) : fmtMetric(v, mMeta.money);
  };
  // สีสถานะของค่าเมตริกปัจจุบันต่อกลุ่ม (ใช้กับการ์ด + บาร์)
  const valStatus = (g: any) =>
    metric === "cpr" ? cprStatus(g.cpr, g.target) : metric === "roas" ? roasStatus(g.roas, g.roasTarget) : "";

  const sortedAccounts = useMemo(() => (data ? sortRows(data.accounts, accSort, accGetVal) : []), [data, accSort]);
  const sortedTopAds = useMemo(() => (data ? sortRows(data.topAds, adSort, adGetVal) : []), [data, adSort]);

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
            <button className="btn" onClick={() => setSalesOpen(true)} title="กรอกยอดขายจริง (แชท/COD) → คิด ROAS จริง">💰 ยอดขายจริง</button>
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

      {!readOnly && salesOpen && (
        <SalesEditor groups={groupsCfg} onClose={() => setSalesOpen(false)} onSaved={() => { setSalesOpen(false); load(); }} />
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
      {err && <div className="warn">❌ {err}</div>}

      {loading && !data ? (
        <div className="loading">กำลังโหลด…</div>
      ) : data ? (
        <>
          {/* 🎯 สรุปคำแนะนำอัตโนมัติ — แปลตัวเลขเป็นคำสั่ง ปิด/สเกล */}
          {(() => {
            const recs = data.topAds
              .map((a) => {
                const g = data.groups.find((x) => x.key === a.group);
                return { a, g, dec: adDecision(a.cpr, a.results, a.spend, g?.target) };
              })
              .filter((r) => r.dec);
            const why = (r: (typeof recs)[0]) =>
              r.a.results === 0
                ? `฿${nMoney(r.a.spend)} ยังไม่มีผลลัพธ์`
                : `CPR ฿${nMoney(r.a.cpr)}${r.g?.target ? ` เป้า ฿${r.g.target}` : ""}`;
            const close = recs.filter((r) => r.dec!.cls === "bad").sort((x, y) => y.a.spend - x.a.spend).slice(0, 3);
            const scale = recs.filter((r) => r.dec!.cls === "good").sort((x, y) => x.a.cpr - y.a.cpr).slice(0, 3);
            if (!close.length && !scale.length) return null;
            return (
              <div className="reco-bar">
                <span className="reco-title">🎯 แนะนำ</span>
                {close.map((r, i) => (
                  <span className="reco pill bad" key={"c" + i} title={`${r.a.adName} · ${r.a.accountName}`}>
                    🔴 ปิด <b>{r.a.adName || "(ไม่มีชื่อ)"}</b> <small>{why(r)}</small>
                  </span>
                ))}
                {scale.map((r, i) => (
                  <span className="reco pill good" key={"s" + i} title={`${r.a.adName} · ${r.a.accountName}`}>
                    🟢 สเกล <b>{r.a.adName || "(ไม่มีชื่อ)"}</b> <small>{why(r)}</small>
                  </span>
                ))}
              </div>
            );
          })()}
          <div className="cards">
            <div className="card" style={{ ["--c" as any]: "#3b82f6" }}>
              <div className="k">รวมทั้งหมด</div>
              <div className={"v " + (metric === "roas" ? roasStatus((data as any).roas) : "")}>{showVal((data as any)[metric] || 0)}</div>
              <div className="m"><Delta cur={(data as any)[metric] || 0} prev={data.prev?.[metric]} lowerBetter={mMeta.lowerBetter} /> {data.accounts.length} บัญชี · {mMeta.label}{data.roas > 0 && metric !== "roas" ? ` · ROAS ${fmtRoas(data.roas)}` : ""}</div>
            </div>
            {groups.map((g) => (
              <div className="card" key={g.key} style={{ ["--c" as any]: g.color }}>
                <div className="k"><span className="dot" />{g.label}</div>
                <div className={"v " + valStatus(g)}>{showVal(groupVal(g))}</div>
                <div className="m">
                  {metric === "spend" && <><Delta cur={g.spend} prev={data.prev?.byGroup?.[g.key]} /> </>}
                  {metric === "cpr" && g.target ? `เป้า ฿${g.target} · ` : ""}
                  {metric === "roas" && g.roasTarget ? `เป้า ${g.roasTarget}x · ` : ""}
                  ฿{nInt(g.spend)} · {g.ads} ads{g.resultType ? ` · ${g.resultType}` : ""}
                  {g.roas > 0 && metric !== "roas" ? ` · ROAS ${fmtRoas(g.roas)}` : ""}
                  {g.realRoas ? ` · จริง ${fmtRoas(g.realRoas)}` : ""}
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
                <div className={"amt " + valStatus(g)}>{showVal(groupVal(g))}{metric === "spend" && <span className="pct">{(g.share * 100).toFixed(1)}%</span>}</div>
              </div>
            ))}
          </div>

          <TrendChart data={data} groups={groups} />

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
                    <SortTh label="ผลลัพธ์" col="results" sort={accSort} setSort={setAccSort} />
                    <SortTh label="CPR" col="cpr" sort={accSort} setSort={setAccSort} />
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
                      <td>{a.cpr ? "฿" + nMoney(a.cpr) : "–"}</td>
                      <td className={roasStatus(a.roas)}>{a.roas ? fmtRoas(a.roas) : "–"}</td>
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

          <div className="panel">
            <h2>Top ads<span className="hint">25 อันดับแรก (ตามค่าใช้จ่าย) · คลิกหัวคอลัมน์เพื่อเรียงภายใน 25 ตัว</span></h2>
            <div className="tbl-scroll">
              <table>
                <thead>
                  <tr>
                    <SortTh label="ชื่อ ads" col="adName" sort={adSort} setSort={setAdSort} />
                    <SortTh label="กลุ่ม" col="group" sort={adSort} setSort={setAdSort} />
                    <SortTh label="บัญชี" col="accountName" sort={adSort} setSort={setAdSort} />
                    <SortTh label="spend" col="spend" sort={adSort} setSort={setAdSort} />
                    <SortTh label="ผลลัพธ์" col="results" sort={adSort} setSort={setAdSort} />
                    <SortTh label="CPR" col="cpr" sort={adSort} setSort={setAdSort} />
                    <SortTh label="CPM" col="cpm" sort={adSort} setSort={setAdSort} />
                    <SortTh label="ROAS" col="roas" sort={adSort} setSort={setAdSort} />
                    <th>แนะนำ</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTopAds.map((a, i) => {
                    const g = groups.find((x) => x.key === a.group);
                    const dec = adDecision(a.cpr, a.results, a.spend, g?.target);
                    return (
                      <tr key={i}>
                        <td className="name-cell" title={a.adName}>{a.adName || "(ไม่มีชื่อ)"}</td>
                        <td><span className="tag" style={{ background: g?.color }}>{g?.label}</span></td>
                        <td className="name-cell">{a.accountName}</td>
                        <td>฿{nMoney(a.spend)}</td>
                        <td>{nInt(a.results)}</td>
                        <td className={cprStatus(a.cpr, g?.target)}>{a.cpr ? "฿" + nMoney(a.cpr) : "–"}</td>
                        <td>{a.cpm ? "฿" + nMoney(a.cpm) : "–"}</td>
                        <td className={roasStatus(a.roas, g?.roasTarget)}>{a.roas ? fmtRoas(a.roas) : "–"}</td>
                        <td>{dec ? <span className={"pill " + dec.cls}>{dec.label}</span> : "–"}</td>
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

// ─── กราฟเทรนด์ stacked area ต่อวัน ─────────────────────────────────
function TrendChart({ data, groups }: { data: Metrics; groups: any[] }) {
  const series = data.series || [];
  if (series.length === 0) return null;
  const W = 960, H = 250, padL = 44, padR = 14, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.length;
  const keys = groups.map((g) => g.key);
  const totals = series.map((p) => keys.reduce((s, k) => s + (p.byGroup[k] || 0), 0));
  const max = Math.max(1, ...totals);
  const X = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const Y = (v: number) => padT + innerH - (v / max) * innerH;

  // ซ้อนกลุ่มจากล่างขึ้นบน (stacked)
  const cum = new Array(n).fill(0);
  const layers = keys.map((k) => {
    const lower = [...cum];
    for (let i = 0; i < n; i++) cum[i] += series[i].byGroup[k] || 0;
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
  const fmtK = (v: number) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(Math.round(v)));
  const xticks = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];

  return (
    <div className="panel">
      <h2>เทรนด์รายวัน · ค่าใช้จ่าย{data.series[0]?.demo && <span className="hint">demo — ประมาณจากยอดรวม (live = รายวันจริง)</span>}</h2>
      <div className="tbl-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label="กราฟเทรนด์ค่าใช้จ่ายรายวันแยกกลุ่ม">
          <defs>
            {layers.map((l) => (
              <linearGradient id={`g-${l.k}`} key={l.k} x1="0" y1="0" x2="0" y2="1">
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
          {layers.map((l) => <path key={l.k} d={l.area} fill={`url(#g-${l.k})`} />)}
          {layers.map((l) => <path key={l.k + "L"} d={l.line} fill="none" stroke={l.color} strokeWidth={1.6} strokeLinejoin="round" />)}
          <circle className="endpt" cx={X(n - 1)} cy={Y(totals[n - 1])} r={4} fill="var(--accent)" />
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

// ─── กรอกยอดขายจริงต่อสินค้า (→ ROAS จริง) ──────────────────────────
function localTodayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function SalesEditor({ groups, onClose, onSaved }: {
  groups: GroupDef[]; onClose: () => void; onSaved: () => void;
}) {
  const editable = groups.filter((g) => g.keywords.length > 0); // ข้าม others
  const [date, setDate] = useState(localTodayISO());
  const [vals, setVals] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // prefill จากยอดที่เคยกรอกไว้ของวันนั้น
  useEffect(() => {
    let alive = true;
    setMsg(null);
    fetch(`/api/sales?since=${date}&until=${date}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.enabled === false) setMsg("⚠️ ยังไม่ได้เปิด Supabase — กรอกดูได้ แต่จะเก็บถาวร/แชร์ทีมไม่ได้จนกว่าจะตั้ง SUPABASE_URL + SERVICE_ROLE_KEY");
        const bg: Record<string, number> = j.byGroup || {};
        const next: Record<string, string> = {};
        for (const k of Object.keys(bg)) next[k] = String(bg[k]);
        setVals(next);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [date]);

  const save = async () => {
    setSaving(true); setMsg(null);
    const entries: Record<string, number> = {};
    for (const g of editable) {
      const v = vals[g.key];
      if (v !== undefined && v !== "") entries[g.key] = Number(v);
    }
    try {
      const res = await fetch("/api/sales", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, entries }),
      });
      const j = await res.json();
      if (!j.ok) { setMsg("❌ " + (j.error || "บันทึกไม่ได้")); setSaving(false); return; }
      onSaved();
    } catch (e: any) { setMsg("❌ " + (e.message || String(e))); setSaving(false); }
  };

  return (
    <div className="panel editor">
      <h2>💰 กรอกยอดขายจริงต่อสินค้า<span className="hint">ยอดปิดจริง (แชท/COD) ต่อวัน → ใช้คิด ROAS จริง เทียบค่าแอด · บันทึกต่อวัน ช่วงเวลาจะรวมให้เอง</span></h2>
      <div className="erow">
        <span className="others-tag">วันที่</span>
        <input className="ein" type="date" value={date} max={localTodayISO()} onChange={(e) => setDate(e.target.value)} />
      </div>
      {editable.map((g) => (
        <div className="erow" key={g.key}>
          <span className="ein" style={{ borderLeft: `4px solid ${g.color}` }}>{g.label}</span>
          <input className="ein wide" type="number" min={0} inputMode="decimal" placeholder="ยอดขายจริงวันนี้ (บาท)"
            value={vals[g.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [g.key]: e.target.value }))} />
        </div>
      ))}
      {msg && <div className="warn">{msg}</div>}
      <div className="erow-actions">
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>ยกเลิก</button>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึกยอดขาย"}</button>
      </div>
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

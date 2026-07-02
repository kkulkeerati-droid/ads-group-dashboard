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
  { key: "last_7d", label: "7 วัน" },
  { key: "last_30d", label: "30 วัน" },
  { key: "this_month", label: "เดือนนี้" },
];

const METRICS: { key: MetricKey; label: string; money: boolean; lowerBetter?: boolean }[] = [
  { key: "spend", label: "ค่าใช้จ่าย", money: true },
  { key: "results", label: "ผลลัพธ์/ทัก", money: false },
  { key: "cpr", label: "ต้นทุน/ผลลัพธ์", money: true, lowerBetter: true },
  { key: "cpm", label: "CPM", money: true, lowerBetter: true },
  { key: "reach", label: "Reach", money: false },
  { key: "impressions", label: "Impressions", money: false },
];

const nInt = (n: number) => (n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const nMoney = (n: number) => (n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMetric = (v: number, money: boolean) => (money ? "฿" + nMoney(v) : nInt(v));

const DEFAULT_GROUPS_JSON = JSON.stringify(GROUPS);

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
  const [metric, setMetric] = useState<MetricKey>("spend");
  const [auto, setAuto] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [groupsCfg, setGroupsCfg] = useState<GroupDef[]>(GROUPS);
  const [editOpen, setEditOpen] = useState(false);
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
    if (m) setMetric(m as MetricKey);
    if (u.searchParams.get("ro") === "1") setReadOnly(true);
    try {
      const saved = localStorage.getItem("ads-groups");
      if (saved) setGroupsCfg(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const groupsParam = useMemo(() => {
    const j = JSON.stringify(groupsCfg);
    return j === DEFAULT_GROUPS_JSON ? "" : j;
  }, [groupsCfg]);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const qs = new URLSearchParams({ platform, preset });
      if (groupsParam) qs.set("groups", groupsParam);
      const res = await fetch(`/api/metrics?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [platform, preset, groupsParam]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (auto) timer.current = setInterval(load, 15000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auto, load]);

  const groups = data?.groups ?? [];
  const mMeta = METRICS.find((m) => m.key === metric)!;
  const groupVal = (g: any) => (g[metric] as number) || 0;
  const maxVal = Math.max(1, ...groups.map(groupVal));

  const sortedAccounts = useMemo(() => (data ? sortRows(data.accounts, accSort, accGetVal) : []), [data, accSort]);
  const sortedTopAds = useMemo(() => (data ? sortRows(data.topAds, adSort, adGetVal) : []), [data, adSort]);

  const shareLink = () => {
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set("platform", platform);
    u.searchParams.set("preset", preset);
    u.searchParams.set("metric", metric);
    u.searchParams.set("ro", "1");
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
            Ads Group Dashboard{" "}
            {data && <span className={`badge ${data.source}`}>{data.source.toUpperCase()}</span>}
            {readOnly && <span className="badge ro">READ-ONLY</span>}
          </h1>
          <div className="sub">
            ค่าโฆษณาแบ่งตามกลุ่มชื่อ ads · {groupsCfg.map((g) => g.label).join(" / ")}
            {data && <> · {data.since} → {data.until}</>}
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
                <button key={p.key} className={preset === p.key ? "active" : ""} onClick={() => setPreset(p.key)}>{p.label}</button>
              ))}
            </div>
            <label className="toggle"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />auto 15s</label>
            <button className="btn" onClick={load}>↻</button>
            <button className="btn" onClick={() => setEditOpen((v) => !v)}>⚙︎ กลุ่ม</button>
            <button className="btn" onClick={exportCSV}>⬇︎ CSV</button>
            <button className="btn" onClick={() => window.print()}>🖨 PDF</button>
            <button className="btn" onClick={shareLink}>{copied ? "✓ คัดลอกแล้ว" : "🔗 แชร์"}</button>
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
      {err && <div className="warn">❌ {err}</div>}

      {loading && !data ? (
        <div className="loading">กำลังโหลด…</div>
      ) : data ? (
        <>
          <div className="cards">
            <div className="card" style={{ ["--c" as any]: "#3b82f6" }}>
              <div className="k">รวมทั้งหมด</div>
              <div className="v">{fmtMetric((data as any)[metric], mMeta.money)}</div>
              <div className="m">{data.accounts.length} บัญชี · {mMeta.label}</div>
            </div>
            {groups.map((g) => (
              <div className="card" key={g.key} style={{ ["--c" as any]: g.color }}>
                <div className="k"><span className="dot" />{g.label}</div>
                <div className="v">{fmtMetric(groupVal(g), mMeta.money)}</div>
                <div className="m">
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
                <div className="amt">{fmtMetric(groupVal(g), mMeta.money)}{metric === "spend" && <span className="pct">{(g.share * 100).toFixed(1)}%</span>}</div>
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
                  </tr>
                </thead>
                <tbody>
                  {sortedTopAds.map((a, i) => {
                    const g = groups.find((x) => x.key === a.group);
                    return (
                      <tr key={i}>
                        <td className="name-cell" title={a.adName}>{a.adName || "(ไม่มีชื่อ)"}</td>
                        <td><span className="tag" style={{ background: g?.color }}>{g?.label}</span></td>
                        <td className="name-cell">{a.accountName}</td>
                        <td>฿{nMoney(a.spend)}</td>
                        <td>{nInt(a.results)}</td>
                        <td>{a.cpr ? "฿" + nMoney(a.cpr) : "–"}</td>
                        <td>{a.cpm ? "฿" + nMoney(a.cpm) : "–"}</td>
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

// ─── กราฟเทรนด์ stacked columns ต่อวัน ──────────────────────────────
function TrendChart({ data, groups }: { data: Metrics; groups: any[] }) {
  const series = data.series || [];
  if (series.length === 0) return null;
  const W = 900, H = 200, pad = 24;
  const keys = groups.map((g) => g.key);
  const totals = series.map((p) => keys.reduce((s, k) => s + (p.byGroup[k] || 0), 0));
  const max = Math.max(1, ...totals);
  const step = (W - pad * 2) / series.length;
  const barW = Math.max(4, step * 0.7);

  return (
    <div className="panel">
      <h2>เทรนด์รายวัน (spend){data.series[0]?.demo && <span className="hint">demo — ประมาณจากยอดรวม (live = รายวันจริง)</span>}</h2>
      <div className="tbl-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} className="trend" preserveAspectRatio="none">
          {series.map((p, i) => {
            let y = H - pad;
            const x = pad + i * step + (step - barW) / 2;
            return (
              <g key={i}>
                {keys.map((k) => {
                  const v = p.byGroup[k] || 0;
                  if (v <= 0) return null;
                  const h = ((v / max) * (H - pad * 2));
                  y -= h;
                  const g = groups.find((x) => x.key === k);
                  return <rect key={k} x={x} y={y} width={barW} height={h} fill={g?.color} />;
                })}
              </g>
            );
          })}
          <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#334155" />
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
      <h2>แก้กติกากลุ่ม<span className="hint">จับจาก prefix ชื่อ ads · Others = ตัวที่ไม่เข้ากลุ่มไหน</span></h2>
      {rows.map((g, i) => {
        const isOthers = g.keywords.length === 0;
        return (
          <div className="erow" key={i}>
            <input className="ein" value={g.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="ชื่อกลุ่ม" />
            <input className="ein wide" disabled={isOthers} value={g.keywords.join(", ")} onChange={(e) => upd(i, { keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder={isOthers ? "(อัตโนมัติ)" : "keyword คั่นด้วย ,"} />
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

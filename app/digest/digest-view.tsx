"use client";

import { useEffect, useState } from "react";
import type { Digest, DigestItem } from "@/lib/digest";

const money = (n: number) => "฿" + Math.round(n || 0).toLocaleString("th-TH");
const TONE: Record<string, string> = { good: "good", bad: "bad", warn: "warn", info: "" };

function Section({ n, title, items, hint }: { n: string; title: string; items: DigestItem[]; hint?: string }) {
  if (!items?.length) return null;
  return (
    <div className="panel">
      <h2><span className="dg-num">{n}</span> {title}{hint && <span className="hint">{hint}</span>}</h2>
      <ul className="dg-list">
        {items.map((it, i) => (
          <li key={i} className={TONE[it.tone]}>{it.text}</li>
        ))}
      </ul>
    </div>
  );
}

export default function DigestView() {
  const [d, setD] = useState<Digest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [until, setUntil] = useState("");

  useEffect(() => {
    const qs = until ? `?until=${until}` : "";
    setD(null); setErr(null);
    fetch(`/api/digest${qs}`).then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : setD(j))).catch((e) => setErr(String(e)));
  }, [until]);

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>📅 Weekly Digest <span className="badge live">7 วัน</span></h1>
          <div className="sub">{d ? `${d.since} → ${d.until} · เทียบกับ ${d.prevSince} → ${d.prevUntil}` : "กำลังโหลด…"}</div>
        </div>
        <div className="controls no-print">
          <div className="daterange" title="ดูสัปดาห์ที่จบวันไหน">
            <span className="hint">จบวันที่</span>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
          <a className="btn" href="/">← กลับ dashboard</a>
          <button className="btn" onClick={() => window.print()}>🖨 PDF</button>
        </div>
      </header>

      {err && <div className="warn">❌ {err}</div>}
      {!d && !err && <div className="loading">กำลังคิด digest…</div>}

      {d && (
        <>
          <div className="reco-bar">
            <span className="reco-title">🎯 สรุปสั้น</span>
            <span className="reco pill warn"><b>{d.headline}</b></span>
          </div>

          {/* KPI */}
          <div className="cards">
            {d.kpiStatus.map((k) => (
              <div className="card" key={k.key} style={{ ["--c" as any]: k.hit ? "#22c55e" : "#f59e0b" }}>
                <div className="k">{k.label}</div>
                <div className={"v " + (k.hit ? "good" : "warn")}>{k.actual.toFixed(k.unit ? 0 : 2)}{k.unit}</div>
                <div className="m">เป้า {k.target}{k.unit} · {k.pct.toFixed(0)}% ของเป้า {k.hit ? "✅" : "⚠️"}</div>
              </div>
            ))}
            <div className="card" style={{ ["--c" as any]: "#6366f1" }}>
              <div className="k">ค่าแอด / ยอดขาย</div>
              <div className="v">{money(d.totals.spend)}</div>
              <div className="m">ยอดขาย {money(d.totals.revenue)} · {d.totals.purchases} ออเดอร์</div>
            </div>
            <div className="card" style={{ ["--c" as any]: "#ec4899" }}>
              <div className="k">แชทจริง vs ผี</div>
              <div className="v">{d.totals.replyRate.toFixed(0)}%</div>
              <div className="m">ทัก {d.totals.results} → ตอบ {d.totals.replies} · ฿/คนตอบ {money(d.totals.cpReply)}</div>
            </div>
          </div>

          <Section n="1" title="เราทำอะไรไปแล้วบ้าง" items={d.didThisWeek} />
          <Section n="2" title="อันไหนได้ผล" items={d.worked} hint="ROAS ถึงเป้า" />
          <Section n="2" title="อันไหนไม่ได้ผล" items={d.didntWork} hint="ต่ำกว่าเป้า / ขาดทุน" />
          <Section n="3" title="สิ่งที่เรียนรู้" items={d.learned} />
          <Section n="4" title="สิ่งที่เราจะปรับ" items={d.willAdjust} />
          <Section n="5" title="สิ่งที่ suggest ทางแบรนด์" items={d.brandSuggest} hint="เรื่องที่แอดแก้เองไม่ได้" />

          <div className="panel">
            <h2>📦 รายสินค้า<span className="hint">สัปดาห์นี้</span></h2>
            <div className="tbl-scroll">
              <table>
                <thead><tr><th>สินค้า</th><th>ค่าแอด</th><th>ยอดขาย</th><th>ROAS</th><th>ทัก</th><th>ตอบจริง</th><th>%ตอบ</th><th>฿/คนตอบ</th><th>%ปิด</th><th>basket</th></tr></thead>
                <tbody>
                  {d.products.map((p) => (
                    <tr key={p.key}>
                      <td className="name-cell"><b>{p.key}</b></td>
                      <td>{money(p.spend)}</td>
                      <td>{money(p.revenue)}</td>
                      <td className={p.roas >= d.kpi.roas ? "good" : p.roas < 1 ? "bad" : "warn"}><b>{p.roas.toFixed(2)}</b></td>
                      <td>{p.results}</td>
                      <td>{p.replies}</td>
                      <td className={p.replyRate >= d.kpi.replyRate ? "good" : p.replyRate < 40 ? "bad" : "warn"}>{p.replyRate.toFixed(0)}%</td>
                      <td><b>{money(p.cpReply)}</b></td>
                      <td>{p.convRate.toFixed(0)}%</td>
                      <td>{money(p.basket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="updated">เทียบงวดก่อน: ROAS {d.prevTotals.roas.toFixed(2)} → {d.totals.roas.toFixed(2)} · %ตอบ {d.prevTotals.replyRate.toFixed(0)}% → {d.totals.replyRate.toFixed(0)}% · ฿/คนตอบ {money(d.prevTotals.cpReply)} → {money(d.totals.cpReply)}</div>
        </>
      )}
    </div>
  );
}

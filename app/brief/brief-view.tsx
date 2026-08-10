"use client";

import { useEffect, useState } from "react";
import type { Brief, BriefItem } from "@/lib/brief";
import { ACTION_META, type AeAction } from "@/lib/ae";

const money = (n: number) => "฿" + Math.round(n || 0).toLocaleString("th-TH");
const int = (n: number) => (n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });

// สีของแต่ละคำสั่ง — ใช้ชุดเดียวกับธงบนหน้าหลัก
const CLS: Record<string, string> = {
  STOP: "bad", REDUCE: "poor", NEW_CREATIVE: "warn", FIX_OFFER: "warn", FIX_TRACKING: "fix",
  CLONE: "good", SCALE: "good", KEEP: "", WAIT: "",
};

function ActionGroup({ items }: { items: BriefItem[] }) {
  if (!items.length) return null;
  const { icon, label, action } = items[0];
  return (
    <div className="panel">
      <h2>
        <span className={"pill " + CLS[action]}>{icon} {label}</span>
        <span className="hint">{items.length} ตัว</span>
      </h2>
      <div className="acct-cards">
        {items.map((i, k) => (
          <div className="acct-card" key={k}>
            <div className="acct-head-row">
              <strong className="name-cell" title={i.adName}>{i.adName}</strong>
              <span className="hint">@{i.accountName} · {i.product} · {i.funnel}</span>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              {money(i.spend)} → {money(i.revenue)} · <b className={i.roas >= 3.5 ? "good" : i.roas >= 1 ? "warn" : "bad"}>ROAS {i.roas.toFixed(2)}</b>
              {i.roasRecent !== null && Math.abs(i.roasRecent - i.roas) >= 0.3 && (
                <> · <span className={i.roasRecent < i.roas ? "bad" : "good"}>3 วันล่าสุด {i.roasRecent.toFixed(2)} {i.roasRecent < i.roas ? "▼" : "▲"}</span></>
              )} · ตอบจริง {i.replies}
            </div>
            <div style={{ marginTop: 8, fontSize: 13.5 }}>{i.why}</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>👉 {i.how}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BriefView() {
  const [b, setB] = useState<Brief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [date, setDate] = useState("");

  useEffect(() => {
    const u = new URL(window.location.href);
    const d = u.searchParams.get("date") || "";
    setDate(d);
    fetch(`/api/brief${d ? `?date=${d}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setB(j)))
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="wrap"><div className="warn">❌ {err}</div></div>;
  if (!b) return <div className="wrap"><div className="loading">กำลังโหลด…</div></div>;

  // ไล่ลำดับจาก ACTION_META โดยตรง — เพิ่มคำสั่งใหม่ใน lib/ae.ts แล้วหน้านี้ขึ้นเอง
  // (เคยพลาด: ลิสต์ hardcode ไว้ พอเพิ่ม FIX_OFFER แล้วมันหายไปเงียบ ๆ)
  const order = (Object.keys(ACTION_META) as AeAction[])
    .filter((a) => a !== "KEEP" && a !== "WAIT")
    .sort((x, y) => ACTION_META[x].order - ACTION_META[y].order);
  const groups = order.map((a) => b.items.filter((i) => i.action === a)).filter((g) => g.length);
  const parked = b.items.filter((i) => i.action === "KEEP" || i.action === "WAIT");

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>📋 สรุปบ่าย + แผนพรุ่งนี้</h1>
          <div className="sub">
            {b.date}{!b.dayComplete && <span className="warn-inline"> · วันนี้ยังไม่จบ</span>} ·
            ฐานตัดสินใจ 7 วัน {b.week.since}–{b.week.until}
          </div>
        </div>
        <div className="controls no-print">
          <a className="btn" href="/">← dashboard</a>
          <a className="btn" href="/digest">📅 สรุปสัปดาห์</a>
          <button className="btn" onClick={() => window.print()}>🖨 PDF</button>
        </div>
      </header>

      <div className="reco-bar">
        <span className="reco-title">🎯 ทำก่อน</span>
        <span style={{ fontWeight: 700 }}>{b.headline}</span>
      </div>

      {/* ทั้งกระดานร่วงพร้อมกันแต่คนยังคุยเท่าเดิม = ยอดยังไม่เข้าระบบ ไม่ใช่แอดพังทีละตัว */}
      {b.board?.wobble && (
        <div className="warn issue">
          🩸 <strong>{b.board.headline}</strong>
          <div style={{ marginTop: 6 }}>{b.board.detail}</div>
        </div>
      )}

      {!b.dayComplete && (
        <div className="warn">
          ⏳ ตัวเลข <strong>วันนี้</strong> ยังไม่จบวัน และ <strong>ยอดขายเข้าระบบช้ากว่าค่าแอดเสมอ</strong> (คนทักเย็น ปิดการขายดึก)
          — เอาไว้ดูจังหวะเท่านั้น · <strong>คำสั่งทุกข้อด้านล่างตัดจาก 7 วันที่จบวันแล้ว</strong>
        </div>
      )}

      <div className="cards">
        <div className="card" style={{ ["--c" as any]: "#3b82f6" }}>
          <div className="k">วันนี้ · ค่าแอด</div>
          <div className="v">{money(b.today.spend)}</div>
          <div className="m">เฉลี่ย 7 วัน {money(b.avg7.spend)}/วัน</div>
        </div>
        <div className="card" style={{ ["--c" as any]: "#22c55e" }}>
          <div className="k">วันนี้ · ตอบจริง</div>
          <div className="v">{int(b.today.replies)}</div>
          <div className="m">ทัก {int(b.today.results)} · {b.today.replyRate.toFixed(0)}% · เฉลี่ย {int(b.avg7.replies)}/วัน</div>
        </div>
        <div className="card" style={{ ["--c" as any]: "#f59e0b" }}>
          <div className="k">7 วัน · ROAS</div>
          <div className="v">{b.week.roas.toFixed(2)}</div>
          <div className="m">{money(b.week.spend)} → {money(b.week.revenue)} · ปิด {b.week.convRate.toFixed(1)}%</div>
        </div>
        <div className="card" style={{ ["--c" as any]: "#ef4444" }}>
          <div className="k">ทำครบแล้วได้อะไร</div>
          <div className="v">{money(b.moneySaved)}</div>
          <div className="m">หยุดเงินไหลออก{b.moneyUpside > 0 ? ` · ต่อยอด ${money(b.moneyUpside)}` : ""} (ฐาน 7 วัน)</div>
        </div>
      </div>

      {groups.map((g, i) => <ActionGroup key={i} items={g} />)}

      {b.content.length > 0 && (
        <div className="panel">
          <h2>🎬 คอนเทนต์<span className="hint">มุมไหนยังทำเงิน · สินค้าไหนของเดิมหมดแรง</span></h2>
          <div className="tbl-scroll">
            <table>
              <thead><tr><th>สินค้า</th><th>ค่าแอด</th><th>ROAS</th><th>มุมที่ยังทำเงิน → ขยี้ต่อ</th><th>มุมที่ตายแล้ว</th><th>ต้องยิงใหม่?</th></tr></thead>
              <tbody>
                {b.content.map((c) => (
                  <tr key={c.product}>
                    <td className="name-cell"><strong>{c.product}</strong></td>
                    <td>{money(c.spend)}</td>
                    <td className={c.roas >= 3.5 ? "good" : c.roas >= 1 ? "warn" : "bad"}>{c.roas.toFixed(2)}</td>
                    <td>{c.winners.length ? c.winners.map((w) => `${w.theme} (${w.roas.toFixed(2)})`).join(" · ") : "–"}</td>
                    <td className="bad">{c.dead.length ? c.dead.map((w) => w.theme).join(" · ") : "–"}</td>
                    <td>{c.needNew ? <span className="pill warn" title={c.why}>🎬 ใช่</span> : <span className="hint">ยังไหว</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.content.filter((c) => c.needNew).map((c) => (
            <div className="hint" key={c.product} style={{ marginTop: 6 }}>• <b>{c.product}</b> — {c.why}</div>
          ))}
        </div>
      )}

      <div className="panel">
        <h2>🔺 สมดุล funnel<span className="hint">แบ่งจากกลุ่มเป้าหมายในชื่อแอด ไม่ใช่วัตถุประสงค์</span></h2>
        <div className="tbl-scroll">
          <table>
            <thead><tr><th>ชั้น</th><th>ค่าแอด</th><th>สัดส่วน</th><th>ยอดขาย</th><th>ROAS</th><th>จำนวนแอด</th><th>อ่านจากชื่อไม่ได้</th></tr></thead>
            <tbody>
              {b.funnel.rows.map((r) => (
                <tr key={r.stage}>
                  <td className="name-cell"><strong>{r.label}</strong></td>
                  <td>{money(r.spend)}</td>
                  <td><b>{(r.share * 100).toFixed(0)}%</b></td>
                  <td>{money(r.revenue)}</td>
                  <td className={r.roas >= 3.5 ? "good" : r.roas >= 1 ? "warn" : "bad"}>{r.roas ? r.roas.toFixed(2) : "–"}</td>
                  <td>{r.ads}</td>
                  <td className={r.assumedSpend > 0 ? "warn" : ""}>{r.assumedSpend > 0 ? `${money(r.assumedSpend)} · ${r.assumedAds} ตัว` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {b.funnel.notes.map((n, i) => <div className="warn" key={i} style={{ marginTop: 10 }}>⚠️ {n}</div>)}
      </div>

      {/* แอดที่ตั้งชื่อไม่ครบ + ชื่อที่ควรเปลี่ยนเป็น (ก๊อปไปวางใน Ads Manager ได้เลย) */}
      {b.unnamed.count > 0 && (
        <div className="panel">
          <h2>
            🏷️ แอดที่ตั้งชื่อไม่ครบ
            <span className="hint">{b.unnamed.count} ตัว · {money(b.unnamed.spend)} = {(b.unnamed.share * 100).toFixed(0)}% ของงบ · เรียงตามงบมากไปน้อย</span>
          </h2>
          <div className="tbl-scroll">
            <table>
              <thead><tr><th>ชื่อตอนนี้</th><th>บัญชี</th><th>ค่าแอด</th><th>ROAS</th><th>ชื่อที่ควรเปลี่ยนเป็น</th></tr></thead>
              <tbody>
                {b.unnamed.rows.slice(0, 20).map((r) => (
                  <tr key={r.accountName + r.adName}>
                    <td className="name-cell">{r.adName}</td>
                    <td>{r.accountName}</td>
                    <td>{money(r.spend)}</td>
                    <td className={r.roas >= 3.5 ? "good" : r.roas >= 1 ? "warn" : "bad"}>{r.roas ? r.roas.toFixed(2) : "–"}</td>
                    <td className="name-cell"><code>{r.suggested || "–"}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.unnamed.rows.length > 20 && <div className="hint" style={{ marginTop: 8 }}>… อีก {b.unnamed.rows.length - 20} ตัว ดูรายการเต็มบนหน้า dashboard</div>}
        </div>
      )}

      {/* ใช้เงินเพิ่มแต่ยอดรวมไม่โต = แคมเปญแย่งลูกค้ากันเอง (ebook แม่เอ บทที่ 50) */}
      {b.cannibal.length > 0 && (
        <div className="warn">
          ⚔️ <strong>ใช้เงินเพิ่มแต่ยอดรวมไม่โต</strong> — {b.cannibal.map((c) => `${c.product}: ${c.why}`).join(" · ")}
          {" "}— หยุดแตกตัวเพิ่ม แล้วคัดให้เหลือแต่ตัวที่ทำกำไร
        </div>
      )}
      {b.cloneFamilies.length > 0 && (
        <div className="warn">
          🧬 <strong>แตกเกิน 3 ตัวต่อตัวแม่</strong> — {b.cloneFamilies.map((f) => `${f.parent} (โคลน ${f.clones} ตัว · ${money(f.spend)} · ROAS ${f.roas.toFixed(2)})`).join(" · ")}
        </div>
      )}

      {b.churn.stopped >= 10 && (
        <div className="warn">
          ♻️ <strong>เปิด-ปิดแอดถี่</strong> — 7 วันนี้มี <strong>{b.churn.stopped} ตัว</strong> ที่หยุดไปแล้ว กินงบรวม {money(b.churn.spend)}
          {b.churn.wasted > 0 && <> · ในนั้น <strong>{money(b.churn.wasted)}</strong> ไม่ได้ยอดขายกลับมาเลย</>}
          {" "}— เปิดปิดเร็วเกินแอดไม่ทันพ้น learning · ตั้งงบทดสอบต่อตัวแล้วปล่อยให้ครบ 3 วันก่อนตัดสิน
        </div>
      )}

      {b.audience.length > 0 && (
        <div className="panel">
          <h2>👥 กลุ่มเป้าหมายที่ควรเปิดเพิ่ม<span className="hint">LAL / retarget ที่ยังไม่ได้ทำ</span></h2>
          <ul className="dg-list">{b.audience.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}

      {b.clones.length > 0 && (
        <div className="panel">
          <h2>🧬 clone ที่ต้องเช็ค<span className="hint">กติกา 24 ชม. — แพงกว่าตัวแม่ให้ปิด</span></h2>
          <ul className="dg-list">
            {b.clones.map((c, i) => (
              <li key={i} className={c.verdict === "kill" ? "bad" : ""}>
                <b>{c.adName}</b> (แม่: {c.parent}) — {c.why}
              </li>
            ))}
          </ul>
        </div>
      )}

      {parked.length > 0 && (
        <div className="panel">
          <h2>😴 ยังไม่ต้องแตะ<span className="hint">{parked.length} ตัว — อยู่ในเกณฑ์ หรือยังไม่พ้น learning</span></h2>
          <div className="tbl-scroll">
            <table>
              <thead><tr><th>ชื่อ ads</th><th>บัญชี</th><th>ค่าแอด</th><th>ROAS</th><th>เพราะ</th></tr></thead>
              <tbody>
                {parked.map((i, k) => (
                  <tr key={k}>
                    <td className="name-cell">{i.icon} {i.adName}</td>
                    <td className="name-cell">{i.accountName}</td>
                    <td>{money(i.spend)}</td>
                    <td>{i.roas ? i.roas.toFixed(2) : "–"}</td>
                    <td className="hint">{i.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="updated">
        สร้างเมื่อ {b.generatedAt ? new Date(b.generatedAt).toLocaleString("th-TH") : "–"}
        {date && ` · ดูย้อนหลังวันที่ ${date}`}
      </div>
    </div>
  );
}

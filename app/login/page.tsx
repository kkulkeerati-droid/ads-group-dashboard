"use client";

import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        const next = new URL(window.location.href).searchParams.get("next") || "/";
        window.location.href = next.startsWith("/") ? next : "/";
      } else {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || "รหัสผ่านไม่ถูกต้อง");
        setBusy(false);
      }
    } catch {
      setErr("เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง");
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">Ads Group Dashboard</div>
        <div className="login-sub">ใส่รหัสผ่านเพื่อเข้าดูรายงาน</div>
        <input
          className="login-input"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="รหัสผ่าน"
          autoFocus
          autoComplete="current-password"
        />
        {err && <div className="login-err">{err}</div>}
        <button className="btn primary login-btn" type="submit" disabled={busy || !pw}>
          {busy ? "กำลังเข้า…" : "เข้าสู่ระบบ"}
        </button>
      </form>
    </div>
  );
}

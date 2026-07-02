// ─── auth token ──────────────────────────────────────────────────
// cookie = SHA-256 ของรหัสผ่าน (ไม่เก็บรหัสดิบใน cookie)
// ใช้ Web Crypto → ทำงานได้ทั้ง edge middleware และ route handler
export const AUTH_COOKIE = "dash_auth";

export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode("adsdash::" + password);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

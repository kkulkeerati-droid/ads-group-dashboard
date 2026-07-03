# HANDOFF — Ads Group Dashboard (สรุปทั้งหมดสำหรับ session ถัดไป)

> อ่านไฟล์นี้ก่อนทำต่อ · อัปเดตล่าสุด: 2026-07-03

## 1. โปรเจกต์นี้คืออะไร
เว็บ dashboard รวมค่าโฆษณา **Meta (+ TikTok เตรียมไว้) ทุก ad account** แล้วแบ่งตาม **prefix ชื่อ ads**:
`grd` · `ai` · `a2` · `สายพาน` · `ap2` · `others` (others = ที่ไม่เข้ากลุ่มไหน)

- **Stack:** Next.js 15 (App Router) + TypeScript · ไม่มี lib chart (วาด SVG เอง)
- **โค้ดในเครื่อง:** `/Users/thanatos66/Downloads/Kantamaze 01 - for Content Carousel/dashboard`
- **GitHub (private):** https://github.com/kkulkeerati-droid/ads-group-dashboard
- **รันในเครื่อง:** `cd dashboard && npm install && npm run dev` → http://localhost:3000

## 2. สถานะ deploy ตอนนี้ ⚠️ (ยังไม่ live)
- โค้ดเสร็จ + push ขึ้น GitHub แล้ว (มีระบบล็อกรหัสด้วย)
- **ยังไม่ได้ deploy** — เลือกวิธี **Vercel CLI + token** (deploy โค้ดในเครื่องตรงๆ)
- **เหตุผลที่ไม่ใช้ GitHub import:** บัญชีไม่ตรง — repo อยู่ใต้ GitHub `kkulkeerati-droid` แต่ Vercel ล็อกอินเป็น `stanamaharat-5791` (GitHub `stanamaharat-crypto`)
- **ค้างที่:** รอ **Vercel token** จาก user (สร้างที่ vercel.com/account/settings/tokens ชื่อ `deploy-ads-dashboard`, scope `stanamaharat-5791`, expiration 1 day)

### ขั้นตอน deploy ที่เหลือ (ทำเมื่อได้ token)
```bash
cd "/Users/thanatos66/Downloads/Kantamaze 01 - for Content Carousel/dashboard"
npx vercel --prod --yes --token <TOKEN>     # deploy ครั้งแรก (สร้าง project + prod)
# ตั้ง env (สำคัญ: password ก่อน meta token เสมอ)
npx vercel env add DASHBOARD_PASSWORD production --token <TOKEN>   # ใส่รหัสที่ user เลือก
npx vercel env add META_ACCESS_TOKEN production --token <TOKEN>   # ถ้าพร้อมข้อมูลจริง
npx vercel --prod --yes --token <TOKEN>     # redeploy ให้ env มีผล
```
> **กฎเหล็ก:** ต้องตั้ง `DASHBOARD_PASSWORD` **ก่อน** ใส่ `META_ACCESS_TOKEN` เสมอ — ไม่งั้นข้อมูลจริงจะเปิดสาธารณะช่วงหนึ่ง

## 3. ฟีเจอร์ที่มีแล้ว (เสร็จ + verify หมด)
- **แบ่งกลุ่มตาม prefix ชื่อ ads** (prefix + token-boundary กัน `aigen` หลุดเข้า `ai`) — แก้ใน UI ได้ (ปุ่ม ⚙︎ กลุ่ม, เก็บ localStorage)
- **6 เมตริกต่อกลุ่ม สลับได้:** ค่าใช้จ่าย / ผลลัพธ์(ทัก) / CPR / CPM / Reach / Impressions
- **ระบบตัดสินใจ:** ตั้งเป้า CPR ต่อกลุ่ม → ไฮไลต์ 🟢เขียว/🟡เหลือง/🔴แดง + ธง **🟢สเกล / 🟡เฝ้าดู / 🔴ปิด** ต่อ ad (คอลัมน์ "แนะนำ" ใน Top ads)
- **เทียบงวดก่อน %▲▼** บนการ์ด
- **กราฟเทรนด์รายวัน** = stacked area (gradient + grid + แกน + จุดเน้นวันล่าสุด)
- **เตือนบัญชีที่ดึงไม่ได้** (disabled/unsettled) แถบแดง
- **ตารางเรียงได้** (คลิกหัวคอลัมน์) · **ลิงก์แชร์ read-only** (`?ro=1`) · **CSV** · **PDF** (print) · **auto-refresh 15s**
- **ธีม light/dark** สลับได้ (เก็บ localStorage)
- **white-label** ผ่าน URL `?brand=ชื่อ&logo=url`
- **เล่มรายงาน** = กรองบัญชี `?accounts=id,id` (ปุ่ม ⛃) พกในลิงก์แชร์
- **ล็อกรหัสผ่าน** — middleware ล็อกทั้งเว็บ+API (ยกเว้น /api/sync ที่มี CRON_SECRET) ตั้งด้วย `DASHBOARD_PASSWORD`, หน้า /login, ปุ่ม ⎋ ออก

## 4. สถาปัตยกรรม / ไฟล์สำคัญ
```
middleware.ts              ล็อกทั้งเว็บด้วย DASHBOARD_PASSWORD (edge)
app/login/page.tsx         หน้า login
app/api/login|logout       ตั้ง/ล้าง cookie auth
app/api/metrics/route.ts   รวมทุกแพลตฟอร์ม → แบ่งกลุ่ม (3-tier) + เทียบงวด + กรองบัญชี
app/api/sync/route.ts      cron target — ดึง→เก็บ Supabase (กัน CRON_SECRET, บังคับต้องมี)
app/dashboard.tsx          UI ทั้งหมด
lib/groups.ts              กติกากลุ่ม + target (เป้า CPR) + classifier override ได้
lib/meta.ts                Meta Graph API (spend/impr/reach + actions→results)
lib/tiktok.ts              TikTok adapter (พร้อมเปิดใช้)
lib/supabase.ts            Supabase layer (no-op ถ้าไม่ตั้ง env)
lib/aggregate.ts           รวม → group/account/topAds/series + toPrevTotals
lib/auth.ts                token = SHA-256(รหัส)
supabase/migrations/0001_init.sql   schema (ตาราง ad_metrics_daily, sources)
data/snapshot.json         ข้อมูล demo จริง (แค่ 3 บัญชี: DrX, GRD V.2, P-FLOW 2)
```

### 3-tier data source (อัตโนมัติ)
1. **Supabase** (ถ้าตั้ง env + มี cache) — เร็ว มีประวัติย้อนหลัง
2. **Live** (ถ้ามี `META_ACCESS_TOKEN`) — เรียก Graph API ตรง ดึงทุกบัญชีที่ token เข้าถึง
3. **Demo** — `data/snapshot.json` (ตอนนี้อยู่โหมดนี้)

## 5. Env vars (ตั้งใน Vercel → Settings → Environment Variables)
| Key | ทำอะไร | หมายเหตุ |
|---|---|---|
| `DASHBOARD_PASSWORD` | รหัสเข้าเว็บ | **ตั้งก่อน META token เสมอ** · ว่าง = ไม่ล็อก |
| `META_ACCESS_TOKEN` | ดึงข้อมูลสด | System User, permission `ads_read`+`read_insights` |
| `META_AD_ACCOUNTS` | เจาะบัญชี (id คั่น ,) | ว่าง = ดึงทุกบัญชีที่ token เข้าถึง |
| `TIKTOK_ACCESS_TOKEN` / `TIKTOK_ADVERTISER_IDS` | TikTok | ยังไม่ authorize |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | cache+history | ออปชัน · service_role = ความลับสูงสุด |
| `CRON_SECRET` | กัน /api/sync | ต้องมีถ้าใช้ Supabase/cron |
| `SYNC_DAYS` | sync ย้อนหลังกี่วัน | default 7 |

## 6. บัญชี / ข้อมูลจริงที่เกี่ยวข้อง
- **Meta Ads (ผ่าน MCP ตอน dev):** ~16 บัญชี queryable (สกุล THB) ภายใต้ business "บัญชียิงแอด", "DrX Supplement by Pan", "AI พอร์ต Ads" ฯลฯ
- **บัญชีดึงไม่ได้ 3 ตัว:** GRD 1 (DISABLED), UNC 1 (UNSETTLED), บัญชียิงแอด GRD V.2 01 (MCP rollout)
- **สำคัญ:** Meta MCP ในเซสชัน Claude ใช้ดึงได้เฉพาะตอน dev — เว็บที่ deploy ต้องมี `META_ACCESS_TOKEN` ของตัวเอง (คนละอันกับ MCP)
- **GitHub:** repo อยู่ `kkulkeerati-droid` · **Vercel:** `stanamaharat-5791` (GitHub `stanamaharat-crypto`) — บัญชีไม่ตรง

## 7. ข้อจำกัด / เรื่องต้องรู้
- **Demo มีแค่ 3 บัญชี** — พอ live จะดึงครบทุกบัญชีเอง (เล่มรายงานจะเห็นครบ)
- **ปุ่มช่วงเวลา (วันนี้/7วัน/…) ในโหมด demo ไม่เปลี่ยนเลข** เพราะ snapshot คงที่ ไม่มีวันที่จริง — live ทำงานจริงทุกปุ่ม (มีโน้ตกำกับแล้ว)
- **CPR เทียบข้ามกลุ่มตรงๆ ไม่ได้เป๊ะ** — objective ต่างกัน (DrX=messaging/ทัก, P-FLOW=interactions, บางตัว=ซื้อ) การ์ดโชว์ประเภทกำกับ
- **Live โหลดช้าเมื่อบัญชีเยอะ** (ดึงทุกบัญชีสดตอนเปิดหน้า) → เปิด Supabase เพื่อ cache
- **Vercel Hobby ฟรี แต่ห้ามใช้เชิงพาณิชย์** ตาม license — ถ้าเก็บเงินลูกค้าค่อยขยับ Pro (~$20/mo) หรือย้าย Netlify (ฟรี)
- **Vercel Hobby จำกัด cron วันละ 1 ครั้ง** — `vercel.json` ตั้งไว้รายวัน (`0 1 * * *` = ตี 8 ไทย) แล้ว ห้ามตั้งถี่กว่านี้ไม่งั้น deploy fail · ถ้าอยาก sync ถี่ (เช่นทุก 5 นาที) ใช้ cron-job.org ยิง `/api/sync?key=<CRON_SECRET>` แทน
- **Verify แล้ว (2026-07-03):** `tsc --noEmit` ผ่าน + `next build` ผ่าน — โค้ดพร้อม deploy ทันทีที่ได้ token

## 8. งานถัดไปที่คุยกันไว้ (backlog)
- แถบ "สรุปคำแนะนำ" อัตโนมัติด้านบน (แปลตัวเลขเป็นคำสั่ง)
- Sparkline จิ๋วในการ์ดกลุ่ม · ทำมือถือ responsive · ดาวน์โหลด PNG · Heatmap รายชั่วโมง
- ดึงบัญชีจริงเพิ่มใน demo (ถ้าต้องการ) · เชื่อม TikTok/Google จริง · เปิด Supabase + cron
- ลิงก์แชร์ลูกค้าแบบ signed token (ให้ลูกค้าเปิดได้โดยไม่ต้องรู้รหัส)

## 9. วิธีทำงานกับโปรเจกต์
- verify จริงก่อนบอกเสร็จ (มี preview tools, ไม่มี test runner → curl API + screenshot)
- เปิด preview: `.claude/launch.json` config `ads-dashboard` (autoPort, `npm --prefix dashboard run preview`)
- ทุก commit ลงท้าย Co-Authored-By ตามปกติ · push แล้ว = อยู่ GitHub

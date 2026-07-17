# HANDOFF — Ads Group Dashboard (สรุปทั้งหมดสำหรับ session ถัดไป)

> อ่านไฟล์นี้ก่อนทำต่อ · อัปเดตล่าสุด: 2026-07-03

## 🆕 อัปเดต 2026-07-17 (branch `feat/product-roas-split`)
- **โค้ดในเครื่องย้ายมาที่ `/Users/thanatos66/Desktop/ads-group-dashboard`** (clone ใหม่จาก GitHub · path เก่าใน Downloads เลิกใช้)
- **กลุ่มสินค้าใหม่ตามที่ user กำหนด** (`lib/groups.ts`): ai=1 Click Ultra · a2=1 Click All Post · **สายพาน+rerun รวมเป็นกลุ่มเดียว "Rerun"** (เพิ่ม keyword `rerun`) · ap2=GPT · grd+urd · others. label เป็นชื่อสินค้าจริง
- **ช่วงเวลาครบ 8 ปุ่ม**: วันนี้/เมื่อวาน/3/7/14/30วัน/เดือนนี้/เดือนที่แล้ว (เพิ่ม last_3d, last_14d, last_month ใน `resolveRange` + UI)
- **เพิ่ม ROAS (pixel) ทั้ง pipeline**: `meta.ts` ดึง `action_values`+`actions` → `revenue`/`purchases` ต่อ ad → `aggregate` คิด `roas=revenue/spend` → การ์ด/บาร์/ตาราง (คอลัมน์ ROAS) + เมตริก ROAS/ยอดขาย(Meta) สลับได้ + ไฮไลต์เขียว/เหลือง/แดงเทียบ `roasTarget` (เป้า 3.0)
- **เผื่อ ROAS จริง (phase 2)**: `types` มี `realRevenue/realRoas`, `aggregate` รับ `realSales` param, migration `0002_revenue.sql` มีตาราง `product_sales_daily` (ยอดขายจริงต่อสินค้าต่อวัน) — ยังไม่ได้ต่อ UI กรอก/route อ่าน (ทำต่อ)
- **⚠️ ก่อน deploy ตัวนี้ทับ prod ต้อง**: (1) รัน `supabase/migrations/0002_revenue.sql` ใน Supabase prod ก่อน (ไม่งั้น `/api/sync` insert คอลัมน์ revenue/purchases ไม่ได้) (2) มี `META_ACCESS_TOKEN` ใน Vercel ถึงจะเห็นข้อมูลสด (ตอนนี้ยัง demo) (3) hourly realtime = ตั้ง cron-job.org ยิง `/api/sync?key=<CRON_SECRET>` ทุก 1 ชม.
- verify แล้ว: `tsc --noEmit` ผ่าน + รัน demo (port 3007) เห็นกลุ่ม/ROAS/8ช่วงครบ

## 1. โปรเจกต์นี้คืออะไร
เว็บ dashboard รวมค่าโฆษณา **Meta (+ TikTok เตรียมไว้) ทุก ad account** แล้วแบ่งตาม **prefix ชื่อ ads**:
`grd` · `ai` · `a2` · `สายพาน` · `ap2` · `others` (others = ที่ไม่เข้ากลุ่มไหน)

- **Stack:** Next.js 15 (App Router) + TypeScript · ไม่มี lib chart (วาด SVG เอง)
- **โค้ดในเครื่อง:** `/Users/thanatos66/Downloads/Kantamaze 01 - for Content Carousel/dashboard`
- **GitHub (private):** https://github.com/kkulkeerati-droid/ads-group-dashboard
- **รันในเครื่อง:** `cd dashboard && npm install && npm run dev` → http://localhost:3000

## 2. สถานะ deploy ตอนนี้ ✅ LIVE (2026-07-03)
- **🔗 URL: https://dashboard-ads-thanatos.vercel.app** — live + ล็อกรหัส (demo mode)
- **ล็อกรหัสแล้ว:** ตั้ง `DASHBOARD_PASSWORD` ใน Vercel prod env — รหัสอยู่กับ user (ผมสุ่มให้ครั้งแรก, user เปลี่ยนได้)
- **Vercel account (แก้ให้ตรงแล้ว):** ล็อกอิน `kkulkeerati-8562` · team/scope `pan-s-projects15` · project `dashboard`
  - _(handoff เก่าเขียนว่า Vercel เป็น `stanamaharat-5791` — ไม่จริงแล้ว)_
- **⛔ git auto-deploy ใช้ไม่ได้ (ตัดออกแล้ว):** ลอง `vercel git connect` + push แล้ว Vercel สร้าง deployment แต่ **build ไม่รัน ค้าง UNKNOWN ไม่มี log** (น่าจะ clone repo `kkulkeerati-droid` ไม่ได้ permission). เลย `vercel git disconnect` ทิ้ง. **วิธี deploy ที่เวิร์คจริง = `vercel redeploy <ready-id>`** (ดูข้างล่าง)
- **ยังเหลือ (ทำเมื่อพร้อมข้อมูลสด):** ใส่ `META_ACCESS_TOKEN` → redeploy → เว็บสลับจาก demo เป็น live เอง

### 🚀 วิธี deploy ที่ใช้ได้จริง (ทางเดียว — อัปเดต 2026-07-14)
```bash
cd dashboard && node scripts/deploy-api.mjs
```
ยิง Vercel REST API ตรง แนบไฟล์ base64 ใน request เดียว → build วิ่ง ~1 นาที + auto-alias production ให้เอง

### ⛔ วิธีที่พังถาวร — ห้ามเสียเวลาลองซ้ำ (พิสูจน์แล้ว 2026-07-03 → 07-14)
ทุกวิธีข้างล่างสร้าง deployment ได้แต่ **build ไม่เคยรัน** (status UNKNOWN, Builds `. [0ms]`, ไม่มี log, รอ 11 วันก็ไม่หาย, ลบตัวค้างแล้วก็ไม่หาย, project ใหม่ก็เป็น):
- `vercel --prod` / `--force` (CLI upload)
- `vercel deploy --prebuilt` (ค้างตอน upload)
- git auto-deploy (`vercel git connect` + push)
- `vercel redeploy <stuck-id>` → error "can not be redeployed"

ที่เคยใช้ได้: `vercel redeploy <Ready-id>` (แต่ reuse โค้ดเก่า — ส่งโค้ดใหม่ไม่ได้) · deployment แรกสุดของ project

### ใส่ META token ให้เป็น live (เมื่อพร้อม)
```bash
cd "/Users/thanatos66/Downloads/Kantamaze 01 - for Content Carousel/dashboard"
printf '%s' '<META_ACCESS_TOKEN>' | npx vercel env add META_ACCESS_TOKEN production
node scripts/deploy-api.mjs   # deploy วิธีเดียวที่ใช้ได้
```
> **กฎเหล็ก:** `DASHBOARD_PASSWORD` ต้องตั้ง**ก่อน** `META_ACCESS_TOKEN` เสมอ — ตอนนี้ตั้งแล้ว ✅ จึงใส่ META token ได้ปลอดภัย

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
- **✅ Supabase cache เปิดแล้ว (2026-07-14):** project `ads-dashboard-cache` (Supabase acc = GitHub `stanamaharat-crypto`, region Mumbai, URL `ehcwqikwwnqnusejtbbh.supabase.co`) · env ครบใน Vercel (SUPABASE_URL / SERVICE_ROLE_KEY / CRON_SECRET) · backfill ครบ 16 พ.ค.–ปัจจุบัน · ผลจริง: 30วัน 4s, 7วัน 3s (จาก 504/31s) · **กฎ: ช่วง "วันนี้ล้วน" ดึงสดเสมอ (realtime), ช่วงอื่น cache** · cron Vercel รายวัน 8 โมงไทย sync ย้อน 7 วัน · backfill เพิ่ม: `/api/sync?key=<CRON_SECRET>&since=&until=` ก้อนละ ≤4 วัน (เกินแล้ว timeout) · **กับดัก:** ads ชื่อซ้ำในบัญชีเดียว → upsertRows รวมแถวก่อนส่ง (แก้แล้ว) · DB password อยู่กับ user (ไม่ได้ใช้ ใช้ service_role key แทน) · อยากได้ intraday fresh ทุกช่วง → สมัคร cron-job.org ยิง sync ทุก 15 นาที (ออปชัน)
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

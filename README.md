# Ads Group Dashboard

Dashboard รวมค่าโฆษณา **Meta + TikTok ทุก ad account** แล้วแบ่งตาม **prefix ชื่อ ads**:
`grd` · `ai` · `a2` · `สายพาน` · `ap2` · `others`

## รันเลย (โหมด DEMO)

```bash
cd dashboard
npm install
npm run dev      # http://localhost:3000
```
ไม่ต้องมี token/Supabase ก็เห็นหน้าตา — ใช้ snapshot ข้อมูลจริงใน `data/snapshot.json`

## ฟีเจอร์

- **6 เมตริกต่อกลุ่ม** — สลับดู ค่าใช้จ่าย / ผลลัพธ์(ทัก) / ต้นทุนต่อผลลัพธ์(CPR) / CPM / Reach / Impressions
- **กราฟเทรนด์รายวัน** แยกสีต่อกลุ่ม (live = รายวันจริง, demo = ประมาณจากยอดรวม)
- **เตือนบัญชีที่ดึงไม่ได้** — โชว์บัญชี disabled/unsettled ที่ทำให้ยอดขาด
- **แก้กติกากลุ่มใน UI** — ปุ่ม ⚙︎ กลุ่ม เพิ่ม/ลบ/แก้ keyword + สี (เก็บ localStorage)
- **ตารางเรียงได้** — คลิกหัวคอลัมน์ (รายบัญชี + Top ads) เพื่อเรียง เช่น CPR แพงสุด / ผลลัพธ์เยอะสุด · คลิกซ้ำสลับ ▲▼
- **ลิงก์แชร์ลูกค้า** (🔗) — read-only ซ่อนปุ่มควบคุม · **Export CSV** (⬇︎) · **PDF** (🖨 = print)
- **auto-refresh 15 วิ** · ตัวกรองแพลตฟอร์ม/ช่วงเวลา

## 3 โหมดข้อมูล (อัตโนมัติตามที่ตั้งค่า)

| ลำดับ | เงื่อนไข | ที่มาข้อมูล |
|---|---|---|
| 1 | ตั้ง Supabase env + มีข้อมูลใน cache | **Supabase** (เร็ว มีประวัติย้อนหลัง) |
| 2 | มี `META_ACCESS_TOKEN` (หรือ TikTok) | **Live** — เรียก Graph API ตรง |
| 3 | ไม่มีอะไรเลย | **Demo** — `data/snapshot.json` |

## ต่อข้อมูลสด (LIVE)

```bash
cp .env.local.example .env.local
```
ใส่ `META_ACCESS_TOKEN` (System User, permission `ads_read` + `read_insights`)
→ รีสตาร์ท `npm run dev` → badge เปลี่ยนเป็น **LIVE** ดึงสดทุกบัญชี

## เปิด Supabase + cron auto-sync (เมื่อพร้อม)

1. สมัคร [supabase.com](https://supabase.com) → New project
2. SQL Editor → วางไฟล์ `supabase/migrations/0001_init.sql` → Run
3. ใส่ `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` ใน `.env.local`
4. ตั้ง [cron-job.org](https://cron-job.org): URL = `https://<โดเมน>/api/sync?key=<CRON_SECRET>` ทุก 5 นาที
   - (Vercel cron ราย ชม. เป็น backup อยู่ใน `vercel.json` แล้ว)
5. ยิง `/api/sync?key=<CRON_SECRET>` เองรอบแรกเพื่อเติมข้อมูล → badge เปลี่ยนเป็น **SUPABASE**

### TikTok
ใส่ `TIKTOK_ACCESS_TOKEN` + `TIKTOK_ADVERTISER_IDS` (adapter อยู่ที่ `lib/tiktok.ts`)

## แก้กติกากลุ่ม (โค้ด)
default อยู่ที่ [`lib/groups.ts`](lib/groups.ts) — จับแบบ **prefix + token boundary**
(ขึ้นต้นด้วย keyword แล้วตามด้วย `/ - _ | space` หรือจบสตริง กัน `aigen` หลุดเข้า `ai`)
ผู้ใช้ override ได้จากปุ่ม ⚙︎ กลุ่ม บนหน้าเว็บ (ส่ง config ไปที่ API ผ่าน query `groups`)

## โครงสร้าง
```
app/api/metrics/route.ts   รวมทุกแพลตฟอร์ม → แบ่งกลุ่ม (supabase→live→demo)
app/api/sync/route.ts      cron target — ดึง→เก็บ Supabase (กันด้วย CRON_SECRET)
app/dashboard.tsx          UI ทั้งหมด (cards/bar/trend/tables/editor/share/export)
lib/groups.ts              กติกาแบ่งกลุ่ม + classifier ที่ override ได้
lib/meta.ts                Meta Graph API (spend/impr/reach + แปลง actions→results)
lib/tiktok.ts              TikTok adapter
lib/supabase.ts            Supabase layer (no-op ถ้าไม่ตั้งค่า)
lib/aggregate.ts           รวม → group/account/topAds/series + เมตริกคำนวณ
supabase/migrations/       SQL schema
data/snapshot.json         ข้อมูล demo (จริงจาก MCP)
```

## deploy (Vercel)
push โฟลเดอร์ `dashboard/` → import ใน Vercel → ใส่ env vars → deploy

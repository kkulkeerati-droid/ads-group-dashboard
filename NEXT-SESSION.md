# คำสั่งงานสำหรับ session ถัดไป

> เขียน 11 ส.ค. 69 · **มีบั๊กระดับรากที่ต้องแก้ก่อนอย่างอื่นทั้งหมด — อ่านข้อ 1 ให้จบก่อนแตะอะไร**

---

## 0) อ่านก่อน (5 นาที)

```
1. ไฟล์นี้ ข้อ 1 ให้จบ        ← บั๊ก ad_id · ตัวเลขรายแอดทั้ง dashboard เชื่อไม่ได้ตอนนี้
2. skill ads-ops-thanatos     FACT LOCK + กติกาบ้าน
3. skill ads-maeao-method     สมองตัดสินใจ (อ่าน ebook ครบ 60 บทแล้ว)
4. WORKFLOW.md Phase 11-12    ของที่ทำไปแล้ว + บทเรียน
```

**สถานะ:** `https://dashboard-ads-thanatos.vercel.app` · รหัส `Sa12345678!`
deploy: `cd dashboard && node scripts/deploy-api.mjs` (⚠️ ไฟล์ใหม่ต้อง `git add` ก่อน)
repo หลัก `kkulkeerati-droid/ads-group-dashboard` · repo ส่งเพื่อน `kkulkeerati-droid/ads-dashboard-starter`

---

# 1) ⛔ บั๊กราก — dashboard ใช้ "ชื่อแอด" เป็น key แทน ad_id

## อาการ
ตัวเลข **รายแอด** ใน dashboard ไม่ตรงกับ Ads Manager · ตัวเลข **รวมทั้งบัญชี** ตรง

user จับได้เอง (11 ส.ค. 69) จากการเทียบหน้า Ads Manager ของ P-FLOW 2 ช่วง 4–10 ส.ค.

## สาเหตุ (พิสูจน์แล้ว ไม่ใช่สมมติฐาน)
ทีมยิงโครงสร้าง **1:1:3** แล้ว **ตั้งชื่อโฆษณาทุกตัวในชุดเหมือนกันเป๊ะ**
Meta มองเป็นคนละ ad (คนละ ad_id) · **P-FLOW 2 บัญชีเดียวมี 6,859 โฆษณา**

แต่ `lib/supabase.ts` ใช้ unique key `(platform, account_id, ad_name, date)`
→ บรรทัด 53-62 **รวมแถวที่ชื่อซ้ำเข้าด้วยกันก่อน upsert** (ที่ต้องรวมเพราะไม่งั้น Postgres error 21000)
→ **ทุกโฆษณาที่ชื่อเดียวกันกลายเป็นแถวเดียว**

## หลักฐาน (ดึงจาก Meta MCP `ads_get_ad_entities` level=ad ช่วง 4–10 ส.ค.)

`1 Cut/Buy/600/21Jul` มี 3 ad ID:
```
฿554.14 + ฿147.92 + ฿122.38 = ฿824.44   ← dashboard รายงาน ฿824 (ตรงเป๊ะ = ยืนยันว่ารวมจริง)
```

`AI/Ultra/600/7Aug` มี 4 ad ID — **ตัวเดียวแบกทั้งชุด**:
| ad ID | ค่าแอด | ROAS | ซื้อ |
|---|---|---|---|
| …438208910686 | ฿429.66 | **14.15** | 4 |
| …438208890686 | ฿148.14 | – | 0 |
| …499809670686 | ฿138.88 | – | 0 |
| …499809680686 | ฿138.19 | – | 0 |
| **dashboard โชว์** | **฿937** | **6.49** | 4 |

ชื่ออื่นที่ซ้ำเหมือนกัน: `AI/Buy/GPT/600/2Aug` ×3 · `GPTแฟชั่น/600/8Aug` ×3 ·
`AI/RE180/Ultra/600/2Aug` ×2 · `AI/1CC/600/7Aug` ×2 · `AI/ยอดขาย/1CC/600/4Aug` ×2 ·
`AI/RE365/GPT/600/2Aug` ×2 · `AI/ยอดขาย/Ultra/600/4Aug` ×2 · `1 CUT/500/8Aug` ×2 · `AI/Ultra/600/8Aug` ×2

## ผลกระทบ — แยกให้ชัดว่าอะไรพัง อะไรไม่พัง

**🔴 พัง (ทุกอย่างที่ตัดสิน "รายแอด"):**
- ธง 🟢🟡🟠🔴 ในตาราง Top ads (`lib/decide.ts` → `decideAd`)
- คำสั่งทุกข้อในหน้า `/brief` (`lib/ae.ts` → `callFor`) — STOP/SCALE/CLONE/REDUCE/FIX_OFFER
- `fatigueOf` · `scaleVerdict` · `costIsStable` · `cloneChecks` · `budgetBumps`
- `activeDays` (นับวันของทุกตัวรวมกัน ไม่ใช่ตัวเดียว)
- **ตัวชนะถูกกลบ** — ROAS 14.15 กลายเป็น 6.49 แล้วตกด่านสเกล

**🟢 ไม่พัง (ทุกอย่างที่เป็นผลรวม):**
- ยอดรวมบัญชี/กลุ่ม/สินค้า — ยืนยันแล้ว: P-FLOW 2 ยอดขาย ฿30,301.79 ✅ ออเดอร์ 88 ✅
- funnel / funnel × สินค้า / กราฟรายวัน / Content Ads (ทุกอันเป็น sum)
- `namingGaps` (ดูจากชื่อ ไม่ได้ดูจากตัวเลข)

> ⚠️ ค่าแอดรวม P-FLOW 2: Meta ฿14,333.92 vs dashboard ฿14,605 (ต่าง ฿271 = 1.9%)
> **ยังไม่รู้สาเหตุ** — เดาว่า sync lag หรือ Meta อัปเดตย้อนหลัง · ต้องเช็คด้วย

---

## 2) แผนแก้ — เปลี่ยน key เป็น ad_id

### ขั้น 1 · Supabase migration (ส่วนที่เสี่ยงสุด ทำก่อนและทำอย่างเดียว)
สร้าง `supabase/migrations/0003_ad_id.sql` แล้วรันใน Supabase → SQL Editor

**แนะนำท่าปลอดภัย: เพิ่มคอลัมน์ + สร้าง unique index ใหม่ที่ fallback ไปที่ชื่อเมื่อ ad_id ว่าง**
(ข้อมูลเก่าไม่มี ad_id — ถ้าบังคับ ad_id ไม่ null จะพังทันที)
```sql
alter table public.ad_metrics_daily add column if not exists ad_id text;

-- unique ใหม่: มี ad_id ใช้ ad_id · ไม่มี (แถวเก่า) ใช้ชื่อเหมือนเดิม
create unique index if not exists uq_metrics_adid
  on public.ad_metrics_daily (platform, account_id, coalesce(ad_id, ad_name), date);

-- ยังไม่ต้อง drop ของเดิม จนกว่าจะ re-sync ครบและยืนยันตัวเลขแล้ว
```
⚠️ `on_conflict` ของ PostgREST ต้องชี้ไปที่ index นี้ — **เทสกับ 1 วันก่อน แล้วค่อยยิงทั้งช่วง**
ถ้า PostgREST ไม่รับ expression index ให้ถอยไปท่า B: สร้างตารางใหม่ `ad_metrics_daily_v2`
ที่มี `unique (platform, account_id, ad_id, date)` แล้วย้าย read/write ไปที่ตารางใหม่ (roll back ง่ายกว่า)

### ขั้น 2 · `lib/meta.ts`
```
fields=ad_name,... → เพิ่ม ad_id
rows.push({ ..., adId: r.ad_id })
```

### ขั้น 3 · `lib/types.ts`
`AdRow` เพิ่ม `adId?: string`

### ขั้น 4 · `lib/supabase.ts`
- `upsertRows` map `ad_id: r.adId || null`
- **แก้ dedupe key บรรทัด 57** `${platform}|${account_id}|${ad_name}|${date}` → ใส่ `ad_id` แทน `ad_name`
  (ยังต้องมี dedupe ไว้ กันเคส Meta คืน ad_id ซ้ำในหน้าเดียว)
- `on_conflict=` เปลี่ยนให้ตรง index ใหม่
- `readRows` map `adId: d.ad_id`

### ขั้น 5 · `lib/ae.ts` → `buildAdViews`
```
const key = `${r.accountId}::${r.adName}`   // เดิม
const key = `${r.accountId}::${r.adId || r.adName}`   // ใหม่ (fallback กันข้อมูลเก่า)
```
`AdView` เพิ่ม `adId` ไว้โชว์/debug

### ขั้น 6 · `lib/aggregate.ts`
`adMap` key `${accKey}::${r.adName}` → ใส่ adId · **`groupAds` / `names` Set ที่ใช้นับจำนวน ads ต้องเปลี่ยนตาม**
(ไม่งั้นจำนวน ads จะยังนับแบบรวมชื่อ)

### ขั้น 7 · ⚠️ สิ่งที่จะพังตามหลังแก้ — ต้องจัดการด้วย
1. **ชื่อซ้ำจะกลายเป็นหลายแถวในตาราง** → user จะงงว่าทำไมเห็นชื่อเดียวกัน 4 บรรทัด
   → ต้องโชว์ตัวแยก เช่น `AI/Ultra/600/7Aug` + ท้าย ad_id 6 ตัว หรือ `(1/4)`
2. **`cloneChecks` จับตัวแม่จากชื่อ** — พอชื่อซ้ำหลายตัว `byName` จะชี้ผิดตัว
   → ต้องคิดใหม่ว่า "ตัวแม่" คือ ad_id ไหน (อาจต้องใช้ adset_id หรือ created_time)
3. **`namingGaps` จะเสนอชื่อซ้ำกันเอง** (4 แถวชื่อเดียวกัน → เสนอชื่อใหม่เหมือนกัน 4 อัน)
   → รวมแสดงเป็นกลุ่มตามชื่อ แต่คิดตัวเลขรายตัว
4. **`scripts/selftest.mjs` ต้องเพิ่มเทสเคสชื่อซ้ำ** — สร้าง 2 ad ID ชื่อเดียวกัน แล้วยืนยันว่าไม่ถูกรวม
5. **ต้อง re-sync ข้อมูลย้อนหลัง** ให้ ad_id เต็ม (`/api/sync?key=<CRON_SECRET>&since=&until=` ทีละ ≤3-4 วัน)
   แถวเก่าที่ ad_id ว่างจะอยู่คู่กับแถวใหม่ → **ต้องลบแถวเก่าของช่วงที่ re-sync แล้ว** ไม่งั้นนับซ้ำ

### ขั้น 8 · reverse-check ก่อนบอกว่าเสร็จ
เทียบกับ Ads Manager ตรง ๆ อย่างน้อย 3 ตัวเลข:
```
P-FLOW 2 · 4–10 ส.ค. · ค่าแอด ฿14,333.92 · ยอดขาย ฿30,301.79 · ออเดอร์ 88 · ROAS 2.11
AI/Ultra/600/7Aug (ad …438208910686) → ค่าแอด ฿429.66 · ROAS 14.15 · ซื้อ 4
1 Cut/Buy/600/21Jul → ต้องแยกเป็น 3 แถว (฿554.14 / ฿147.92 / ฿122.38) ไม่ใช่ ฿824 แถวเดียว
```

---

## 3) ตัวเลขจริงราย ad_id ที่ดึงไว้แล้ว (P-FLOW 2 · 4–10 ส.ค. · ใช้เทียบตอนแก้เสร็จ)

| ad ID (ท้าย) | ชื่อ | ค่าแอด | ยอดขาย | ROAS | ซื้อ |
|---|---|---|---|---|---|
| …910686 | AI/Ultra/600/7Aug | ฿429.66 | ฿6,080 | **14.15** | 4 |
| …330686 | AI/1CC/600/7Aug | ฿92.92 | ฿890 | **9.58** | 1 |
| …040686 | GPTแฟชั่น/600/8Aug | ฿327.32 | ฿1,599 | **4.89** | 3 |
| …000686 | AI/RE180/Ultra/600/2Aug | ฿264.77 | ฿1,211 | **4.57** | 3 |
| …280686 | 1 Cut/Buy/600/29Jul | ฿241.39 | ฿990 | **4.10** | 3 |
| …090686 | 1 Cut/ยอดขาย/600/28Jul | ฿275.26 | ฿1,000 | 3.63 | 1 |
| …510686 | AI/ยอดขาย/Ultra/600/23Jul | ฿792.05 | ฿2,870 | 3.62 | 2 |
| …340686 | AI/1CC/600/7Aug | ฿401.47 | ฿1,404 | 3.50 | 4 |

⛔ **อย่าเอา ROAS 263.74 (฿4.55) และ 64.10 (฿18.72) ไปใช้** — ออเดอร์เดียว ไม่ใช่หลักฐาน
⛔ **อย่าปิดตัวที่ชื่อซ้ำแล้วยอด ๐** — นั่นคือวิธีทำงานของ 1:1:3 (ebook: *"หน้าที่ของ 3 ตัวไม่ใช่ให้เก่งเท่ากัน แต่มีไว้หาตัวแบก"*) งบไหลไปหาตัวชนะเอง

**เช็คบัญชีอื่นด้วย** — ยืนยันแล้วแค่ P-FLOW 2 · P-FLOW 3/4 · RID X 002 · AI 002 · UNC 2 ยังไม่ได้ดู

---

## 4) เรื่องอื่นที่ยังค้าง

### 4.1 ⚠️ จำนวนออเดอร์เหวี่ยงผิดปกติ (ยังไม่พิสูจน์)
| วัน | ยอดขาย | ออเดอร์ | basket |
|---|---|---|---|
| 3 ส.ค. | ฿7,649 | **168** | ฿46 |
| 6 ส.ค. | ฿6,458 | 61 | ฿106 |
| 10 ส.ค. | ฿7,170 | **4** | **฿1,793** |

ยอดขายนิ่ง แต่ออเดอร์เหวี่ยง 40 เท่า
**สมมติฐาน (ยังไม่พิสูจน์):** `lib/meta.ts` หยิบ **จำนวน** จาก `findFirst(r.actions, PURCHASE_TYPES)`
และ **มูลค่า** จาก `findFirst(r.action_values, PURCHASE_TYPES)` — เป็นคนละ `action_type` กันได้
วิธีพิสูจน์: ดึง raw `actions` + `action_values` ของวันที่ 3 กับ 10 ส.ค. มาดูว่า type ไหนมีค่าบ้าง
**สำคัญ** เพราะ "จำนวนออเดอร์" คือด่านที่บล็อกการสเกลอยู่ (บันไดออเดอร์ 10/20/30)

### 4.2 📲 Telegram — ต้องให้ user ทำเอง
Vercel production มีแค่ `CRON_SECRET` · ยังไม่มี `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`
```
1. Telegram → @BotFather → /newbot → ได้ token
2. ทักบอทตัวเอง 1 ข้อความ (บอทส่งหาคนที่ไม่เคยทักไม่ได้)
3. https://api.telegram.org/bot<TOKEN>/getUpdates → เอา chat.id
```
```bash
cd "/Users/thanatos66/Downloads/Kantamaze 01 - for Content Carousel/dashboard" && npx vercel env add TELEGRAM_BOT_TOKEN production
```
ข้อความเรนเดอร์เทสแล้ว 3,786 ตัวอักษร tag ครบ — ใส่ token แล้วส่งได้เลย
⚠️ `CRON_SECRET` เป็น Sensitive **อ่านกลับไม่ได้** ต้องขอจาก user หรือ rotate + `gh secret set`

### 4.3 อ่าน targeting / งบ จาก Meta แทนการเดาจากชื่อ
research แล้วว่าทำได้ — `targeting` · `daily_budget` · `created_time` · `effective_status` (ระดับ adset)
**ทำพร้อมกับข้อ 2 ได้เลย** เพราะต้องแตะ `lib/meta.ts` + Supabase migration เหมือนกัน — ตีสองงานด้วยหินก้อนเดียว
รายละเอียดใน WORKFLOW.md Phase 12 ข้อ 4

### 4.4 backlog เดิม
กราฟ ROAS รายวัน (series มี byGroup/byFunnel แล้ว ขาด revenue/replies ต่อวัน) ·
ต่อ Google Sheets · offline conversion กลับเข้า Meta · TikTok token

---

## 5) ⚠️ กับดักที่เจ็บมาแล้ว — อย่าเหยียบซ้ำ

1. **⭐ อย่าเชื่อว่า "1 แถวใน dashboard = 1 โฆษณา"** — ต้องเช็คก่อนเสมอว่าหน่วยนับตรงกับ Ads Manager ไหม
   **ท่าเช็ค:** เทียบผลรวมบัญชีก่อน (ต้องตรง) แล้วเทียบรายตัว (ถ้าไม่ตรง = หน่วยนับต่างกัน)
2. **`\b` ใน regex ใช้กับคำไทยไม่ได้** — `/สำเนา\b/` ไม่ match และไม่ error (ทำให้ clone เช็คเงียบไปทั้งฟีเจอร์)
3. **screenshot ของ Browser pane คืนภาพดำ** · `resize_window` ทำให้ `innerWidth = 0` ได้
   → เช็ค `innerWidth > 0` ก่อนเชื่อผลวัด · ตรวจสีด้วย `getComputedStyle` · ธีมใช้ `data-theme` ไม่ใช่ `prefers-color-scheme`
4. **ลิสต์ hardcode ทำให้ของใหม่หายเงียบ** — `briefToTelegram` ยังมีลิสต์ `groups` ของตัวเอง ต้องเติมมือ
5. **ข้อความ Telegram ห้ามตัดกลาง HTML tag** — Telegram ตอบ 400 แล้วไม่ส่งทั้งข้อความ
6. **`deploy-api.mjs` ส่งเฉพาะไฟล์ที่ `git ls-files` เห็น** → ไฟล์ใหม่ต้อง `git add` ก่อน
7. **หน้าเว็บเป็น client-side** — `curl` เห็นแค่โครงเปล่า
8. **ห้ามเชิญเพื่อนเข้า repo หลัก** (มีรหัสใน git history) → ใช้ `ads-dashboard-starter`
9. **MCP `ads_get_ad_entities` + `targeting` payload ใหญ่มาก** (380KB) → เกิน token limit
   MCP จะเซฟลงไฟล์ให้ ต้อง parse ด้วย python จากไฟล์นั้น
10. **แมปชื่อแอดที่เดาไม่ได้ → ถาม user รวบครั้งเดียว ห้ามเดา**

---

## 6) ตัวเลขอ้างอิง — แยกว่าอันไหนเชื่อได้

**✅ เชื่อได้ (ยืนยันกับ Meta ตรง ๆ แล้ว)**
```
P-FLOW 2 · 4-10 ส.ค. : ฿14,333.92 → ฿30,301.79 · ROAS 2.11 · ออเดอร์ 88
targeting: แอดที่ชื่อไม่บอกกลุ่ม = ปล่อยกว้างจริง (ตรวจ 24 adset ตรง 24/24)
funnel 7 วัน: TOF 74% · MOF 26% · BOF 0% (BOF 0 คือของจริง บ้านนี้ไม่มี RE7/30/60)
เส้น ROAS ที่ user กำหนด: 🟢 ≥3.5 · 🟡 2-3.5 · 🟠 1-2 · 🔴 <1
```

**❌ ยังเชื่อไม่ได้จนกว่าจะแก้ ad_id**
```
ROAS/ค่าแอด/ออเดอร์ "รายแอด" ทุกตัวใน dashboard และหน้า /brief
คำสั่ง STOP/SCALE/CLONE/REDUCE ทั้งหมด
จำนวนออเดอร์รวม (ดูข้อ 4.1)
```

---

## 7) ✅ เช็คลิสต์ก่อนบอกว่าเสร็จ

- [ ] `node scripts/selftest.mjs` ผ่าน (เพิ่มเทสเคสชื่อซ้ำก่อน)
- [ ] `npx tsc --noEmit` + `npm run build` ผ่าน
- [ ] `git add` ไฟล์ใหม่ → `node scripts/deploy-api.mjs` → READY
- [ ] **reverse-check กับ Ads Manager** ตามข้อ 2 ขั้น 8 — ทั้งผลรวมและรายตัว
- [ ] เปิดเบราว์เซอร์จริง (`innerWidth > 0` ก่อน) · overflow = 0 · ไม่มี NaN · ทั้ง 2 ธีม
- [ ] sync เข้า `~/Desktop/claude/ads-dashboard-starter/` + สแกนของลับ
      (`Sa12345678` · `P-FLOW|RID X|DrX|GRD V` · account id · `dashboard-ads-thanatos` · `team_4MXqJ`)
- [ ] commit + push ทั้ง 2 repo
- [ ] อัปเดต `WORKFLOW.md` + ไฟล์นี้
- [ ] แปะ markdown link ทุกไฟล์ท้ายสรุป

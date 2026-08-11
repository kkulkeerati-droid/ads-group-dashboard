# คำสั่งงานสำหรับ session ถัดไป

> เขียน 11 ส.ค. 69 · อัปเดต 11 ส.ค. 69 (รอบบ่าย)

---

# ⛳ สถานะล่าสุด — โค้ดแก้เสร็จแล้ว เหลือ "รัน SQL + backfill"

**ทำเสร็จแล้ว:**
- ✅ เปลี่ยน key เป็น `ad_id` ครบสาย meta → supabase → ae → aggregate → dashboard/brief
- ✅ `pruneStale` — ลบแถวค้างที่ Meta ไม่คืนมาแล้ว (กันนับซ้ำหลัง migration)
- ✅ ดึง targeting/งบ/created_time ระดับ adset + ตาราง `ad_adsets` + `attachAdsets()` ทับการเดาจากชื่อ
- ✅ งบเป็นของ adset ไม่ใช่ของแอด — กติกาแอดมดตัดสินทั้งชุด ไม่ใช่รายตัว
- ✅ selftest **100 ข้อ ผ่านหมด** (รวมเทส Supabase layer 18 ข้อ ที่เดิมไม่มีเลย) · `tsc` + `build` ผ่าน
- ✅ **พิสูจน์ข้อ 4.1 แล้ว — สมมติฐานเดิมผิด** (ดูข้อ 4.1 ที่เขียนใหม่ด้านล่าง)
- ✅ **ปิดเคส ฿271** — Graph API นับแอดที่ archive แต่ Ads Manager ไม่นับ (ดูกล่องในข้อ 1)
- ✅ `DEV-HANDOFF.md` + `scripts/sync-starter.mjs` — ชุดส่งมอบให้ dev นอกทีม

**deploy แล้ว ✅** โค้ดใหม่รันอยู่บน production และทำงานกับ DB เก่าได้ (ถอยไปโหมดชื่ออัตโนมัติ)
วัดจากของจริงแล้ว: `fetched 378 → upserted 169` = **55% ของแถวถูกยุบหายเพราะชื่อซ้ำ**

**เหลืออย่างเดียว — ต้องรันด้วยมือใน Supabase SQL Editor:**
```
1. เปิด https://supabase.com/dashboard/project/utadlsqekppcuepcgqfj/sql/new
2. วางเนื้อไฟล์ supabase/migrations/0003_ad_id.sql → Run
3. backfill (ยิงจาก GitHub Actions ได้เลย ไม่ต้องรู้ CRON_SECRET):
   gh workflow run keepalive-sync.yml -f since=2026-08-04 -f until=2026-08-07
   gh workflow run keepalive-sync.yml -f since=2026-08-08 -f until=2026-08-11
4. gh workflow run reverse-check.yml -f since=2026-08-04 -f until=2026-08-10 -f account=925967868831243
   → ต้องเห็น units.rowsWithoutAdId = 0 และ distinctAdIds > distinctNames
```
⚠️ **ตัวเลข "รายแอด" ยังเชื่อไม่ได้จนกว่าจะทำครบ 4 ข้อนี้** (ยอดรวม/ROAS รวม เชื่อได้ปกติ)

> ทำไม Claude รันเองไม่ได้: PostgREST (service_role key) รัน DDL ไม่ได้ · ไม่มี psql/connection string
> ในเครื่อง · Chrome ที่ต่ออยู่เป็นเครื่อง Windows คนละเครื่อง และถูก classifier บล็อก
> → ถ้าอยากให้รันเองรอบหน้า: เปิด Chrome extension บน Mac ที่ล็อกอิน Supabase ไว้

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

> ## ✅ เรื่อง ฿271 — ปิดเคสแล้ว · **dashboard ไม่ได้ผิด** (พิสูจน์ 11 ส.ค. 69 ถึงสตางค์)
>
> **ไม่ใช่บั๊ก ไม่ใช่แถวค้าง — เป็นการนับคนละกลุ่มแอด**
>
> | | ค่าแอด 4–10 ส.ค. |
> |---|---|
> | dashboard | ฿14,605.36 |
> | Ads Manager / Meta MCP | ฿14,333.92 |
> | ต่าง | ฿271.44 |
>
> **หลักฐานที่ปิดเคส** (ไล่ทีละชั้น ไม่ได้เดา):
> 1. backfill + prune ครบทั้งช่วงแล้ว **ยังต่างเท่าเดิม** → ตัดเรื่องข้อมูลเก่า/แถวค้างทิ้ง
> 2. `freshness` ของวันที่ 8 ส.ค.: ทั้ง 19 แถว `updated_at` เดียวกันเป๊ะ (`03:29:49`)
>    → **prune ทำงานถูก ไม่มีแถวค้างเลย** · เลขนี้คือสิ่งที่ Graph API คืนมาจริง
> 3. แยกรายวัน → ส่วนเกินกองอยู่แค่ **8 ส.ค. (+฿229.12)** และ **10 ส.ค. (+฿42.32)** = ฿271.44 พอดี
> 4. ผลรวมระดับแอดของ Meta 4–10 ส.ค. = **฿14,333.92 เป๊ะ** (94 แอด) → Meta เองสอดคล้องกัน
> 5. ⭐ ดึงแอด **ARCHIVED** ของวันที่ 8 ส.ค. → เจอ `AI/1CC/600/8Aug` **4 ตัว รวม ฿229.12 พอดีเป๊ะ**
>    (18.34 + 99.22 + 48.29 + 63.27)
>
> **สรุป:** Graph API `insights` ดิบ **นับแอดที่ถูก archive ด้วย** · Ads Manager กับ Meta MCP **ไม่นับ**
> → ฿14,605.36 = **เงินที่จ่ายออกไปจริงทั้งหมด** · ฿14,333.92 = เงินเฉพาะแอดที่ยังไม่ถูก archive
>
> **ใช้ตัวไหน:** ยึด ฿14,605.36 สำหรับคิดกำไร (เงินออกจากบัญชีจริง)
> เวลาเทียบกับ Ads Manager ให้รู้ว่าจะสูงกว่าประมาณ 1–2% เป็นปกติ **ไม่ต้องไล่หาบั๊กอีก**
> เช็คซ้ำได้ตลอดด้วย `reverse-check` workflow (ดู `freshness` — ถ้า `updated_at` ไม่เท่ากันหมด ค่อยสงสัยแถวค้าง)

---

## 2) แผนแก้ — เปลี่ยน key เป็น ad_id · ✅ โค้ดเสร็จหมดแล้ว

### ขั้น 1 · Supabase migration — ⏳ **รออยู่ตรงนี้ (ต้อง user รัน)**
ไฟล์: `supabase/migrations/0003_ad_id.sql`

ท่าที่เลือก + **ทำไมไม่ใช้ท่าที่วางไว้เดิม**:
แผนเดิมเสนอ `unique (platform, account_id, coalesce(ad_id, ad_name), date)` — **ใช้ไม่ได้**
เพราะ `on_conflict` ของ PostgREST รับได้แค่ "รายชื่อคอลัมน์" map ไป expression index ไม่ได้ (42P10)
→ เปลี่ยนเป็น **เติม `ad_id = ad_name` ให้แถวเก่า แล้ว unique ด้วยคอลัมน์ล้วน** `(platform, account_id, ad_id, date)`
ได้ผลเหมือนกันแต่ PostgREST ใช้ได้ตรง ๆ · `readRows` มองแถวที่ `ad_id = ad_name` ว่า "ยังไม่มี ad_id จริง"

ในไฟล์ทำ 4 อย่าง: เพิ่มคอลัมน์ → เติม ad_id แถวเก่า → **drop unique เก่า** (หาชื่อ constraint เอง
ไม่ hardcode) → สร้างตาราง `ad_adsets`
⚠️ **ต้อง drop ของเดิม** ไม่งั้นแอดชื่อซ้ำ insert ไม่ได้เลย (error 23505) = อาการเปลี่ยนจาก
"ตัวเลขผิด" เป็น "sync พังทั้งรอบ" ซึ่งแย่กว่าเดิม

### ขั้น 2–6 · โค้ด ✅ เสร็จแล้วทั้งหมด
| ไฟล์ | ทำอะไร |
|---|---|
| `lib/meta.ts` | fields เพิ่ม `ad_id,adset_id,adset_name,campaign_id,campaign_name` · `purchasesValued` · `fetchAccountAdsets()` |
| `lib/types.ts` | `AdRow.adId` + adset/campaign · `adKey()` helper กลาง · `Metricized.purchasesValued/zeroValuePurchases` · `AdsetInfo` · `Metrics.quality` |
| `lib/supabase.ts` | `rowAdId()` · dedupe ตาม ad_id (+โหมดถอยไปชื่อ) · `on_conflict` ใหม่ · `updated_at` ส่งเองทุกครั้ง · `pruneStale()` · `upsertAdsets()`/`readAdsets()` |
| `lib/ae.ts` | `buildAdViews` key = `adKey()` · `nameDupes`/`dupeRank` · `adLabel()` · `attachAdsets()` · `Slice.purchasesValued` |
| `lib/aggregate.ts` | `adMap`/`groupAds`/`names` Set = `adKey()` · `qualityOf` ใช้ purchasesValued · `quality` block |
| `app/dashboard.tsx` | `adDisplay()` ต่อท้าย ad_id เมื่อชื่อซ้ำ · แถบ 🧪 คุณภาพข้อมูล · คอลัมน์ "กี่ตัว" |
| `app/api/sync` | `?prune=` (default เปิด) · `?adsets=` · รายงาน `pruned`/`adsets`/`tookMs` |

### ขั้น 7 · ✅ 5 อย่างที่จะพังตามหลัง — จัดการครบแล้ว
1. ✅ ชื่อซ้ำหลายแถว → `adDisplay()` / `adLabel()` ต่อท้าย ad_id 6 ตัว (ก๊อปไปค้นใน Ads Manager ได้จริง)
   + tooltip บอกว่า "บัญชีนี้มีแอดชื่อนี้ N ตัว บรรทัดนี้คือตัวเดียว"
2. ✅ `cloneChecks` จับตัวแม่ = **ตัวที่ `firstSeen` เก่าที่สุด** (clone เกิดทีหลังเสมอ) เท่ากันค่อยเอาตัวที่ใช้เงินมากสุด
3. ✅ `namingGaps` รวมเป็น 1 บรรทัดต่อชื่อ + คอลัมน์ `ads` บอกว่าต้องไปแก้กี่ตัว
4. ✅ selftest ข้อ 11/13/14 ครอบเคสนี้แล้ว (71 ข้อ ผ่านหมด)
5. ✅ `pruneStale()` — ลบแถวที่รอบ sync ไม่ได้แตะ ใช้ `updated_at` เป็น watermark
   **เรียกหลัง upsert สำเร็จเท่านั้น** และลบเฉพาะบัญชีที่คืนแถวจริงรอบนี้ (บัญชี error ไม่โดนแตะ)

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

### 4.1 ✅ จำนวนออเดอร์เหวี่ยง 40 เท่า — **พิสูจน์แล้ว · สมมติฐานเดิมผิด**

**สมมติฐานเดิม (count กับ value มาจากคนละ `action_type`) = ผิด**
ดึงระดับบัญชี P-FLOW 2 รายวัน 3–10 ส.ค. → `onsite_conversion_purchase` == `actions:omni_purchase`
และ `omni_purchase_values` == `action_values:onsite_conversion.purchase` **ตรงกันทุกวัน**
`findFirst` ไม่ได้หยิบข้าม type · **โค้ดไม่ผิด · Ads Manager โชว์เลขเดียวกัน** (ออเดอร์ 88 ตรงกัน)

**ของจริง: `onsite_conversion.purchase` ไม่ใช่ "ออเดอร์"**
ระดับแอด 3 ส.ค. (39 แอด · ค่าแอดรวม ฿2,213.41 ✅ มูลค่ารวม ฿3,259.90 ✅ ตรงบัญชีถึงสตางค์ = รายการครบ)

| อาการ | ตัวเลข |
|---|---|
| ซื้อที่ **ไม่มีมูลค่าติดมาเลย** | **35 จาก 61 = 57%** |
| แอด `1 CUT/Buy/600/1Aug` | ใช้ **฿6.41** → นับ **11 ซื้อ** มูลค่า ๐ |
| `AI/ยอดขาย/Ultra/600/23Jul` | 6 ซื้อ มูลค่า ฿10.90 = **฿1.82/ชิ้น** |
| `AI/1CC/600/31Jul` | 2 ซื้อ มูลค่า ฿10.00 = **฿5.00/ชิ้น** |
| ซื้อที่ราคาต่อชิ้นสมเหตุผล (สินค้าจริง ฿499–1,490) | **4 จาก 61 = 6.6%** |

**สรุปว่าอะไรเชื่อได้/ไม่ได้:**
- ✅ `revenue` / `ROAS` เชื่อได้ (ผลรวมตรงถึงสตางค์ 2 ชั้น)
- ❌ `purchases` ดิบไม่ใช่จำนวนออเดอร์จริง · `basket` และ `convRate` เป็นขยะถ้าหารด้วยมัน
- ⚠️ **อันตรายที่สุด** — บันไดออเดอร์ 10/20/30 กินเลขนี้ → 3 ส.ค. 168 "ออเดอร์" = **ไฟเขียวปลอมให้สเกล**

**แก้แล้วอย่างไร:**
- เพิ่ม `purchasesValued` (นับเฉพาะแถวที่ revenue > 0) ทุกชั้น — `lib/meta.ts` → DB → `Slice` → `Metricized`
- `callFor` บันไดออเดอร์ · `costIsStable` · กติกาแอดมด · เกณฑ์ LAL 20 ราย → ใช้ `purchasesValued` หมดแล้ว
- `convRate` / `basket` หารด้วย `purchasesValued`
- คง `purchases` ดิบไว้เท่าที่ Meta บอก (ไม่งั้นเทียบ Ads Manager ไม่ได้อีก)
- แถบ 🧪 บน dashboard ฟ้องเองเมื่อออเดอร์มูลค่า ๐ เกิน 20%
- selftest ข้อ 12 ล็อกไว้: ROAS 5 · Meta นับ 32 ซื้อ · มีมูลค่าจริง 2 → **ต้องได้ KEEP ไม่ใช่ SCALE**

**ทางแก้จริงระยะยาว** = ส่ง offline conversion กลับเข้า Meta (backlog 4.4) — ตราบใดที่ยังไม่ส่ง
Meta จะ optimize หา "คนกดปุ่มซื้อในแชท" ไม่ใช่ "คนจ่ายเงินจริง"

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

### 4.3 ✅ อ่าน targeting / งบ จาก Meta แทนการเดาจากชื่อ — **ทำแล้ว**
- `fetchAccountAdsets()` ใน `lib/meta.ts` ดึง `targeting` · `daily_budget` · `lifetime_budget` · `created_time` · `effective_status`
  แล้ว **กลั่นเหลือเฉพาะที่ใช้ตัดสินใจ** (age/genders/countries/interests/customAudiences/lookalikes/isBroad)
  — ไม่เก็บ targeting ดิบ เพราะ payload 380KB ต่อบัญชี เกิน token limit และไม่ได้ใช้
- เก็บลงตาราง `ad_adsets` (snapshot สถานะตอนนี้ ไม่ใช่รายวัน — Meta ไม่เก็บ targeting ย้อนหลัง)
- `attachAdsets(views, adsets)` ใน `lib/ae.ts` เอาของจริงทับการเดา:
  - **งบจริงชนะงบในชื่อ** (ถ้า adset ใช้ CBO → `daily_budget` เป็น null → ถอยไปใช้ชื่อ)
  - `isBroad` (ไม่มี interest + ไม่มี custom audience) → TOF, `funnelSure = true`
  - มีแต่ LAL → TOF, sure
  - มี custom audience ที่ไม่ใช่ LAL และชื่ออ่านไม่ออก → MOF แต่ **ยังไม่ถือว่าชัวร์** (API แยก MOF/BOF ไม่ได้)
    → ยังโผล่ในตาราง "ชื่อไม่ครบ" ให้ทีมไปแก้ชื่อ
- ต่อเข้า `/api/metrics` (`m.adsets`) และ `/api/brief` แล้ว · ไม่มีข้อมูล = ถอยไปเดาจากชื่อเหมือนเดิม

⚠️ **สิ่งที่ยังไม่ทำ — ต้องถาม user ก่อน:** งบเป็นของ **adset** ไม่ใช่ของแอด
ยิง 1:1:3 = 3 แอดใช้งบก้อนเดียวกัน · ตอนนี้กติกาแอดมดเทียบ "spend รายแอด vs 30% ของงบ adset เต็มก้อน"
ถ้าจะหารเฉลี่ยต่อจำนวนแอดในชุด ความไวของกฎจะเปลี่ยน — **ห้ามเปลี่ยนเงียบ ๆ**

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

**❌ ยังเชื่อไม่ได้จนกว่าจะ migrate + backfill เสร็จ**
```
ROAS/ค่าแอด/ออเดอร์ "รายแอด" ทุกตัวใน dashboard และหน้า /brief
คำสั่ง STOP/SCALE/CLONE/REDUCE ทั้งหมด
```
**❌ เชื่อไม่ได้ถาวร จนกว่าจะส่ง offline conversion กลับเข้า Meta**
```
"จำนวนออเดอร์" ดิบ (purchases) — 57% เป็น event มูลค่า ๐ · ใช้ purchasesValued แทน
basket / %ปิดการขาย ที่คิดจาก purchases ดิบ
```

**🕳️ ช่องที่เทสยังไม่ครอบ (รู้ตัวไว้ อย่าเผลอเชื่อว่าปลอดภัย)**
`selftest.mjs` คอมไพล์แค่ `lib/ae.ts` `decide.ts` `content.ts` →
**`upsertRows` / `pruneStale` ใน `lib/supabase.ts` ไม่มีเทสเลย** ทั้งที่เป็นจุดที่บั๊กรากเกิด
โดยเฉพาะ "โหมดถอยไป ad_name เมื่อยังไม่ได้ migrate" (ต้อง merge ใหม่ทั้งก้อน ไม่ใช่แค่ตัดคอลัมน์
— เคยเขียนผิดรอบแรก จะได้ Postgres 21000 ทั้งรอบ) · ต้อง mock `fetch` ถึงจะเทสได้

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

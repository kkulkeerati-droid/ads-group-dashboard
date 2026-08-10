# คำสั่งงานสำหรับ session ถัดไป

> เขียน 10 ส.ค. 69 (รอบบ่าย) · งาน 3 ข้อของรอบก่อน **ทำครบแล้ว** — ดู Phase 11 ใน `WORKFLOW.md`

---

## 0) อ่านก่อน (5 นาที)

```
1. skill ads-ops-thanatos      FACT LOCK + กติกาบ้าน + กับดักที่เคยพลาด
2. skill ads-maeao-method      สมองตัดสินใจ (อ่าน ebook ครบ 60 บทแล้ว)
   └ references/troubleshooting.md   เปิดเมื่อ "แอดมีอาการแบบนี้ แก้ยังไง"
3. WORKFLOW.md Phase 11        ของที่เพิ่งทำ + 4 บทเรียนที่เพิ่งเจ็บมา
4. docs/AD-NAMING.md           มาตรฐานชื่อแอดที่ประกาศใช้แล้ว
```

**สถานะ:** `https://dashboard-ads-thanatos.vercel.app` · รหัส `Sa12345678!`
deploy: `cd dashboard && node scripts/deploy-api.mjs` (⚠️ ไฟล์ใหม่ต้อง `git add` ก่อน)
repo หลัก `kkulkeerati-droid/ads-group-dashboard` · repo ส่งเพื่อน `kkulkeerati-droid/ads-dashboard-starter`

---

## 🎯 งานที่รออยู่ (เรียงตามความคุ้ม)

### 1) 📲 Telegram — ต้องให้ user ทำเอง แล้วเราค่อยยิงเทส
ตรวจแล้ว 10 ส.ค. 69: Vercel production มีแค่ `CRON_SECRET` · **ยังไม่มี `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`**

```
1. เปิด Telegram → ทัก @BotFather → /newbot → ตั้งชื่อ → ได้ token
2. ทักบอทตัวเอง 1 ข้อความ  (บอทส่งหาคนที่ไม่เคยทักไม่ได้)
3. เปิด https://api.telegram.org/bot<TOKEN>/getUpdates → เอา chat.id
```
```bash
cd "/Users/thanatos66/Downloads/Kantamaze 01 - for Content Carousel/dashboard" && npx vercel env add TELEGRAM_BOT_TOKEN production
```
(ทำซ้ำกับ `TELEGRAM_CHAT_ID` และ `DASHBOARD_URL`) แล้ว deploy

**พอ user ใส่แล้ว → ยิงเทสให้เลย:**
```
/api/brief?send=1&key=<CRON_SECRET>&dry=1     ดูข้อความก่อน
/api/digest/telegram?key=<CRON_SECRET>&dry=1  ตัวรายวัน
```
⚠️ `CRON_SECRET` เป็น Sensitive = **อ่านกลับไม่ได้** ต้องขอจาก user หรือ rotate ใหม่ + `gh secret set` ให้ตรง
✅ ข้อความเรนเดอร์จากข้อมูลจริงแล้ว **3,786 ตัวอักษร · HTML tag ครบ · ลิมิต 4,096** — พอใส่ token ก็ส่งได้เลย

### 2) ⭐⭐ อ่าน targeting + งบ จาก Meta ตรง ๆ แทนการเดาจากชื่อ (คุ้มสุดในลิสต์)
research แล้วว่าทำได้จริง — Meta ให้อ่าน `targeting` / `daily_budget` / `created_time` / `effective_status`
ที่ระดับ adset (ยืนยันด้วย MCP แล้ว ดู Phase 12 ใน WORKFLOW.md)

**ได้อะไร:** ลบความไม่แน่นอนทั้งก้อน — funnel ไม่ต้องพึ่งวินัยการตั้งชื่อ ·
`budgetFromName()` + `suggestName()` เลิกจำเป็น (บั๊ก parse ชื่อหายทั้งคลาส) ·
`activeDays` แม่นขึ้น (ตอนนี้วันที่ใช้งบ ฿0 ไม่ถูกนับเป็นอายุ) ·
จับ "ค้างชำระ/แอดโดนตีตก" ได้ตรง ๆ (ebook บทที่ 42)

**ต้องแก้:**
```
lib/meta.ts     + fetchAdsetMeta(token, accountId) → Map<adsetId, {stage, budget, createdAt, status}>
                + ใส่ adset_id ใน fields ของ insights (level=ad รองรับอยู่แล้ว)
lib/types.ts    AdRow + adsetId / funnelReal / budgetReal
lib/ae.ts       buildAdViews เลือก funnelReal ก่อน แล้วค่อย fallback มา classifyFunnel
supabase/       ⚠️ ต้อง migration เพิ่มคอลัมน์ (นี่คือส่วนที่เสี่ยงสุด — ต้องรัน SQL เอง)
```
**ค่าใช้จ่าย:** +1 API call ต่อบัญชีต่อรอบ sync · payload targeting ใหญ่ (ตัดเก็บเฉพาะที่ใช้)
**ทางเลี่ยงแบบถูก:** ยังใช้ชื่อเป็นหลักเหมือนเดิม แต่เพิ่ม **audit รายสัปดาห์**
เทียบ "ชื่อบอกว่าอะไร" กับ "targeting จริง" แล้วขึ้นเตือนเฉพาะตัวที่ชื่อโกหก — ถูกกว่ามากและกัน drift ได้

### 3) จับบัญชีค้างชำระ / แอดโดนตีตก (ถูกและเร็ว)
`effective_status` มีค่า `PENDING_BILLING_INFO` · `DISAPPROVED` · `WITH_ISSUES`
ebook บทที่ 42 บอกว่าบัญชีที่ตัดเงินสะดุดจะทำให้ระบบเสียจังหวะแล้วสูบงบ — ตอนนี้ dashboard มองไม่เห็นเลย

### 4) กราฟ ROAS รายวัน
`series` มี `byGroup` + `byFunnel` (spend) แล้ว — ต้องเพิ่ม **revenue / replies ต่อวัน** ใน `lib/aggregate.ts`
แล้วต่อเข้า `TrendChart` (รองรับ `dim` + `share` อยู่แล้ว)

### 5) ต่อ Google Sheets (ยอดขายจริง) เข้า dashboard
ตอนนี้ยังต้องคีย์มือใน 💰 BizPanel · ⚠️ ค่าแอดในชีตยังไม่รวม VAT — ใช้คอลัมน์ "VAT 7%"

### 6) ส่ง offline conversion กลับเข้า Meta
ปิดการขายใน LINE แล้วยอดไม่ถูกส่งกลับ = algorithm optimize หาคนทัก ไม่ใช่คนซื้อ
→ ทุกกติกาใน `ads-maeao-method` ตัดสินจากตัวเลขที่ต่ำกว่าจริง (ดู [[tracking-stack-audit]])

### 7) label ชุด GRD/UNC/AI/A2/1CUT/GPTแฟชั่น (ตามชีต) ยังไม่เข้า dashboard
### 8) TikTok ยังไม่ได้ต่อ — โค้ดรออยู่ที่ `lib/tiktok.ts` ขาดแค่ token

---

## ⚠️ กับดักที่เพิ่งเจอ — อย่าเหยียบซ้ำ

1. **`deploy-api.mjs` ส่งเฉพาะไฟล์ที่ `git ls-files` เห็น** → ไฟล์ใหม่ต้อง `git add` ก่อน
2. **หน้าเว็บเป็น client-side** — `curl` เห็นแค่โครงเปล่า ต้องเปิดเบราว์เซอร์แล้วรอ fetch เสร็จ
3. **⭐ screenshot ของ Browser pane คืนภาพดำ** ทั้งที่ DOM มีของจริง · และ `resize_window` ทำให้
   **`innerWidth` เป็น 0** ได้ → เคยอ่าน "overflow 269px" ที่ไม่มีจริง
   👉 **เช็ค `innerWidth > 0` ก่อนเชื่อผลวัดเสมอ** · ตรวจสี/คอนทราสต์ด้วย `getComputedStyle` แทน screenshot
   👉 ธีมสลับด้วย `documentElement.setAttribute('data-theme','light')` (ไม่ใช่ `prefers-color-scheme`)
4. **ลิสต์ hardcode ทำให้ของใหม่หายเงียบ ๆ** — เพิ่ม action ใน `ACTION_META` แล้ว `/brief` ไล่ให้เอง
   แต่ **`briefToTelegram` ยังมีลิสต์ `groups` ของตัวเอง ต้องเติมด้วยมือ**
5. **ข้อความ Telegram ห้ามตัดกลาง HTML tag** — ตัดกลาง `<b>` → Telegram ตอบ 400 ไม่ส่งทั้งข้อความ
   ตอนนี้ตัดทีละบรรทัดแล้ว · เพิ่มบรรทัดใหม่ต้องปิด tag ในบรรทัดเดียวกันเสมอ
6. **ชื่อแอดซ้ำ = ข้อมูลพัง** — `lib/supabase.ts` รวมแถวตามชื่อ · อะไรที่เสนอชื่อใหม่ต้องไม่ทำให้ชื่อชนกัน
7. **ห้ามเชิญเพื่อนเข้า repo หลัก** — มีรหัสเว็บใน git history · ใช้ `ads-dashboard-starter` เท่านั้น
8. **เกณฑ์ที่เทียบเลขตายตัวต้องระวัง** — เทียบค่าเฉลี่ยบ้านแทน (บ้านอยู่ ROAS 1.27)
9. **แมปชื่อแอดที่เดาไม่ได้ → ถาม user รวบครั้งเดียว ห้ามเดา** (คำตอบที่ล็อกไว้แล้วอยู่ใน `docs/AD-NAMING.md` + memory)

---

## 🔢 ตัวเลขอ้างอิง (วัด 3–9 ส.ค. 69 — เช็คซ้ำก่อนใช้)

```
7 วัน: ฿39,552 → ฿50,217 · ROAS 1.27 · ตอบจริง 55.96% · ปิด 18.97%
เส้น ROAS: 🟢 ≥3.5 · 🟡 2–3.5 · 🟠 1–2 · 🔴 <1   (user กำหนดเอง)
funnel หลังแก้: TOF 74% · MOF 26% · BOF 0% · ไม่ระบุ 0%
   └ ในนั้น 63% (43 ตัว ฿24,723) ยังเป็น "อ่านจากค่าเริ่มต้น" = รายการในแผง 🏷️ ที่ต้องไปแก้ชื่อ
   └ BOF 0 คือของจริง — บ้านนี้ไม่มี RE7/RE30/RE60 เลย มีแต่ RE180/RE365
churn: 53 แอดหยุดใน 7 วัน กินงบ ฿18,717 (ยอด ๐ ฿8,176)
มุมที่ทำเงิน: Ultra→ผลไม้ 1.96, Ultra 1.87 · GPT→แฟชั่น 1.56
ต้องยิงคอนเทนต์ใหม่: 1 Cut (ไม่มีมุมไหนชนะค่าเฉลี่ยบ้าน)
ควรทำ LAL: 1 Cut (ซื้อ 143) · 1 Click Cart (47) · GPT Storyboard (33)
```

---

## ✅ ก่อนบอกว่าเสร็จ ต้องทำครบ

- [ ] `npx tsc --noEmit` ผ่าน + `npm run build` ผ่าน
- [ ] `git add` ไฟล์ใหม่ → `node scripts/deploy-api.mjs` → READY
- [ ] **เปิดเบราว์เซอร์จริง** เช็คหน้าที่แก้: `innerWidth > 0` ก่อน แล้ววัด overflow = 0 · ไม่มี NaN/undefined · console error 0 · ทั้ง 2 ธีม
- [ ] ทดสอบ logic กับ **ข้อมูลจริง** ไม่ใช่แค่ unit test (ท่าที่ใช้ได้: คำนวณ cookie จากรหัสแล้วยิง `/api/brief` · หรือ `npx tsc` เฉพาะ `lib/*.ts` ออกมาเป็น JS แล้วรันด้วย node)
- [ ] **reverse-check ผลรวม** — ผลรวมรายชั้น/รายกลุ่ม ต้องเท่ากับ spend รวมเป๊ะ
- [ ] sync โค้ดเข้า `~/Desktop/claude/ads-dashboard-starter/` แล้วสแกนของลับ
      (`Sa12345678` · `P-FLOW|RID X|DrX|GRD V` · account id · `dashboard-ads-thanatos` · `team_4MXqJ`)
- [ ] commit + push ทั้ง 2 repo
- [ ] อัปเดต `WORKFLOW.md` (เพิ่ม phase ใหม่ + บทเรียนที่เจอ) และไฟล์นี้
- [ ] แปะ markdown link ทุกไฟล์ที่แตะท้ายสรุป

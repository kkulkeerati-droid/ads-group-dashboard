# WORKFLOW — Ads Dashboard ตั้งแต่วันแรกจนถึงตอนนี้

> อัปเดต 2026-08-10 · เล่าลำดับจริงว่าทำอะไร เจอปัญหาอะไร แก้ยังไง
> **สำหรับ session ใหม่: อ่าน `NEXT-SESSION.md` ก่อน แล้วค่อยไฟล์นี้ + skill `ads-ops-thanatos` + `ads-maeao-method`**

🔗 **https://dashboard-ads-thanatos.vercel.app** · รหัส `Sa12345678!`

---

## PHASE 0 — โจทย์ตั้งต้น
อยากได้ dashboard รวมค่าโฆษณา Meta ทุก ad account แล้วแบ่งกลุ่มตาม **prefix ชื่อ ads** เพราะ Ads Manager ดูข้ามบัญชีทีเดียวไม่ได้

**เลือก:** Next.js 15 (App Router) + TypeScript · ไม่ใช้ lib chart (วาด SVG เอง) · deploy Vercel
**ทำไมไม่ใช้ Looker/Sheet:** ต้องการ logic แบ่งกลุ่มเอง + ปุ่มตัดสินใจ + แชร์ลูกค้าได้

---

## PHASE 1 — โครงระบบ + 3-tier data source
```
Supabase cache  →  Live Graph API  →  Demo snapshot
   (เร็ว)           (สดแต่ช้า)        (กันเว็บพัง)
```
`app/api/metrics/route.ts` เลือกชั้นเอง · `lib/groups.ts` = กติกาแบ่งกลุ่ม (prefix + token-boundary กัน `aigen` หลุดเข้า `ai`)

**บทเรียน:** ทำ 3 ชั้นตั้งแต่แรกช่วยชีวิต — ตอน Supabase หลับ เว็บยังใช้ได้ (แค่ช้า)

---

## PHASE 2 — Deploy (เจ็บที่สุด ~2 วัน)

**อาการ:** deployment สร้างได้แต่ **build ไม่เคยรัน** — status UNKNOWN, `Builds . [0ms]`, ไม่มี log
**ลองแล้วพังหมด:** `vercel --prod` · `--force` · `--prebuilt` · git auto-deploy · `vercel redeploy <stuck>`
**ลองข้ามวัน / ลบ zombie / สร้าง project ใหม่** → ก็ยังพัง

### ✅ ทางที่ใช้ได้ (ทางเดียว)
```bash
cd dashboard && node scripts/deploy-api.mjs
```
ยิง Vercel REST API ตรง แนบไฟล์ base64 ใน request เดียว → build วิ่ง ~60 วิ + auto-alias ให้เอง
เจอ `invalidToken` → `npx vercel whoami` (refresh) แล้วรันซ้ำ

**บทเรียน:** เจอทางที่พัง 2-3 รอบแล้วต้อง**เปลี่ยนช่องทาง** ไม่ใช่ลองซ้ำ → บันทึกเป็น memory `no-retry-broken-paths`

---

## PHASE 3 — ล็อกรหัส + ขึ้น live
`middleware.ts` ล็อกทั้งเว็บ (cookie = SHA-256 ของรหัส) · `/login` · ยกเว้น `/api/sync`

**กฎเหล็ก:** ตั้ง `DASHBOARD_PASSWORD` **ก่อน** ใส่ `META_ACCESS_TOKEN` เสมอ (ไม่งั้นข้อมูลจริงเปิดสาธารณะช่วงหนึ่ง)

**ได้ token ยังไง:** Graph API Explorer → เลือก `ads_read` → Access Token Debugger → **Extend** → ได้ token ไม่หมดอายุ (user กรอกรหัส FB เอง — ผมทำแทนไม่ได้)

---

## PHASE 4 — Supabase cache (แก้ 30 วัน timeout)

**ปัญหา:** ช่วง 30 วัน = 504 (ดึงสด 22 บัญชี × ad-level รายวัน เกิน 60 วิของ Vercel Hobby)

**แก้:** cache ลง Postgres + `/api/sync` (กันด้วย `CRON_SECRET`)

**กับดักที่เจอจริง:**
| ปัญหา | แก้ |
|---|---|
| ads ชื่อซ้ำในบัญชีเดียว → Postgres error 21000 | รวมแถวก่อน upsert |
| ตารางใหม่ service_role อ่านไม่ได้ | `grant all on all tables ... to service_role` |
| sync เกิน 60 วิ | ก้อนละ ≤3-4 วัน |
| **Supabase free pause เองหลังไม่มี activity ~7 วัน** | GitHub Actions `keepalive-sync.yml` ยิงทุก 2 ชม. |
| Supabase เดิมอยู่คนละบัญชี (stanamaharat) | ย้ายมา `ads-cache` @ kkulkeerati-droid (Singapore) |

**ผลวัด:** 30 วัน 504 → **2.5 วิ** · 14 วัน 3.5 วิ
**กฎ:** ช่วงที่เป็น "วันนี้ล้วน" ดึงสดเสมอ · cache ใช้เฉพาะเมื่อครอบช่วงครบ (`earliestDate <= since`)

---

## PHASE 5 — ฟีเจอร์ใช้งานจริง
แถบแนะนำ 🎯 (ปิด/สเกล + ชื่อบัญชี) · mobile responsive · signed share link (`?share=` ลูกค้าเปิดได้ไม่ต้องรู้รหัส) · date picker + ปุ่ม 14 วัน (default) · การ์ดสลับ กลุ่ม↔สินค้า · 🏦 แยกราย ad account · 🎨 Content Ads (มุมคอนเทนต์ × กลุ่มเป้าหมาย) · 💰 กรอกยอดขาย → %Ads/ROAS

---

## PHASE 6 — ★ เปลี่ยน north star (จุดเปลี่ยนสำคัญที่สุด)

user บอก: **"ทักเยอะก็จริง แต่ส่วนมากคือแชทผีที่ไม่กลับมาตอบ"**

**ค้นพบ:** Meta มี metric ครบอยู่แล้ว แค่ไม่เคยดึง
| ต้องการ | action type |
|---|---|
| ทัก | `messaging_conversation_started_7d` |
| **คนกลับมาตอบ** | **`messaging_user_depth_2_message_send`** ⭐ |
| ออเดอร์ + ยอดขาย | `onsite_conversion.purchase` + `action_values` |

**Verify แล้วว่าตรงกับ Ads Manager UI เป๊ะ:** ad `AI/Buy/GPT` → UI แสดง "ผู้ติดต่อ 52 · ผู้กลับมาติดต่อ 28 · ฿16.88 vs ฿31.34" ตรงกับ field ที่ใช้

**ผลลัพธ์:** เพิ่ม 8 metric (ROAS/replies/replyRate/cpReply/purchases/revenue/convRate/basket) ทุกระดับ (รวม/กลุ่ม/บัญชี/ad/สินค้า)

**ตัวเลขจริงที่เปิดโปง:** ทัก 1,529 → ตอบจริง 818 = **แชทผี 47%** · ต้นทุนจริงต่อคนคุย **฿44** ไม่ใช่ ฿24

---

## PHASE 7 — แบ่งตามสินค้า
`lib/content.ts` → `parseProduct()` · 6 สินค้า: 1 Click Ultra · 1 Click Cart · GPT Storyboard · All Post · 1 Cut · GRD (+UNC)

**ต้องถาม user ก่อนแมป** — เดาผิด 2 รอบ: `1CC` (คิดว่า Ultra → จริงคือ **Cart**) · `A2` (ตกไป "อื่น ๆ" → จริงคือ **All Post**) · `ผลไม้/Omni/ดราม่า` = มุมคอนเทนต์ของ **Ultra**

**ผล:** "อื่น ๆ" จาก ฿52,475 → **฿3,114 (3.7%)** · test 21/21 ผ่าน

---

## PHASE 8 — Weekly Digest (ล่าสุด)
`/digest` + `/api/digest` + `lib/digest.ts` — เทียบ 7 วันล่าสุด vs 7 วันก่อน แล้วสรุป 5 หัวข้อ:
1. เราทำอะไรไปแล้วบ้าง (แอดใหม่/แอดที่หยุด/งบขยับ)
2. อันไหนได้ผล–ไม่ได้ผล เทียบ KPI + งวดก่อน
3. สิ่งที่เรียนรู้ (แชทผี, กับดักค่าทักถูก, basket ผิดปกติ)
4. สิ่งที่จะปรับ (คำสั่งพร้อมตัวเลข + คาดการณ์กำไรที่ได้เพิ่ม)
5. suggest แบรนด์ (เรื่องที่แอดแก้เองไม่ได้ — สคริปต์แชท/ราคา/AOV/สต๊อก)

**KPI default:** ROAS ≥3.5 (เดิม 2 — ดู PHASE 9) · %ตอบกลับ ≥60% · %ปิดการขาย ≥15% (ปรับผ่าน `?kpiRoas=&kpiReply=&kpiConv=`)

---

## PHASE 9 — ★ ธงตัดสินใจเลิกใช้ค่าทัก เปลี่ยนเป็น ROAS

**ปัญหาที่เจอ:** ธง 🟢/🔴 ตัดจาก CPR (ค่าทัก) เทียบเป้าของกลุ่ม → **แนะนำผิดทางจริง**

ตรวจกับข้อมูลจริง 28 ก.ค.–10 ส.ค. 69 · ธงเปลี่ยนคำตัดสิน **10 จาก 25 ตัว**:

| ad | ค่าแอด | ROAS | ธงเดิม | ธงใหม่ |
|---|---|---|---|---|
| `UNC/600/6Aug` | ฿1,648 | **0.00** | 🟢 สเกล | 🔴 ปิด |
| `A2/RE/600/28Jul` | ฿1,379 | 0.52 | 🟢 สเกล | 🔴 ปิด |
| `AI/RE180/1CC/600/28Jul` | ฿1,339 | 0.45 | 🟢 สเกล | 🔴 ปิด |
| `AI/RE365/ส่วนนลด1CC` | ฿2,057 | 1.23 | 🔴 ปิด | 🟡 เฝ้าดู |

เกณฑ์เดิมสั่ง "สเกล" แอดที่ยอดขาย ๐ เพราะค่าทักถูก

### บันไดตัดสินใหม่ (`lib/decide.ts`)
```
0. ยิงไม่ถึง 3 วัน หรือใช้ < ฿300 → ⏳ ยังตัดสินไม่ได้ (learning ห้ามแตะ)
1. แอด ENG/View       → 🔵 ไม่ตัดจาก ROAS (คนละวัตถุประสงค์)
                         ยกเว้น ทัก>0 แต่ตอบ 0 → 🔴 ปิด
2. มียอดขาย           → ROAS ≥3.5 🟢 สเกล · 2–3.5 🟡 เริ่มแย่ · 1–2 🟠 ลดงบ · <1 🔴 ปิด
3. ยอด ๐ แต่กลุ่มมี    → 🔴 ปิด (ระบบนับยอดใช้ได้ = ตัวนี้ขายไม่ออกจริง)
4. ยอด ๐ ทั้งกลุ่ม     → ⚫ เช็คการนับยอด (ยังชี้ไม่ได้) + ดู cpReply ประกอบ
```

**เส้น ROAS 3.5 มาจาก user เอง (10 ส.ค. 69):** *"ROAS > 3.5 ถึงจะให้ scale ต่ำกว่านี้ถือว่าเริ่มแย่ละ"*
ตอนแรกตั้งไว้ 2 · แก้ที่ `ROAS_SCALE` ใน `lib/decide.ts` ที่เดียว

**กัน learning phase:** เจอจริง — clone ที่เพิ่งเกิดเมื่อวาน ใช้ ฿681 ยอด ๐ โดนสั่ง "ปิด"
ทั้งที่กติกาบ้านคืออายุ < 3 วันห้ามแตะ → เพิ่ม `activeDays` ใน `aggregate.ts`
- ธงทุกตัว**มีเหตุผลกำกับ** (ชี้เมาส์ที่ธง) เช่น *"ใช้ ฿817 ยอดขาย ๐ ทั้งที่ตัวอื่นในกลุ่มเดียวกันขายได้"*
- แถบ 🎯 แนะนำ เรียง "ปิด" ตาม **เงินที่ติดลบจริง** (spend−revenue) ไม่ใช่ยอดใช้จ่าย
- 🏦 ราย account โชว์ ROAS ของบัญชี + เหตุผลรายตัว
- **เพิ่มแถบเตือน coverage** — topAds cap 25 ครอบแค่ ~50% ของค่าแอด ตอนนี้เว็บบอกเองแล้วว่าอีกกี่ % ยังไม่ถูกประเมิน

**⚫ ไม่ใช่ 🔴 โดยตั้งใจ** — "ไม่มียอดเข้าระบบเลย" กับ "ขายไม่ออก" คนละเรื่อง ปนกันเมื่อไหร่จะปิดแอดที่จริง ๆ แค่ tracking ไม่ส่งยอดกลับ

### แผง 🎨 Content Ads เปลี่ยนตามด้วย
เดิมติดธงจากค่าทักเหมือนกัน — พอเปลี่ยนเป็น ROAS เห็นทันทีว่า
**Broad (AW) ค่าทักถูกที่สุดในตาราง ฿9.96 แต่ยอดขาย ๐** (เกณฑ์เก่าจะขึ้น 🟢 อัดต่อ)
และมุม "ทั่วไป" กินงบสูงสุด ฿24,888 แต่ ROAS 0.64 *(วัด 28 ก.ค.–10 ส.ค. 69)*

### 🐛 เจอบั๊กแถมระหว่างตรวจ — race condition ตอนโหลด
**อาการ:** เปิดลิงก์ที่มี `?accounts=` แล้ว **ไม่กรองจริง** (ยังเห็นทุกบัญชี)
**สาเหตุ:** `load()` ยิงด้วย state เริ่มต้น (14 วัน/ไม่กรอง) ก่อนที่ `useEffect` จะอ่านค่าจาก URL เสร็จ
→ ยิง `/api/metrics` **3 ครั้งพร้อมกัน** แล้วตัวที่ตอบกลับทีหลังชนะ
**ทำไมสำคัญ:** ลิงก์แชร์ที่ล็อกบัญชีให้ลูกค้า **อาจโชว์ข้อมูลทุกบัญชี** = ข้อมูลรั่ว ไม่ใช่แค่แสดงผลเพี้ยน
**แก้:** เพิ่ม `urlReady` gate (ยังไม่อ่าน URL เสร็จ = ยังไม่ยิง) + `reqSeq` ทิ้งผลที่มาช้ากว่าคำขอล่าสุด
**ยืนยัน:** จาก 3 requests เหลือ **1** · `?accounts=` กรองถูกแล้ว

---

## PHASE 10 — สรุปเข้า Telegram ทุกเช้า

```
lib/digest-load.ts       โหลดข้อมูล+สร้าง digest (ใช้ร่วมกัน เว็บ/Telegram จะได้ไม่คำนวณคนละแบบ)
lib/daily.ts             สรุปรายวัน + สรุปสัปดาห์ → ข้อความ Telegram
app/api/digest/telegram/ endpoint push (กันด้วย CRON_SECRET เอง อยู่นอกกำแพงรหัส)
.github/workflows/daily-telegram.yml   ทุกวัน 01:00 UTC = 08:00 น. ไทย
```

**หลักคิด: รายงาน "เมื่อวาน" แต่ตัดสินใจจาก "7 วันล่าสุด"**
ข้อมูลวันเดียวเหวี่ยงเกินจะสั่งปิด/สเกล (เสาร์-อาทิตย์ไม่เหมือนวันธรรมดา + ออเดอร์บางส่วนมาทีหลัง)
แต่คนอ่านอยากรู้ว่าเมื่อวานเป็นยังไง → เอาตัวเลขเมื่อวานมาโชว์ เอาธงจาก 7 วันมาสั่งงาน

- `?dry=1` = ดูข้อความที่จะส่งโดยไม่ส่งจริง · `&date=YYYY-MM-DD` = ย้อนวัน
- เช้าวันจันทร์แนบสรุปสัปดาห์เป็นข้อความที่ 2 ให้เอง
- ข้อความจริงยาว ~870 ตัวอักษร (ลิมิต Telegram 4,096)
- **ทำไมเปลี่ยนจาก LINE:** Telegram ไม่ต้องสมัคร OA ไม่ต้องยืนยันธุรกิจ ไม่มีเพดานข้อความ
  ตั้งเสร็จใน 3 นาที (@BotFather → `/newbot` → `getUpdates` เอา chat id)

**ยังต้องทำเองก่อนใช้งาน:** ใส่ `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` ใน Vercel
(ขั้นตอนละเอียดอยู่ที่ `~/Desktop/claude/ads-dashboard-handoff/2-ติดตั้ง.md` ขั้น 8)

---

## 🔁 งานประจำ (ทำซ้ำได้)

**ดูผลรายวัน** → เปิด dashboard → 14 วัน → สลับ "สินค้า" → เมตริก "ROAS"
**สรุปสัปดาห์** → `/digest` (หรือปุ่ม 📅 Digest)
**สรุปรายวัน** → เข้า Telegram เองทุกเช้า 08:00 · ทดสอบ `/api/digest/telegram?key=<CRON_SECRET>&dry=1`
**เติมข้อมูลย้อนหลัง** → `/api/sync?key=<CRON_SECRET>&since=&until=` ก้อนละ ≤4 วัน
**deploy** → `git add <ไฟล์ใหม่>` แล้ว `node scripts/deploy-api.mjs`
**เว็บช้า/504** → เช็ค Supabase pause ก่อน

---

## ⚠️ บทเรียนที่แพงที่สุด (อย่าทำซ้ำ)

1. **เห็น `PAUSED` แล้วอย่ารีบสรุปว่าหยุดยิง** — `last_7d` รวมแอดที่ปิดแล้ว → เช็ค spend วันนี้ก่อน
2. **`omni_purchase_values` ไม่ใช่ยอดขายรวม** — เชื่อ `purchase_roas` / `action_values`
3. **ROAS ตกแต่ออเดอร์เพิ่ม = tracking ไม่ใช่ยอดตก**
4. **ค่าทักถูก ≠ กำไร** — All Post ค่าทักถูกที่สุดในบ้าน ฿13.82 แต่ ROAS 0.38 *(วัด 28 ก.ค.–10 ส.ค. 69)* → เป็นที่มาของ PHASE 9
5. **topAds cap 25** — sum เทียบ total ก่อนบอกว่าครบ *(วัด 14 วัน: ครอบแค่ 50% ของค่าแอด — ตอนนี้เว็บเตือนเองแล้ว)*
6. **ชีตต้อง cross-check กับ Meta** — เคยขาด 2 กลุ่ม + กรอกผิดคอลัมน์
7. **"กำไร" ในชีต = ยอดขาย − ค่าแอด** ยังไม่หักต้นทุนสินค้า
8. **อย่าใช้ clipboard ยาว ๆ ระหว่าง user ทำงาน** — ใช้ `monaco.setValue()` ใส่ SQL
9. **★ ไฟล์ใหม่ต้อง `git add` ก่อน deploy** — `deploy-api.mjs` ส่งเฉพาะไฟล์ที่ `git ls-files` เห็น
   ถ้าลืม: build บนเครื่องผ่าน แต่ Vercel ขึ้น `Module not found: Can't resolve '@/lib/...'`
   (ไม่ต้อง commit ก็ได้ แค่ `git add` ก็ถูกนับแล้ว)
10. **ตัวเลขในเอกสารต้องมีวันที่กำกับเสมอ** — ตัวเลขไม่มีวันที่ = อีก 2 สัปดาห์กลายเป็นข้อมูลผิดที่ดูเหมือนจริง
11. **หน้า client-side เช็คด้วย `curl` ไม่ได้** — HTML ที่ server ส่งมามีแต่โครง (7 KB)
    ต้องเปิดเบราว์เซอร์จริงแล้วรอ fetch เสร็จ · ถ้าไม่ทำแบบนี้จะไม่เจอ race ข้างบน
12. **แก้เกณฑ์แล้วต้องไล่ให้ครบทุกแผง** — ตอนเปลี่ยนเป็น ROAS เกือบลืมแผง 🎨 Content Ads
    ที่ยังติดธง 🟢 จากค่าทักอยู่ = บั๊กเดิมเป๊ะ ๆ แค่ย้ายที่

---

## 🔑 env ที่ต้องมี (ตั้งใน Vercel → Settings → Environment Variables)

| ตัวแปร | จำเป็น | ใช้ทำอะไร |
|---|---|---|
| `DASHBOARD_PASSWORD` | ✅ **ตั้งก่อน token เสมอ** | ล็อกทั้งเว็บ · ถ้าไม่ตั้ง = เปิดสาธารณะ |
| `META_ACCESS_TOKEN` | ✅ | ดึง Graph API (สิทธิ์ `ads_read`) |
| `CRON_SECRET` | ✅ | กัน `/api/sync` + `/api/digest/line` โดนคนนอกยิง |
| `SUPABASE_URL` | ✅ | cache (ไม่มี = ช่วง 30 วัน timeout) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | เขียน cache (**อย่าเอาขึ้น client**) |
| `META_AD_ACCOUNTS` | – | จำกัดเฉพาะบางบัญชี (ว่าง = ทุกบัญชีที่ token เห็น) |
| `SYNC_DAYS` | – | sync ย้อนหลังกี่วันต่อรอบ (default 7) |
| `TELEGRAM_BOT_TOKEN` | – | ส่งสรุปเข้า Telegram (PHASE 10) — จาก @BotFather |
| `TELEGRAM_CHAT_ID` | – | chat id ปลายทาง (หลายห้องคั่น `,`) |
| `DASHBOARD_URL` | – | ใส่ในลิงก์ที่ส่งเข้า Telegram (ว่าง = เดาจาก request) |
| `TIKTOK_ACCESS_TOKEN` / `TIKTOK_ADVERTISER_IDS` | – | ฝั่ง TikTok (ยังไม่ได้ต่อ) |

**GitHub secret ที่ต้องตั้ง:** `CRON_SECRET` (ให้ตรงกับใน Vercel) — ใช้ทั้ง keepalive และ digest→Telegram

⚠️ `CRON_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` ตั้งเป็น **Sensitive** ไว้ = อ่านกลับไม่ได้อีก
(`vercel env pull` จะได้คำว่า `[SENSITIVE]`) — ถ้าต้องใช้ ต้อง rotate ใหม่แล้ว `gh secret set` ให้ตรง

---

## 📁 ไฟล์สำคัญ
```
app/api/metrics/route.ts   3-tier + ช่วงเวลา + เทียบงวด
app/api/sync/route.ts      cron target → Supabase
app/api/digest/route.ts    Weekly Digest API
app/api/digest/telegram/   ★ push สรุปเข้า Telegram (มี ?dry=1)
app/dashboard.tsx          UI หลัก
app/digest/                หน้า Digest
lib/meta.ts                Graph API + quality metrics + retry
lib/aggregate.ts           รวมทุกระดับ + qualityOf()
lib/content.ts             parseProduct / parseTheme / parseAudience
lib/decide.ts              ★ เกณฑ์ธง ปิด/สเกล (ROAS นำ) — แก้เกณฑ์ที่นี่ที่เดียว
lib/digest.ts              logic 5 หัวข้อ
lib/digest-load.ts         โหลด+สร้าง digest (เว็บกับ Telegram ใช้ตัวเดียวกัน)
lib/daily.ts               สรุปรายวัน → ข้อความ Telegram
lib/supabase.ts            cache layer (+ graceful fallback)
middleware.ts              กำแพงรหัส (ยกเว้น /api/sync, /api/digest/telegram)
scripts/deploy-api.mjs     ★ deploy ทางเดียวที่ใช้ได้ (ส่งเฉพาะไฟล์ที่ git track)
.github/workflows/keepalive-sync.yml       กัน Supabase หลับ (ทุก 2 ชม.)
.github/workflows/daily-telegram.yml       ★ สรุป → Telegram (ทุกเช้า 08:00)
```

---

## PHASE 11 — สมองฝั่ง AE + สรุปบ่าย 17:00

`lib/ae.ts` ตอบคนละคำถามกับ `lib/decide.ts` — decide บอก "ดีหรือแย่" · ae บอก "พรุ่งนี้ทำอะไรกับมัน"

- **funnel TOF/MOF/BOF** อ่านจาก *กลุ่มเป้าหมาย* ในชื่อ (RE60=BOF · RE180/365=MOF · LAL/AW/ENG/VIEW=TOF)
  แยกจาก *objective* (ยอดขาย/msg) ซึ่งเป็นคนละแกน
- **creative fatigue** = ความถี่ขึ้น + ROAS ตก + ฿/คนตอบแพงขึ้น (3 วันล่าสุด vs 4 วันก่อน)
  ล้า = **เปลี่ยนคอนเทนต์ ไม่ใช่ปิดกลุ่ม** (ถ้ากลุ่มพัง ความถี่จะไม่ขึ้นตั้งแต่แรก)
- **SCALE vs CLONE** — ผ่านเส้นแล้วแต่กลุ่มอิ่ม/ดันงบมา 2 รอบ → แตกตัวใหม่แทนดันงบ
- **clone health 24 ชม.** — แพงกว่าตัวแม่ 1.5 เท่า = ปิด
- **แยก "เพิ่งเปิด (learning)" ออกจาก "หยุดไปแล้ว"** — activeDays น้อยเหมือนกัน แต่คนละคำสั่ง

### กติกาจาก ebook แม่เอ (skill `ads-maeao-method`)
พบว่าโค้ดเดิมทำผิดข้อที่หนังสือเตือนตรง ๆ — สั่ง SCALE จาก ROAS อย่างเดียว
> *"อย่าสเกลเพราะ ROAS สวย แต่เพิ่งขายได้ 2 ออเดอร์"*

เพิ่ม 2 ด่านก่อนถึง SCALE: **บันไดออเดอร์** (<10 = KEEP ไม่ว่า ROAS เท่าไหร่ · 20 ตัดสิน · 30+ สเกล)
และ **ต้นทุน/ออเดอร์ต้องนิ่ง** (แกว่ง ≤30%) — เพิ่มงบตอนระบบไม่นิ่ง learning รีเซ็ต

### สรุปบ่าย 17:00
`/brief` + `/api/brief` + `daily-brief-17.yml` (10:00 UTC)
**17:00 เพราะพีคเย็นไทย 18-21 — ต้องขยับงบก่อนหน้านั้น**
รายงาน "เมื่อวาน" แต่ **ตัดสินใจจาก 7 วันที่จบวันแล้ว** — ยอดขายเข้าช้ากว่าค่าแอด
เอา ROAS บ่ายมาสั่งปิด = ปิดตัวที่กำลังทำเงินตอนกลางคืน

**สิ่งที่ข้อมูลจริงเปิดโปง:** งบ 64% อยู่ในแอดที่ชื่อไม่บอกกลุ่มเป้าหมาย · TOF แค่ 10% ·
53 แอดหยุดไปใน 7 วัน กินงบ ฿18,717 (ยอด ๐ ฿8,176)

---

## 📌 ยังไม่ได้ทำ (backlog เรียงตามความคุ้ม)

1. **กราฟ ROAS รายวัน** — `series` ตอนนี้เก็บแค่ spend ต่อกลุ่ม ต้องเพิ่ม revenue/replies ต่อวันใน `aggregate.ts`
2. **ต่อ Google Sheets (ยอดขายจริง)** เข้า dashboard — ตอนนี้ยังต้องคีย์มือใน 💰 BizPanel
3. **label ชุด GRD/UNC/AI/A2/1CUT/GPTแฟชั่น (ตามชีต)** ยังไม่เข้า dashboard
4. **ส่ง offline conversion กลับเข้า Meta** — ปิดการขายใน LINE แล้วยอดไม่ถูกส่งกลับ = algorithm หาคนทัก ไม่ใช่คนซื้อ
5. TikTok ยังไม่ได้ต่อ (โค้ดรออยู่แล้วที่ `lib/tiktok.ts` ขาดแค่ token)

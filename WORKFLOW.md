# WORKFLOW — Ads Dashboard ตั้งแต่วันแรกจนถึงตอนนี้

> อัปเดต 2026-08-10 · เล่าลำดับจริงว่าทำอะไร เจอปัญหาอะไร แก้ยังไง
> **สำหรับ session ใหม่: อ่านไฟล์นี้ + `HANDOFF.md` + skill `ads-ops-thanatos`**

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

**KPI default:** ROAS ≥2 · %ตอบกลับ ≥60% · %ปิดการขาย ≥15% (ปรับผ่าน `?kpiRoas=&kpiReply=&kpiConv=`)

---

## 🔁 งานประจำ (ทำซ้ำได้)

**ดูผลรายวัน** → เปิด dashboard → 14 วัน → สลับ "สินค้า" → เมตริก "ROAS"
**สรุปสัปดาห์** → `/digest` (หรือปุ่ม 📅 Digest)
**เติมข้อมูลย้อนหลัง** → `/api/sync?key=<CRON_SECRET>&since=&until=` ก้อนละ ≤4 วัน
**deploy** → `node scripts/deploy-api.mjs`
**เว็บช้า/504** → เช็ค Supabase pause ก่อน

---

## ⚠️ บทเรียนที่แพงที่สุด (อย่าทำซ้ำ)

1. **เห็น `PAUSED` แล้วอย่ารีบสรุปว่าหยุดยิง** — `last_7d` รวมแอดที่ปิดแล้ว → เช็ค spend วันนี้ก่อน
2. **`omni_purchase_values` ไม่ใช่ยอดขายรวม** — เชื่อ `purchase_roas` / `action_values`
3. **ROAS ตกแต่ออเดอร์เพิ่ม = tracking ไม่ใช่ยอดตก**
4. **ค่าทักถูก ≠ กำไร** — All Post ค่าทัก ฿21 แต่ ROAS 0.59
5. **topAds cap 25** — sum เทียบ total ก่อนบอกว่าครบ
6. **ชีตต้อง cross-check กับ Meta** — เคยขาด 2 กลุ่ม + กรอกผิดคอลัมน์
7. **"กำไร" ในชีต = ยอดขาย − ค่าแอด** ยังไม่หักต้นทุนสินค้า
8. **อย่าใช้ clipboard ยาว ๆ ระหว่าง user ทำงาน** — ใช้ `monaco.setValue()` ใส่ SQL

---

## 📁 ไฟล์สำคัญ
```
app/api/metrics/route.ts   3-tier + ช่วงเวลา + เทียบงวด
app/api/sync/route.ts      cron target → Supabase
app/api/digest/route.ts    Weekly Digest API
app/dashboard.tsx          UI หลัก
app/digest/                หน้า Digest
lib/meta.ts                Graph API + quality metrics + retry
lib/aggregate.ts           รวมทุกระดับ + qualityOf()
lib/content.ts             parseProduct / parseTheme / parseAudience
lib/digest.ts              logic 5 หัวข้อ
lib/supabase.ts            cache layer (+ graceful fallback)
scripts/deploy-api.mjs     ★ deploy ทางเดียวที่ใช้ได้
.github/workflows/keepalive-sync.yml   กัน Supabase หลับ
```

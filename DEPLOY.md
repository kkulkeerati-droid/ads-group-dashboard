# คู่มือ Deploy ขึ้น Vercel (ทีละขั้น)

Repo อยู่แล้วที่ GitHub (private) — ต่อ Vercel ให้ auto-deploy ทุกครั้งที่ push

## 1. เชื่อม Vercel กับ GitHub
1. เข้า [vercel.com](https://vercel.com) → **Continue with GitHub** (ใช้บัญชี GitHub เดิม)
2. กด **Add New… → Project**
3. หา repo **`ads-group-dashboard`** → กด **Import**

## 2. ตั้งค่าก่อน Deploy
- **Framework Preset**: Next.js (ตรวจว่าเดาถูก)
- **Root Directory**: `.` (repo นี้คือตัวแอปเลย ไม่ต้องเปลี่ยน)
- เปิดหัวข้อ **Environment Variables** ใส่เท่าที่มี (ใส่ทีหลังก็ได้):

| Key | Value | จำเป็น? |
|---|---|---|
| `META_ACCESS_TOKEN` | token จาก System User (ads_read + read_insights) | ✅ เพื่อได้ข้อมูลสด |
| `META_AD_ACCOUNTS` | id บัญชีคั่น comma (เว้นว่าง = ทุกบัญชี) | – |
| `CRON_SECRET` | สุ่มสตริงยาว ๆ (กัน /api/sync โดนยิงมั่ว) | ถ้าใช้ Supabase |
| `SUPABASE_URL` | จาก Supabase project | ถ้าใช้ Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | จาก Supabase (ความลับสูงสุด) | ถ้าใช้ Supabase |
| `TIKTOK_ACCESS_TOKEN` | จาก TikTok Marketing API | ถ้าใช้ TikTok |
| `TIKTOK_ADVERTISER_IDS` | advertiser id คั่น comma | ถ้าใช้ TikTok |

> ยังไม่ใส่ token ก็ Deploy ได้ — เว็บจะขึ้นโหมด DEMO ไปก่อน แล้วค่อยเติม env ทีหลัง (Settings → Environment Variables → Redeploy)

## 3. Deploy
กด **Deploy** → รอ ~1-2 นาที → ได้ลิงก์ `https://ads-group-dashboard-xxx.vercel.app`

## 4. (ถ้าใช้ Supabase) เปิด auto-sync
- `vercel.json` ตั้ง Vercel Cron ราย ชม. ให้แล้ว (ยิง `/api/sync` อัตโนมัติ)
- อยากถี่กว่านั้น (ทุก 5 นาที) → [cron-job.org](https://cron-job.org):
  URL = `https://<โดเมน>/api/sync?key=<CRON_SECRET>` · Schedule = Every 5 minutes

## อัปเดตเว็บทีหลัง
แก้โค้ดในเครื่อง → `git add . && git commit -m "..." && git push` → Vercel deploy ให้เอง

## ใส่โดเมนตัวเอง (ออปชัน)
Vercel → Project → Settings → Domains → ใส่โดเมน → ทำตามค่า DNS ที่มันบอก

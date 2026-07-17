-- ═══════════════════════════════════════════════════════════════════
-- Ads Group Dashboard — เพิ่มคอลัมน์ ROAS (ยอดขาย + จำนวนซื้อ จาก pixel)
-- ⚠️ ต้องรันไฟล์นี้ใน Supabase → SQL Editor "ก่อน" deploy โค้ดที่มี ROAS
--    (ไม่งั้น /api/sync จะ error เพราะ insert คอลัมน์ที่ยังไม่มี)
-- ═══════════════════════════════════════════════════════════════════

alter table public.ad_metrics_daily
  add column if not exists revenue   numeric not null default 0,   -- มูลค่าซื้อจาก pixel (action_values omni_purchase)
  add column if not exists purchases bigint  not null default 0;   -- จำนวนซื้อจาก pixel (actions omni_purchase)

-- (ออปชัน) ตารางยอดขายจริงต่อสินค้าต่อวัน — สำหรับ "ROAS จริง" ที่ปิดการขายในแชท/COD นอก pixel
-- คีย์ = แพลตฟอร์ม + กลุ่มสินค้า (group key: ai/a2/สายพาน/ap2/grd/...) + วัน
create table if not exists public.product_sales_daily (
  id         bigint generated always as identity primary key,
  platform   text        not null default 'all',
  group_key  text        not null,           -- ai | a2 | สายพาน | ap2 | grd | others
  date       date        not null,
  sales      numeric     not null default 0, -- ยอดขายจริง (บาท) ของสินค้านั้นในวันนั้น
  note       text,
  updated_at timestamptz not null default now(),
  unique (platform, group_key, date)
);
create index if not exists idx_sales_date on public.product_sales_daily (date);

alter table public.product_sales_daily enable row level security;
-- service_role bypass RLS อยู่แล้ว, anon เข้าไม่ได้

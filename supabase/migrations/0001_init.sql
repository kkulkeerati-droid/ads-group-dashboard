-- ═══════════════════════════════════════════════════════════════════
-- Ads Group Dashboard — Supabase schema
-- รันไฟล์นี้ใน Supabase → SQL Editor → New query → วาง → Run
-- ═══════════════════════════════════════════════════════════════════

-- ตารางเก็บตัวเลขโฆษณารายวันระดับ ad (cache ที่ cron เติมทุก 5 นาที)
create table if not exists public.ad_metrics_daily (
  id           bigint generated always as identity primary key,
  platform     text        not null,            -- meta | tiktok
  account_id   text        not null,
  account_name text        not null default '',
  ad_name      text        not null default '',
  date         date,                            -- วันของข้อมูล (null = รวมทั้งช่วง)
  spend        numeric     not null default 0,
  impressions  bigint      not null default 0,
  reach        bigint      not null default 0,
  results      bigint      not null default 0,
  result_type  text,
  updated_at   timestamptz not null default now(),
  -- กันข้อมูลซ้ำ: 1 ad ต่อ 1 วัน มีแถวเดียว (upsert ทับได้)
  unique (platform, account_id, ad_name, date)
);

create index if not exists idx_metrics_date     on public.ad_metrics_daily (date);
create index if not exists idx_metrics_platform on public.ad_metrics_daily (platform);
create index if not exists idx_metrics_account  on public.ad_metrics_daily (account_id);

-- (ออปชัน) ตารางบัญชีโฆษณาที่จะดึง — ให้ /api/sync อ่านว่าต้องดึงบัญชีไหนบ้าง
create table if not exists public.sources (
  id                  bigint generated always as identity primary key,
  platform            text not null,            -- meta | tiktok
  external_account_id text not null,            -- Meta act_ / TikTok advertiser_id
  display_name        text not null default '',
  tiktok_kind         text,                     -- business | gmv_max (เฉพาะ TikTok)
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (platform, external_account_id)
);

-- RLS: เปิดไว้ ปฏิเสธ client ทั่วไป (เข้าถึงได้เฉพาะ service_role ผ่าน /api)
alter table public.ad_metrics_daily enable row level security;
alter table public.sources          enable row level security;
-- ไม่ต้องสร้าง policy — service_role bypass RLS อยู่แล้ว, anon จะเข้าไม่ได้

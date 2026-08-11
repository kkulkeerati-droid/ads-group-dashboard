-- ═══════════════════════════════════════════════════════════════════
-- 0003 — เปลี่ยน key จาก "ชื่อแอด" เป็น "ad_id"
--
-- ทำไม: ทีมยิงโครงสร้าง 1:1:3 แล้วตั้งชื่อโฆษณาทุกตัวในชุดเหมือนกันเป๊ะ
--       Meta มองเป็นคนละ ad (คนละ ad_id) แต่ตารางนี้ unique ที่ (platform, account_id, ad_name, date)
--       → ทุกตัวที่ชื่อซ้ำถูกยุบเป็นแถวเดียว → ตัวชนะถูกกลบ
--       พิสูจน์แล้ว: AI/Ultra/600/7Aug มี 4 ad ID · ตัวจริง ROAS 14.15 แต่ dashboard โชว์ 6.49
--
-- รันไฟล์นี้ใน Supabase → SQL Editor → New query → วาง → Run
-- ⚠️ หลังรันเสร็จ "ต้อง re-sync ทับทันที" ไม่งั้นตัวเลขจะเป็นสองเท่าชั่วคราว
--    (แถวเก่า ad_id=ชื่อ ยังอยู่คู่กับแถวใหม่ ad_id=ตัวเลข)
--    วิธี: /api/sync?key=<CRON_SECRET>&since=&until=&prune=1  ทีละ ≤3-4 วัน
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) คอลัมน์ใหม่ ────────────────────────────────────────────────
alter table public.ad_metrics_daily
  add column if not exists ad_id            text,
  add column if not exists adset_id         text,
  add column if not exists adset_name       text,
  add column if not exists campaign_id      text,
  add column if not exists campaign_name    text,
  -- ออเดอร์ที่ "มีมูลค่าติดมาด้วย" — Meta นับ onsite_conversion.purchase เป็นซื้อ
  -- แม้มูลค่าเป็น ๐ (วัดจริง 3 ส.ค. 69: 35 จาก 61 ซื้อ = 57% ไม่มีมูลค่า)
  -- ตัวนี้คือตัวเดียวที่เอาไปนับบันไดออเดอร์ 10/20/30 ได้
  add column if not exists purchases_valued bigint not null default 0;

-- ── 2) เติม ad_id ให้แถวเก่า ──────────────────────────────────────
-- แถวเก่าไม่มี ad_id · ใช้ชื่อแทนไปก่อนเพื่อให้ unique key ใหม่ทำงานได้
-- โค้ดฝั่ง readRows มองแถวที่ ad_id = ad_name ว่า "ยังไม่มี ad_id จริง"
update public.ad_metrics_daily set ad_id = ad_name where ad_id is null;

alter table public.ad_metrics_daily alter column ad_id set not null;

-- ── 3) unique key ใหม่ ────────────────────────────────────────────
-- ใช้คอลัมน์ล้วน ไม่ใช่ expression index — PostgREST ส่ง on_conflict เป็นรายชื่อคอลัมน์
-- ถ้าใช้ coalesce(ad_id, ad_name) PostgREST จะ map ไม่ได้ (error 42P10)
create unique index if not exists uq_metrics_adid
  on public.ad_metrics_daily (platform, account_id, ad_id, date);

-- ── 3.1) ต้อง drop unique เก่าทิ้ง ────────────────────────────────
-- ไม่งั้นแอดคนละตัวที่ชื่อซ้ำจะ insert ไม่ได้เลย (ชน unique เก่า → error 23505)
-- = อาการจะกลายจาก "ตัวเลขผิด" เป็น "sync พังทั้งรอบ" ซึ่งแย่กว่าเดิม
-- หาชื่อ constraint เอาเอง ไม่ hardcode (ชื่อ auto-generate อาจถูกตัดถ้ายาวเกิน 63 ตัว)
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'ad_metrics_daily'
      and con.contype = 'u'
      and (
        select array_agg(att.attname order by att.attname)
        from unnest(con.conkey) k
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k
      ) = array['account_id','ad_name','date','platform']
  loop
    execute format('alter table public.ad_metrics_daily drop constraint %I', c.conname);
    raise notice 'dropped old unique constraint: %', c.conname;
  end loop;
end $$;

-- index ช่วยหา/ลบแถวค้างตอน prune
create index if not exists idx_metrics_updated  on public.ad_metrics_daily (updated_at);
create index if not exists idx_metrics_adset    on public.ad_metrics_daily (adset_id);

-- ── 4) ตาราง adset — targeting + งบจริง (อ่านจาก Meta แทนการเดาจากชื่อ) ──
-- snapshot "สถานะตอนนี้" ไม่ใช่รายวัน (Meta ไม่เก็บ targeting ย้อนหลัง)
create table if not exists public.ad_adsets (
  id                bigint generated always as identity primary key,
  platform          text not null,
  account_id        text not null,
  adset_id          text not null,
  adset_name        text not null default '',
  campaign_id       text,
  campaign_name     text,
  daily_budget      numeric,          -- บาท/วัน (null = ใช้งบระดับแคมเปญ CBO)
  lifetime_budget   numeric,
  created_time      timestamptz,      -- อายุจริง ไม่ต้องเดาจากวันที่ในชื่อแอด
  effective_status  text,
  age_min           int,
  age_max           int,
  genders           text,             -- all | male | female
  countries         text,
  interests         int  not null default 0,
  custom_audiences  int  not null default 0,
  excluded_audiences int not null default 0,
  lookalikes        int  not null default 0,
  platforms         text,
  is_broad          boolean not null default false,
  updated_at        timestamptz not null default now(),
  unique (platform, adset_id)
);

alter table public.ad_adsets enable row level security;
-- ไม่ต้องสร้าง policy — service_role bypass RLS อยู่แล้ว, anon เข้าไม่ได้

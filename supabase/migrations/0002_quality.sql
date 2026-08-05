-- metric คุณภาพ + ยอดขาย (คนกลับมาตอบ / ออเดอร์ / รายได้ → ROAS)
alter table public.ad_metrics_daily
  add column if not exists replies   bigint  not null default 0,
  add column if not exists purchases bigint  not null default 0,
  add column if not exists revenue   numeric not null default 0;

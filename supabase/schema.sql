-- ichiba-uri Supabase schema
-- 適用方法: Supabase Dashboard → SQL Editor で全文を貼り付けて Run

-- ======================================
-- ago_sheets : あご表セッション
-- ======================================
create table if not exists ago_sheets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'あご表',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_ago_sheets_updated_at on ago_sheets(updated_at desc);

-- ======================================
-- ago_rows : あご表の各行
-- ======================================
create table if not exists ago_rows (
  id                uuid primary key default gen_random_uuid(),
  sheet_id          uuid not null references ago_sheets(id) on delete cascade,
  position          int not null default 0,
  item_number       text,
  brand             text,
  item_name         text,
  accessories       text,
  condition         text,
  reserve_price     text,
  buyer             text,
  purchase_price    text,
  sale_price        text,
  lot_no            text,
  box_no            text,
  image_url         text,
  front_image_url   text,
  kintone_title     text,
  gemini_title      text,
  sold_out          boolean not null default false,
  tkb               boolean not null default false,
  broken            boolean not null default false,
  copy              boolean not null default false,
  campaign          text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_ago_rows_sheet_id on ago_rows(sheet_id);
create index if not exists idx_ago_rows_item_number on ago_rows(item_number);

-- ======================================
-- gemini_cache : Gemini解析結果キャッシュ
-- ======================================
create table if not exists gemini_cache (
  item_number   text primary key,
  image_url     text,
  category      text,
  brand         text,
  name          text,
  title         text,
  material      text,
  hardware      text,
  condition     text,
  confidence    text,
  raw_text      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ======================================
-- updated_at 自動更新トリガー
-- ======================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ago_sheets_updated on ago_sheets;
create trigger trg_ago_sheets_updated before update on ago_sheets
  for each row execute function set_updated_at();

drop trigger if exists trg_ago_rows_updated on ago_rows;
create trigger trg_ago_rows_updated before update on ago_rows
  for each row execute function set_updated_at();

drop trigger if exists trg_gemini_cache_updated on gemini_cache;
create trigger trg_gemini_cache_updated before update on gemini_cache
  for each row execute function set_updated_at();

-- ======================================
-- RLS (Row Level Security)
-- 内部ツールのため anon でフルアクセス許可。
-- ※ 公開URLを知ってる人なら誰でも読み書き可能になります。
--    本番運用ではAuth導入を検討してください。
-- ======================================
alter table ago_sheets enable row level security;
alter table ago_rows enable row level security;
alter table gemini_cache enable row level security;

drop policy if exists "allow_all_anon_sheets" on ago_sheets;
create policy "allow_all_anon_sheets" on ago_sheets for all using (true) with check (true);

drop policy if exists "allow_all_anon_rows" on ago_rows;
create policy "allow_all_anon_rows" on ago_rows for all using (true) with check (true);

drop policy if exists "allow_all_anon_cache" on gemini_cache;
create policy "allow_all_anon_cache" on gemini_cache for all using (true) with check (true);

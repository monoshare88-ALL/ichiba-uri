-- 設定テーブル (シングルトン: id=1の1行のみ)
create table if not exists app_settings (
  id          int primary key default 1,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);

-- 既存トリガー関数を再利用
drop trigger if exists trg_app_settings_updated on app_settings;
create trigger trg_app_settings_updated before update on app_settings
  for each row execute function set_updated_at();

-- RLS
alter table app_settings enable row level security;
drop policy if exists "allow_all_anon_settings" on app_settings;
create policy "allow_all_anon_settings" on app_settings for all using (true) with check (true);

-- 初期行を投入
insert into app_settings (id, data) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

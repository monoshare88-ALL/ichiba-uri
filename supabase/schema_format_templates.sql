-- フォーマットテンプレート保存用テーブル
-- 1市場 × 2タイプ (社内用/提出用) ごとに1つのテンプレートExcelを保存
create table if not exists format_templates (
  id uuid primary key default gen_random_uuid(),
  market text not null,
  format_type text not null check (format_type in ('internal', 'submission')),
  filename text,
  header_row int not null default 1,
  data_base64 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market, format_type)
);

drop trigger if exists trg_format_templates_updated on format_templates;
create trigger trg_format_templates_updated before update on format_templates
  for each row execute function set_updated_at();

alter table format_templates enable row level security;
drop policy if exists "allow_all_anon_format_templates" on format_templates;
create policy "allow_all_anon_format_templates" on format_templates for all using (true) with check (true);

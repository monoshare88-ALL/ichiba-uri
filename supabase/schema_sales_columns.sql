-- ichiba-uri: 売上入力カラム追加 (出品番号 / 売り金額 / 手数料)
-- 適用方法: Supabase Dashboard → SQL Editor で全文を貼り付けて Run
-- (再実行安全: IF NOT EXISTS を使用)

alter table ago_rows
  add column if not exists listing_number text,
  add column if not exists sale_amount    text,
  add column if not exists fee             text;

-- 参考: 既存行の確認
-- select id, item_number, listing_number, sale_amount, fee from ago_rows limit 5;

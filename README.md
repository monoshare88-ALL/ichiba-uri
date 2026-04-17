# あご表作成 (ichiba-uri)

ブランドバッグ等の「あご表」をWebで作成するNext.jsアプリ。
バーコード読取・S3画像表示・Gemini画像解析・Kintone連携で入力を自動化します。

## 構成

- **Next.js 16 (App Router) + TypeScript + TailwindCSS**
- **API ルート**
  - `GET /api/excel?itemNumber=XXX` — 参照Excel(`data/komehyo_ref.xlsx`)から商品データ取得
  - `GET /api/kintone?itemNumber=XXX` — Kintoneアプリ#171からバイヤー名・仕入れ金額等を取得
  - `POST /api/analyze` `{imageUrl}` — Gemini 1.5 Flashで画像を解析しブランド・商品名・タイトル抽出
- **ライブラリ**
  - `src/lib/s3ImageUrl.ts` — 商品番号からS3画像URLを生成
- **コンポーネント**
  - `src/components/BarcodeScanner.tsx` — Quagga2を使ったカメラバーコード読取

## S3画像URL生成ルール

```
Base: https://ebay-items.s3.ap-northeast-1.amazonaws.com/Photo/

商品番号 ≧ 1,000,000 :  Photo/{先頭1桁}00/{先頭2桁}0/{番号}.jpg
                       例) 36511050 → Photo/300/360/36511050.jpg

商品番号 < 1,000,000 :  Photo/{先頭1桁}0/{番号}.jpg
                       例) 365110   → Photo/30/365110.jpg
```

## セットアップ

```bash
npm install
npm run dev
```

`.env.local`に下記を設定：

```env
# AWS S3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-northeast-1
S3_BUCKET=ebay-items

# Gemini (https://aistudio.google.com/app/apikey で取得)
GEMINI_API_KEY=...

# Kintone (要設定)
KINTONE_SUBDOMAIN=your_subdomain
KINTONE_API_TOKEN_APP171=...
KINTONE_APP_ID=171

# 参照Excelファイル (プロジェクトルートからの相対パスでも絶対パスでもOK)
EXCEL_REF_PATH=./data/komehyo_ref.xlsx
```

## データの流れ

1. **商品番号入力 / バーコード読取**
2. 並列で3つのソースから情報取得：
   - **Excel** (`api/excel`) — 箱番、ブランド、商品名、付属品、状態、指値、買値、買値税込み
   - **Kintone #171** (`api/kintone`) — バイヤー名、仕入れ金額、状態など空欄を埋める
   - **Gemini** (`api/analyze`) — S3画像を解析しブランド・商品名・タイトル抽出
3. テーブル行に自動入力。空欄や追加情報を手動編集可能
4. 「CSVエクスポート」で結果をCSV出力

## TODO（要設定情報）

- [ ] **Gemini APIキー** — `.env.local`の`GEMINI_API_KEY`を設定
- [ ] **Kintoneサブドメイン・APIトークン** — `KINTONE_SUBDOMAIN`、`KINTONE_API_TOKEN_APP171`を設定
- [ ] **Kintoneフィールドコード調整** — `src/app/api/kintone/route.ts` 内のフィールド名を実際のKintoneアプリ#171の設定に合わせて修正
- [ ] **参照Excel更新** — 月次で新しいあご表に差し替える場合は `data/komehyo_ref.xlsx` を上書き

## 注意

- バーコード読取はカメラへのアクセスが必要なため、`https://` または `localhost` でのみ動作します
- Excelファイルは Dropbox 上のファイルだとロックや同期の影響で読み込みエラーになることがあるため、`data/` フォルダにコピーしてから使用しています
- `.env.local` にAWSキーが含まれているため、Gitにコミットしないこと（`.gitignore`済み）

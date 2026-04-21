/**
 * 市場プロファイル定義
 *
 * 各市場のExcelインポート/エクスポートに必要な設定を一元管理する。
 * 新しい市場を追加するときはここにプロファイルを追加するだけで
 * インポート・エクスポート・売上取込がすべて対応される。
 */
import type { ColumnDef, ColumnFieldType } from "@/app/api/settings/route";

/* ================================================================
 *  型定義
 * ================================================================ */

export interface MarketImportConfig {
  /** スキップするシート名パターン (部分一致) */
  skipSheetPatterns: string[];
  /** ヘッダーエイリアス (HEADER_ALIASES を上書き/追加) */
  headerAliases: Record<string, string[]>;
}

/** 売上取込のヘッダー→フィールドマッピング */
export type SalesTargetField = "LISTING_NUMBER" | "ITEM_NUMBER" | "SALE_AMOUNT" | "FEE" | "CAMPAIGN";

export interface SalesImportConfig {
  /** 列定義 (設定画面表示用) */
  columns: ColumnDef[];
  /**
   * 売上明細CSVのヘッダー → ターゲットフィールドの直接マッピング
   * headerMapping.ts の汎用マッピン���では対応できない市場固有のマッピングを定義
   * 例: コメ兵では「出品者備考」に自社出品番号が入るが、通常は EMPTY にマッピングされる
   */
  headerMap: Record<string, SalesTargetField>;
  /** スキップするシート名パターン (部分一致) — 売上明細Excel/CSV用 */
  skipSheetPatterns?: string[];
  /** セリ結果列: この列が指定値の行だけ取り込む (省略時は全行) */
  resultFilter?: { header: string; value: string };
}

export interface MarketProfile {
  /** 市場ID (内部キー) */
  id: string;
  /** 表示名 */
  name: string;
  /** 説明 */
  description: string;
  /** Excel取込設定 (あご表取込) */
  import: MarketImportConfig;
  /** 社内用エクスポート列定義 */
  internalColumns: ColumnDef[];
  /** 提出用エクスポート列定義 */
  submissionColumns: ColumnDef[];
  /** 売上取込設定 (売上明細CSV/Excel) */
  salesImport: SalesImportConfig;
}

/* ================================================================
 *  コメ兵プロファイル
 * ================================================================ */

const KOMEHYO: MarketProfile = {
  id: "komehyo",
  name: "コメ兵",
  description: "コメ兵大会 — Sheet2からデータ取込、原本タブはスキップ",

  import: {
    skipSheetPatterns: ["原本"],
    headerAliases: {
      item_number:    ["商品番号", "SKU", "管理番号", "item_number", "商品No"],
      listing_number: ["出品番号", "出品No", "出品ID", "listing_number", "自社出品"],
      brand:          ["ブランド", "brand", "メーカー"],
      item_name:      ["バッグ名", "ブランド名", "商品名", "品名", "item_name", "モデル名"],
      accessories:    ["付属品", "付属品その他", "accessories"],
      condition:      ["状態", "condition", "コンディション"],
      reserve_price:  ["指値", "指値(円)", "リザーブ", "reserve_price"],
      buyer:          ["バイヤー", "バイヤー名", "buyer", "担当者"],
      purchase_price: ["仕入価格", "買値", "仕入れ", "purchase_price"],
      sale_price:     ["販売価格", "売値", "sale_price"],
      sale_amount:    ["売り金額", "売上", "成立金額", "落札価格", "sale_amount"],
      fee:            ["手数料", "システム手数料", "落札手数料", "販売手数料", "fee"],
      lot_no:         ["ロットNo", "ロットNo.", "lot_no", "ロット"],
      box_no:         ["箱番", "箱番、枝番", "箱番号", "box_no"],
    },
  },

  // 社内用 (23列 — Sheet2 実構造準拠)
  internalColumns: [
    { header: "箱番、枝番",     field: "BOX_NO" as ColumnFieldType,                    width: 10 },
    { header: "ロットNo",       field: "LOT_NO" as ColumnFieldType,                    width: 10 },
    { header: "自社出品",       field: "LISTING_NUMBER" as ColumnFieldType,            width: 10 },
    { header: "ブランド",       field: "BRAND" as ColumnFieldType,                     width: 14 },
    { header: "ブランド名",     field: "ITEM_NAME" as ColumnFieldType,                 width: 30 },
    { header: "付属品",         field: "ACCESSORIES" as ColumnFieldType,               width: 22 },
    { header: "状態",           field: "CONDITION_WITH_FLAGS" as ColumnFieldType,      width: 22 },
    { header: "指値(円)",       field: "RESERVE_PRICE" as ColumnFieldType,             width: 10 },
    { header: "バイヤー",       field: "BUYER" as ColumnFieldType,                     width: 10 },
    { header: "買値",           field: "PURCHASE_PRICE" as ColumnFieldType,            width: 12 },
    { header: "買値税込み",     field: "PURCHASE_PRICE_TAX_INCL" as ColumnFieldType,   width: 12 },
    { header: "商品番号",       field: "ITEM_NUMBER" as ColumnFieldType,               width: 12 },
    { header: "バイヤー２",     field: "EMPTY" as ColumnFieldType,                     width: 10 },
    { header: "出品者備考",     field: "EMPTY" as ColumnFieldType,                     width: 14 },
    { header: "セリ結果",       field: "EMPTY" as ColumnFieldType,                     width: 10 },
    { header: "成立金額",       field: "SALE_AMOUNT" as ColumnFieldType,               width: 12 },
    { header: "販売手数料",     field: "FEE" as ColumnFieldType,                       width: 12 },
    { header: "キャンペーンキャッシュバック", field: "EMPTY" as ColumnFieldType,        width: 14 },
    { header: "返品",           field: "EMPTY" as ColumnFieldType,                     width: 8 },
    { header: "税込み",         field: "SALE_AMOUNT_TAX_INCL" as ColumnFieldType,      width: 12 },
    { header: "手数料税込み",   field: "FEE_TAX_INCL" as ColumnFieldType,              width: 12 },
    { header: "",               field: "EMPTY" as ColumnFieldType,                     width: 6 },
    { header: "粗利",           field: "GROSS_PROFIT" as ColumnFieldType,              width: 12 },
  ],

  // 提出用あご表 (7列 — JP.company フォーマット)
  submissionColumns: [
    { header: "箱番、枝番",     field: "EMPTY" as ColumnFieldType,                     width: 10 },
    { header: "ロットNo",       field: "EMPTY" as ColumnFieldType,                     width: 10 },
    { header: "自社出品",       field: "LISTING_NUMBER" as ColumnFieldType,            width: 10 },
    { header: "ブランド",       field: "BRAND" as ColumnFieldType,                     width: 14 },
    { header: "モデル名",       field: "ITEM_NAME" as ColumnFieldType,                 width: 30 },
    { header: "付属品その他",   field: "ACCESSORIES" as ColumnFieldType,               width: 22 },
    { header: "指値(円)",       field: "RESERVE_PRICE" as ColumnFieldType,             width: 10 },
  ],

  // 売上取込 (コメ兵から受領する「ご出品商品明細」CSV)
  salesImport: {
    columns: [
      { header: "出品者備考",     field: "LISTING_NUMBER" as ColumnFieldType,            width: 12 },
      { header: "成立金額",       field: "SALE_AMOUNT" as ColumnFieldType,               width: 12 },
      { header: "販売手数料",     field: "FEE" as ColumnFieldType,                       width: 12 },
    ],
    // 売上明��CSV固有: 「出品者備考」に自社出品番号 (A-1等) が入っている
    headerMap: {
      "出品者備考":               "LISTING_NUMBER",
      "自社出品":                 "LISTING_NUMBER",
      "商品番号":                 "ITEM_NUMBER",
      "成立金額":                 "SALE_AMOUNT",
      "販売手数料":               "FEE",
      "売り金額":                 "SALE_AMOUNT",
      "手数料":                   "FEE",
      "キャンペーンキャッシュバック": "CAMPAIGN",
      "キャンペーン":             "CAMPAIGN",
    },
    resultFilter: { header: "セリ結果", value: "成立" },
  },
};

/* ================================================================
 *  市場連盟 (TABA) プロファイル
 * ================================================================ */

const TABA: MarketProfile = {
  id: "taba",
  name: "市場連盟",
  description: "市場連盟(TABA) — 入力用ｼｰﾄからデータ取込、印刷用・入力例はスキップ",

  import: {
    skipSheetPatterns: ["印刷用", "入力例"],
    headerAliases: {
      item_number:    ["商品番号", "item_number"],
      listing_number: ["通番", "listing_number"],
      brand:          ["ﾌﾞﾗﾝﾄﾞ名", "ブランド名", "ブランド", "brand"],
      item_name:      ["ﾓﾃﾞﾙ名", "モデル名", "商品名", "item_name"],
      accessories:    ["付属品", "accessories"],
      condition:      ["ﾗﾝｸ", "ランク", "状態", "condition"],
      reserve_price:  ["指値（税抜）", "指値", "reserve_price"],
      buyer:          ["バイヤー名", "バイヤー", "buyer"],
      purchase_price: ["仕入れ金額", "仕入価格", "買値", "purchase_price"],
      sale_price:     ["販売価格", "売値", "sale_price"],
      sale_amount:    ["売り", "売り金額", "sale_amount"],
      fee:            ["手数料", "fee"],
      lot_no:         ["頁", "lot_no"],
      box_no:         ["箱番", "box_no"],
    },
  },

  // 社内用 (バイヤー用フォーマット — 入力用ｼｰﾄ準拠)
  internalColumns: [
    { header: "通番",           field: "LISTING_NUMBER" as ColumnFieldType,            width: 6 },
    { header: "頁",             field: "LOT_NO" as ColumnFieldType,                    width: 6 },
    { header: "箱番",           field: "BOX_NO" as ColumnFieldType,                    width: 8 },
    { header: "枝番",           field: "EMPTY" as ColumnFieldType,                     width: 6 },
    { header: "品名",           field: "EMPTY" as ColumnFieldType,                     width: 14 },
    { header: "ﾌﾞﾗﾝﾄﾞ名",      field: "BRAND" as ColumnFieldType,                     width: 14 },
    { header: "ﾗｲﾝ",           field: "EMPTY" as ColumnFieldType,                     width: 12 },
    { header: "ﾓﾃﾞﾙ名",        field: "ITEM_NAME" as ColumnFieldType,                 width: 28 },
    { header: "型番",           field: "EMPTY" as ColumnFieldType,                     width: 12 },
    { header: "ｼﾘｱﾙ",          field: "EMPTY" as ColumnFieldType,                     width: 12 },
    { header: "ｶﾗｰ",           field: "EMPTY" as ColumnFieldType,                     width: 10 },
    { header: "素材",           field: "EMPTY" as ColumnFieldType,                     width: 10 },
    { header: "ﾗﾝｸ",           field: "CONDITION_RAW" as ColumnFieldType,             width: 8 },
    { header: "付属品",         field: "ACCESSORIES" as ColumnFieldType,               width: 18 },
    { header: "特徴",           field: "EMPTY" as ColumnFieldType,                     width: 18 },
    { header: "欠点",           field: "EMPTY" as ColumnFieldType,                     width: 18 },
    { header: "別展",           field: "EMPTY" as ColumnFieldType,                     width: 6 },
    { header: "指値（税抜）",   field: "RESERVE_PRICE" as ColumnFieldType,             width: 12 },
    { header: "",               field: "EMPTY" as ColumnFieldType,                     width: 4 },
    { header: "",               field: "EMPTY" as ColumnFieldType,                     width: 4 },
    { header: "商品番号",       field: "ITEM_NUMBER" as ColumnFieldType,               width: 12 },
    { header: "仕入れ金額",     field: "PURCHASE_PRICE" as ColumnFieldType,            width: 12 },
    { header: "税込み",         field: "PURCHASE_PRICE_TAX_INCL" as ColumnFieldType,   width: 12 },
    { header: "バイヤー名",     field: "BUYER" as ColumnFieldType,                     width: 10 },
    { header: "バイヤー２",     field: "EMPTY" as ColumnFieldType,                     width: 10 },
    { header: "難点",           field: "EMPTY" as ColumnFieldType,                     width: 18 },
    { header: "",               field: "EMPTY" as ColumnFieldType,                     width: 4 },
    { header: "売り",           field: "SALE_AMOUNT" as ColumnFieldType,               width: 12 },
    { header: "売り税込み",     field: "SALE_AMOUNT_TAX_INCL" as ColumnFieldType,      width: 12 },
    { header: "手数料",         field: "FEE" as ColumnFieldType,                       width: 12 },
    { header: "",               field: "EMPTY" as ColumnFieldType,                     width: 4 },
    { header: "粗利",           field: "GROSS_PROFIT" as ColumnFieldType,              width: 12 },
  ],

  // 提出用 (JP.Company フォーマット — 入力用ｼｰﾄ B:S)
  submissionColumns: [
    { header: "通番",           field: "LISTING_NUMBER" as ColumnFieldType,            width: 6 },
    { header: "頁",             field: "EMPTY" as ColumnFieldType,                     width: 6 },
    { header: "箱番",           field: "EMPTY" as ColumnFieldType,                     width: 8 },
    { header: "枝番",           field: "EMPTY" as ColumnFieldType,                     width: 6 },
    { header: "品名",           field: "EMPTY" as ColumnFieldType,                     width: 14 },
    { header: "ﾌﾞﾗﾝﾄﾞ名",      field: "BRAND" as ColumnFieldType,                     width: 14 },
    { header: "ﾗｲﾝ",           field: "EMPTY" as ColumnFieldType,                     width: 12 },
    { header: "ﾓﾃﾞﾙ名",        field: "ITEM_NAME" as ColumnFieldType,                 width: 28 },
    { header: "型番",           field: "EMPTY" as ColumnFieldType,                     width: 12 },
    { header: "ｼﾘｱﾙ",          field: "EMPTY" as ColumnFieldType,                     width: 12 },
    { header: "ｶﾗｰ",           field: "EMPTY" as ColumnFieldType,                     width: 10 },
    { header: "素材",           field: "EMPTY" as ColumnFieldType,                     width: 10 },
    { header: "ﾗﾝｸ",           field: "CONDITION_RAW" as ColumnFieldType,             width: 8 },
    { header: "付属品",         field: "ACCESSORIES" as ColumnFieldType,               width: 18 },
    { header: "特徴",           field: "EMPTY" as ColumnFieldType,                     width: 18 },
    { header: "欠点",           field: "EMPTY" as ColumnFieldType,                     width: 18 },
    { header: "別展",           field: "EMPTY" as ColumnFieldType,                     width: 6 },
    { header: "指値（税抜）",   field: "RESERVE_PRICE" as ColumnFieldType,             width: 12 },
  ],

  // 売上取込 (売り入札結果はJPGスキャンのみ、Excel売上明細なし)
  // バイヤー用ファイルの売り列から手動取込を想定
  salesImport: {
    columns: [
      { header: "通番",           field: "LISTING_NUMBER" as ColumnFieldType,            width: 8 },
      { header: "売り",           field: "SALE_AMOUNT" as ColumnFieldType,               width: 12 },
      { header: "手数料",         field: "FEE" as ColumnFieldType,                       width: 12 },
    ],
    headerMap: {
      "通番":                     "LISTING_NUMBER",
      "商品番号":                 "ITEM_NUMBER",
      "売り":                     "SALE_AMOUNT",
      "売り金額":                 "SALE_AMOUNT",
      "成立金額":                 "SALE_AMOUNT",
      "手数料":                   "FEE",
    },
  },
};

/* ================================================================
 *  プロファイル登録 & ユーティリティ
 * ================================================================ */

/** 全プロファイル (市場名→プロファイル) */
const PROFILES: Record<string, MarketProfile> = {
  "コメ兵": KOMEHYO,
  "市場連盟": TABA,
};

/** 登録済み市場名の一覧を返す */
export function getAvailableMarkets(): { id: string; name: string; description: string }[] {
  return Object.values(PROFILES).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));
}

/** 市場名からプロファイルを取得 (未登録は undefined) */
export function getMarketProfile(market: string): MarketProfile | undefined {
  return PROFILES[market];
}

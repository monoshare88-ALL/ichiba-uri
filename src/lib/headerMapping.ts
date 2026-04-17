import type { ColumnFieldType } from "@/app/api/settings/route";

/**
 * Excelヘッダー文字列から ColumnFieldType を推定
 * - 完全一致を優先
 * - 部分一致は specific → general の順で評価
 * - 該当なしは EMPTY
 */

const EXACT_MAP: Record<string, ColumnFieldType> = {
  "市場": "MARKET",
  "出品番号": "LISTING_NUMBER",
  "出品No": "LISTING_NUMBER",
  "出品ID": "LISTING_NUMBER",
  "商品番号": "ITEM_NUMBER",
  "SKU": "ITEM_NUMBER",
  "管理番号": "ITEM_NUMBER",
  "商品No": "ITEM_NUMBER",
  "ブランド": "BRAND",
  "ブランド名": "ITEM_NAME",
  "バッグ名": "ITEM_NAME",
  "商品名": "ITEM_NAME",
  "品名": "ITEM_NAME",
  "付属品": "ACCESSORIES",
  "状態": "CONDITION_WITH_FLAGS",
  "コンディション": "CONDITION_WITH_FLAGS",
  "ランク": "CONDITION_WITH_FLAGS",
  "指値": "RESERVE_PRICE",
  "指値(円)": "RESERVE_PRICE",
  "リザーブ": "RESERVE_PRICE",
  "Cataリザーブ": "RESERVE_PRICE",
  "希望価格": "RESERVE_PRICE",
  "バイヤー": "BUYER",
  "バイヤー名": "BUYER",
  "担当者": "BUYER",
  "仕入価格": "PURCHASE_PRICE",
  "仕入れ価格": "PURCHASE_PRICE",
  "買値": "PURCHASE_PRICE",
  "仕入れ": "PURCHASE_PRICE",
  "原価": "PURCHASE_PRICE",
  "販売価格": "SALE_PRICE",
  "売値": "SALE_PRICE",
  "売り金額": "SALE_AMOUNT",
  "売上": "SALE_AMOUNT",
  "成立金額": "SALE_AMOUNT",
  "落札価格": "SALE_AMOUNT",
  "手数料": "FEE",
  "システム手数料": "FEE",
  "落札手数料": "FEE",
  "販売手数料": "FEE",
  "ロットNo": "LOT_NO",
  "ロット": "LOT_NO",
  "ロット番号": "LOT_NO",
  "Lot": "LOT_NO",
  "箱番": "BOX_NO",
  "箱番号": "BOX_NO",
  "箱番、枝番": "BOX_NO",
  "箱": "BOX_NO",
  "Kintoneタイトル": "KINTONE_TITLE",
  "Geminiタイトル": "GEMINI_TITLE",
  "タイトル": "TITLE_AUTO",
  "Title": "TITLE_AUTO",
  "title": "TITLE_AUTO",
  "Description": "TITLE_AUTO",
  // コメ兵固有ヘッダー
  "自社出品": "LISTING_NUMBER",
  "モデル名": "ITEM_NAME",
  "買値税込み": "PURCHASE_PRICE_TAX_INCL",
  "粗利": "GROSS_PROFIT",
  "セリ結果": "EMPTY",
  "キャンペーン": "EMPTY",
  "キャンペーンキャッシュバック": "EMPTY",
  "返品": "EMPTY",
  "出品者備考": "EMPTY",
  "税込み": "SALE_AMOUNT_TAX_INCL",
  "手数料税込み": "FEE_TAX_INCL",
  "バイヤー２": "EMPTY",
};

// より specific → general の順で並べる
const FUZZY_MAP: { keywords: string[]; field: ColumnFieldType }[] = [
  // LISTING_NUMBER (ITEM_NUMBERより先に)
  { keywords: ["出品番号", "出品No", "出品ID"], field: "LISTING_NUMBER" },
  // ITEM_NAME (BRAND より先に判定)
  { keywords: ["バッグ名", "商品名", "品名", "ブランド名"], field: "ITEM_NAME" },
  // ITEM_NUMBER
  { keywords: ["商品番号", "管理番号", "商品No"], field: "ITEM_NUMBER" },
  // BRAND
  { keywords: ["ブランド", "メーカー"], field: "BRAND" },
  // TAX-INCLUSIVE (税込系は先に判定)
  { keywords: ["買値税込", "仕入税込"], field: "PURCHASE_PRICE_TAX_INCL" },
  { keywords: ["売り金額 税込", "売り金額　税込", "売上税込"], field: "SALE_AMOUNT_TAX_INCL" },
  { keywords: ["手数料 税込", "手数料　税込", "手数料税込"], field: "FEE_TAX_INCL" },
  // GROSS_PROFIT
  { keywords: ["粗利"], field: "GROSS_PROFIT" },
  // PURCHASE_PRICE (SALE_PRICEより先)
  { keywords: ["仕入", "買値", "原価"], field: "PURCHASE_PRICE" },
  // FEE (手数料 / 料)
  { keywords: ["手数料", "システム料"], field: "FEE" },
  // SALE_AMOUNT (SALE_PRICEより先、実売上系キーワード)
  { keywords: ["売り金", "成立", "落札", "売上"], field: "SALE_AMOUNT" },
  // SALE_PRICE (販売/売値)
  { keywords: ["売値", "販売"], field: "SALE_PRICE" },
  // RESERVE_PRICE
  { keywords: ["指値", "リザーブ", "希望価格"], field: "RESERVE_PRICE" },
  // ACCESSORIES
  { keywords: ["付属"], field: "ACCESSORIES" },
  // CONDITION
  { keywords: ["状態", "ランク", "コンディション"], field: "CONDITION_WITH_FLAGS" },
  // BUYER
  { keywords: ["バイヤー", "担当"], field: "BUYER" },
  // LOT_NO
  { keywords: ["ロット", "Lot", "lot"], field: "LOT_NO" },
  // BOX_NO
  { keywords: ["箱番", "箱"], field: "BOX_NO" },
  // MARKET
  { keywords: ["市場"], field: "MARKET" },
  // TITLE
  { keywords: ["タイトル", "title"], field: "TITLE_AUTO" },
];

export function mapHeaderToField(header: unknown): ColumnFieldType {
  const text = String(header || "").trim();
  if (!text) return "EMPTY";

  // 完全一致を優先
  if (EXACT_MAP[text]) return EXACT_MAP[text];

  // 部分一致
  for (const entry of FUZZY_MAP) {
    if (entry.keywords.some(k => text.includes(k))) return entry.field;
  }

  return "EMPTY";
}

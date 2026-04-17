import type { ColumnFieldType } from "@/app/api/settings/route";

export const COLUMN_FIELDS: { value: ColumnFieldType; label: string }[] = [
  { value: "EMPTY",                label: "(空欄)" },
  { value: "FIXED",                label: "(固定値)" },
  { value: "KEEP_TEMPLATE",        label: "(テンプレートの値を維持)" },
  { value: "MARKET",               label: "市場 (設定値)" },
  { value: "ITEM_NUMBER",          label: "商品番号" },
  { value: "LISTING_NUMBER",       label: "出品番号" },
  { value: "BRAND",                label: "ブランド" },
  { value: "ITEM_NAME",            label: "バッグ名" },
  { value: "ACCESSORIES",          label: "付属品" },
  { value: "CONDITION_WITH_FLAGS", label: "状態 (フラグ含む)" },
  { value: "CONDITION_RAW",        label: "状態 (フラグなし)" },
  { value: "RESERVE_PRICE",        label: "指値" },
  { value: "BUYER",                label: "バイヤー (人名変換後)" },
  { value: "PURCHASE_PRICE",       label: "仕入価格" },
  { value: "SALE_PRICE",           label: "販売価格" },
  { value: "SALE_AMOUNT",          label: "売り金額" },
  { value: "FEE",                  label: "手数料" },
  { value: "LOT_NO",               label: "ロットNo" },
  { value: "BOX_NO",               label: "箱番" },
  { value: "KINTONE_TITLE",        label: "Kintoneタイトル" },
  { value: "GEMINI_TITLE",         label: "Geminiタイトル" },
  { value: "TITLE_AUTO",           label: "タイトル自動 (Gemini→Kintone→ロット)" },
  { value: "SOLD_OUT_FLAG",        label: "売切ラベル" },
  { value: "TKB_FLAG",             label: "TKBラベル" },
  { value: "BROKEN_FLAG",          label: "壊れラベル" },
  { value: "COPY_FLAG",            label: "コピーラベル" },
  { value: "PURCHASE_PRICE_TAX_INCL", label: "買値税込み (仕入×税率)" },
  { value: "SALE_AMOUNT_TAX_INCL",    label: "売り金額 税込み" },
  { value: "FEE_TAX_INCL",            label: "手数料 税込み" },
  { value: "GROSS_PROFIT",            label: "粗利 (売上税込−手数料税込)" },
];

export interface ResolverRow {
  itemNumber: string;
  listingNumber: string;
  brand: string;
  itemName: string;
  accessories: string;
  condition: string;
  reservePrice: string;
  buyer: string;
  purchasePrice: string;
  salePrice: string;
  saleAmount: string;
  fee: string;
  lotNo: string;
  boxNo: string;
  kintoneTitle: string;
  geminiTitle: string;
  soldOut: boolean;
  tkb: boolean;
  broken: boolean;
  copy: boolean;
}

export interface ResolverContext {
  market: string;
  resolveBuyer: (code: string) => string;
  taxRate: number; // 税率 (%) — 例: 10
}

/**
 * 数値文字列に税率を掛けた税込値を返す (空文字は空文字を返す)
 */
function applyTax(value: string, taxRate: number): string {
  const n = parseFloat(value);
  if (!value || !Number.isFinite(n)) return "";
  return String(n * (1 + taxRate / 100));
}

/**
 * 状態にフラグを先頭付与した文字列を返す
 */
export function buildConditionWithFlags(row: ResolverRow): string {
  const flags: string[] = [];
  if (row.soldOut) flags.push("売切");
  if (row.tkb) flags.push("TKB");
  if (row.broken) flags.push("壊れ");
  if (row.copy) flags.push("コピー");
  const prefix = flags.join(" ");
  if (!prefix) return row.condition || "";
  return row.condition?.trim() ? `${prefix} ${row.condition}` : prefix;
}

/**
 * 列定義 + 行 → 出力値
 */
export function resolveColumnValue(
  field: ColumnFieldType,
  fixedValue: string | undefined,
  row: ResolverRow,
  ctx: ResolverContext
): string {
  switch (field) {
    case "KEEP_TEMPLATE":   return "";  // 実際にはエクスポート側でセル更新をスキップ
    case "EMPTY":           return "";
    case "FIXED":           return fixedValue || "";
    case "MARKET":          return ctx.market || "";
    case "ITEM_NUMBER":     return row.itemNumber || "";
    case "LISTING_NUMBER":  return row.listingNumber || "";
    case "BRAND":           return row.brand || "";
    case "ITEM_NAME":       return row.itemName || "";
    case "ACCESSORIES":     return row.accessories || "";
    case "CONDITION_WITH_FLAGS": return buildConditionWithFlags(row);
    case "CONDITION_RAW":   return row.condition || "";
    case "RESERVE_PRICE":   return row.reservePrice || "";
    case "BUYER":           return ctx.resolveBuyer(row.buyer || "");
    case "PURCHASE_PRICE":  return row.purchasePrice || "";
    case "SALE_PRICE":      return row.salePrice || "";
    case "SALE_AMOUNT":     return row.saleAmount || "";
    case "FEE":             return row.fee || "";
    case "LOT_NO":          return row.lotNo || "";
    case "BOX_NO":          return row.boxNo || "";
    case "KINTONE_TITLE":   return row.kintoneTitle || "";
    case "GEMINI_TITLE":    return row.geminiTitle || "";
    case "TITLE_AUTO":
      return row.geminiTitle?.trim() || row.kintoneTitle?.trim() || row.lotNo || "";
    case "SOLD_OUT_FLAG":   return row.soldOut ? "売切" : "";
    case "TKB_FLAG":        return row.tkb ? "TKB" : "";
    case "BROKEN_FLAG":     return row.broken ? "壊れ" : "";
    case "COPY_FLAG":       return row.copy ? "コピー" : "";
    case "PURCHASE_PRICE_TAX_INCL": return applyTax(row.purchasePrice, ctx.taxRate);
    case "SALE_AMOUNT_TAX_INCL":    return applyTax(row.saleAmount, ctx.taxRate);
    case "FEE_TAX_INCL":            return applyTax(row.fee, ctx.taxRate);
    case "GROSS_PROFIT": {
      const sa = parseFloat(row.saleAmount);
      const fe = parseFloat(row.fee);
      if (!Number.isFinite(sa)) return "";
      const taxMul = 1 + ctx.taxRate / 100;
      return String((sa - (Number.isFinite(fe) ? fe : 0)) * taxMul);
    }
    default:                return "";
  }
}

/**
 * デフォルト形式 (市場別フォーマットが未設定の時に使う)
 */
export const DEFAULT_FORMAT_COLUMNS = [
  { header: "市場",         field: "MARKET" as ColumnFieldType,            width: 12 },
  { header: "出品番号",     field: "LISTING_NUMBER" as ColumnFieldType,    width: 12 },
  { header: "商品番号",     field: "ITEM_NUMBER" as ColumnFieldType,       width: 12 },
  { header: "ブランド",     field: "BRAND" as ColumnFieldType,             width: 14 },
  { header: "バッグ名",     field: "ITEM_NAME" as ColumnFieldType,         width: 30 },
  { header: "付属品",       field: "ACCESSORIES" as ColumnFieldType,       width: 22 },
  { header: "状態",         field: "CONDITION_WITH_FLAGS" as ColumnFieldType, width: 22 },
  { header: "指値",         field: "RESERVE_PRICE" as ColumnFieldType,     width: 10 },
  { header: "バイヤー",     field: "BUYER" as ColumnFieldType,             width: 10 },
  { header: "仕入価格",     field: "PURCHASE_PRICE" as ColumnFieldType,    width: 12 },
  { header: "売り金額",     field: "SALE_AMOUNT" as ColumnFieldType,       width: 12 },
  { header: "手数料",       field: "FEE" as ColumnFieldType,               width: 10 },
  { header: "Kintoneタイトル", field: "KINTONE_TITLE" as ColumnFieldType,  width: 30 },
  { header: "Geminiタイトル",  field: "GEMINI_TITLE" as ColumnFieldType,   width: 30 },
];

/**
 * コメ兵プリセット: 社内用 (21列)
 */
export const KOMEHYO_INTERNAL_COLUMNS: import("@/app/api/settings/route").ColumnDef[] = [
  { header: "箱番、枝番",     field: "BOX_NO",                    width: 10 },
  { header: "ロットNo",       field: "LOT_NO",                    width: 10 },
  { header: "自社出品",       field: "LISTING_NUMBER",            width: 10 },
  { header: "ブランド",       field: "BRAND",                     width: 14 },
  { header: "ブランド名",     field: "ITEM_NAME",                 width: 30 },
  { header: "付属品",         field: "ACCESSORIES",               width: 22 },
  { header: "状態",           field: "CONDITION_WITH_FLAGS",      width: 22 },
  { header: "指値(円)",       field: "RESERVE_PRICE",             width: 10 },
  { header: "バイヤー",       field: "BUYER",                     width: 10 },
  { header: "買値",           field: "PURCHASE_PRICE",            width: 12 },
  { header: "買値税込み",     field: "PURCHASE_PRICE_TAX_INCL",   width: 12 },
  { header: "商品番号",       field: "ITEM_NUMBER",               width: 12 },
  { header: "バイヤー２",     field: "EMPTY",                     width: 10 },
  { header: "",               field: "EMPTY",                     width: 6 },
  { header: "売り金額",       field: "SALE_AMOUNT",               width: 12 },
  { header: "手数料",         field: "FEE",                       width: 10 },
  { header: "キャンペーン",   field: "EMPTY",                     width: 10 },
  { header: "売り金額 税込み", field: "SALE_AMOUNT_TAX_INCL",     width: 12 },
  { header: "手数料 　税込み", field: "FEE_TAX_INCL",             width: 12 },
  { header: "",               field: "EMPTY",                     width: 6 },
  { header: "粗利",           field: "GROSS_PROFIT",              width: 12 },
];

/**
 * コメ兵プリセット: 提出用あご表 (7列)
 */
export const KOMEHYO_SUBMISSION_COLUMNS: import("@/app/api/settings/route").ColumnDef[] = [
  { header: "箱番、枝番",     field: "EMPTY",                     width: 10 },
  { header: "ロットNo",       field: "EMPTY",                     width: 10 },
  { header: "自社出品",       field: "LISTING_NUMBER",            width: 10 },
  { header: "ブランド",       field: "BRAND",                     width: 14 },
  { header: "モデル名",       field: "ITEM_NAME",                 width: 30 },
  { header: "付属品その他",   field: "ACCESSORIES",               width: 22 },
  { header: "指値(円)",       field: "RESERVE_PRICE",             width: 10 },
];

/**
 * 市場名からプリセットフォーマットを取得 (未登録市場は undefined)
 */
export function getMarketPreset(market: string): { internal?: import("@/app/api/settings/route").ColumnDef[]; submission?: import("@/app/api/settings/route").ColumnDef[] } | undefined {
  if (market === "コメ兵") {
    return {
      internal: KOMEHYO_INTERNAL_COLUMNS,
      submission: KOMEHYO_SUBMISSION_COLUMNS,
    };
  }
  return undefined;
}

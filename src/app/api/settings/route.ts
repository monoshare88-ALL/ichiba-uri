import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export type ColumnFieldType =
  | "KEEP_TEMPLATE"
  | "MARKET"
  | "EMPTY"
  | "FIXED"
  | "ITEM_NUMBER"
  | "LISTING_NUMBER"
  | "BRAND"
  | "ITEM_NAME"
  | "ACCESSORIES"
  | "CONDITION_WITH_FLAGS"
  | "CONDITION_RAW"
  | "RESERVE_PRICE"
  | "BUYER"
  | "PURCHASE_PRICE"
  | "SALE_PRICE"
  | "SALE_AMOUNT"
  | "FEE"
  | "LOT_NO"
  | "BOX_NO"
  | "KINTONE_TITLE"
  | "GEMINI_TITLE"
  | "TITLE_AUTO"
  | "SOLD_OUT_FLAG"
  | "TKB_FLAG"
  | "BROKEN_FLAG"
  | "COPY_FLAG"
  | "PURCHASE_PRICE_TAX_INCL"
  | "SALE_AMOUNT_TAX_INCL"
  | "FEE_TAX_INCL"
  | "GROSS_PROFIT";

export interface ColumnDef {
  header: string;
  field: ColumnFieldType;
  fixedValue?: string;
  width?: number;
}

export type FormatType = "internal" | "submission" | "sales_import";

export interface FormatTemplate {
  columns: ColumnDef[];
  /** 元になったテンプレートExcelのファイル名 (参考表示用) */
  sourceFile?: string;
  /** ユーザーが設定する名称 (例: "コメ兵 月次売上") */
  name?: string;
}

export interface MarketFormat {
  /** ① 社内用 */
  internal?: FormatTemplate;
  /** ② あご表 (提出用) */
  submission?: FormatTemplate;
  /** ③ 売上取込 (Excelから売り金額・手数料を読込む際の列定義) */
  salesImport?: FormatTemplate;
  /** 旧形式 (互換性のため) */
  columns?: ColumnDef[];
}

export interface AppSettings {
  market?: string;
  buyerMap?: Record<string, string>;
  marketFormats?: Record<string, MarketFormat>;
  /** 税率 (%) — 例: 10 */
  taxRate?: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  market: "",
  buyerMap: {},
  marketFormats: {},
  taxRate: 10,
};

/**
 * GET /api/settings - 全設定を取得
 */
export async function GET() {
  const { data, error } = await supabase
    .from("app_settings")
    .select("data")
    .eq("id", 1)
    .single();

  if (error) {
    // 行がない場合は空設定を返す
    if (error.code === "PGRST116") {
      return NextResponse.json({ settings: DEFAULT_SETTINGS });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...(data?.data || {}) };
  return NextResponse.json({ settings });
}

/**
 * PATCH /api/settings - 設定を更新
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();

  // マージ用に既存値を取得
  const { data: existing } = await supabase
    .from("app_settings")
    .select("data")
    .eq("id", 1)
    .single();

  const mergedData = { ...DEFAULT_SETTINGS, ...(existing?.data || {}), ...body };

  // upsert (id=1で固定)
  const { error } = await supabase
    .from("app_settings")
    .upsert({ id: 1, data: mergedData });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: mergedData });
}

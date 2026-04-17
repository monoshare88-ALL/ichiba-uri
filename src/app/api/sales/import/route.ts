import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import type { AppSettings, ColumnDef, ColumnFieldType } from "@/app/api/settings/route";
import { mapHeaderToField } from "@/lib/headerMapping";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/import
 *
 * multipart/form-data:
 *   file: xlsx/xls
 *   market: 市場名 (省略時は現在設定中の市場を使用)
 *
 * 動作:
 *  1. 設定から marketFormats[market].salesImport の列定義を取得 (なければヒューリスティック)
 *  2. アップロードされたExcelのヘッダー行を検出
 *  3. 列定義に基づき LISTING_NUMBER / ITEM_NUMBER / SALE_AMOUNT / FEE の列index を特定
 *  4. 各データ行から値を抽出して返す
 *
 * レスポンス:
 *  { results: [{listingNumber, itemNumber, saleAmount, fee}], totalRows, matchedColumns, mode }
 *    mode: "format" | "heuristic"
 */

interface ExtractedRow {
  listingNumber: string;
  itemNumber: string;
  saleAmount: string;
  fee: string;
}

const cellStr = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  return String(v).trim();
};

type TargetField = "LISTING_NUMBER" | "ITEM_NUMBER" | "SALE_AMOUNT" | "FEE";
const TARGET_FIELDS: TargetField[] = ["LISTING_NUMBER", "ITEM_NUMBER", "SALE_AMOUNT", "FEE"];

function isTargetField(f: ColumnFieldType): f is TargetField {
  return TARGET_FIELDS.includes(f as TargetField);
}

/**
 * 保存された列定義を使って、Excelヘッダー行から列index を特定する
 * header が完全一致する列を優先、見つからなければ部分一致
 */
function buildColIndexFromFormat(
  headerRow: unknown[],
  columns: ColumnDef[]
): Partial<Record<TargetField, number>> {
  const map: Partial<Record<TargetField, number>> = {};
  const headerTexts = headerRow.map(c => cellStr(c));

  for (const col of columns) {
    if (!isTargetField(col.field)) continue;
    if (map[col.field] !== undefined) continue;

    // 完全一致を優先
    let idx = headerTexts.findIndex(h => h === col.header);
    // 部分一致
    if (idx < 0 && col.header) {
      idx = headerTexts.findIndex(h => h && (h.includes(col.header) || col.header.includes(h)));
    }
    if (idx >= 0) map[col.field] = idx;
  }

  return map;
}

/**
 * ヒューリスティック: headerMapping.ts を使って列index を推定
 */
function buildColIndexHeuristic(
  headerRow: unknown[]
): Partial<Record<TargetField, number>> {
  const map: Partial<Record<TargetField, number>> = {};
  headerRow.forEach((cell, idx) => {
    const text = cellStr(cell);
    if (!text) return;
    const field = mapHeaderToField(text);
    if (isTargetField(field) && map[field] === undefined) {
      map[field] = idx;
    }
  });
  return map;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const marketInput = String(formData.get("market") || "").trim();

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    // 設定取得
    const settingsRes = await supabase
      .from("app_settings")
      .select("data")
      .eq("id", 1)
      .single();

    const settings: AppSettings = (settingsRes.data?.data as AppSettings) || {};
    const market = marketInput || settings.market || "";
    const savedFormat =
      market && settings.marketFormats
        ? settings.marketFormats[market]?.salesImport
        : undefined;

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });

    // 全シートを走査、ヘッダー行(5行以内)を検出したら先頭シートを採用
    let bestSheetName = wb.SheetNames[0];
    let bestData: unknown[][] | null = null;
    let bestHeaderIdx = -1;
    let bestColMap: Partial<Record<TargetField, number>> = {};
    let mode: "format" | "heuristic" = savedFormat && savedFormat.columns.length > 0 ? "format" : "heuristic";

    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      if (data.length < 2) continue;

      for (let i = 0; i < Math.min(8, data.length); i++) {
        const row = data[i];
        const nonEmpty = row.filter(c => cellStr(c).length > 0).length;
        if (nonEmpty < 2) continue;

        let colMap: Partial<Record<TargetField, number>> = {};
        if (savedFormat && savedFormat.columns.length > 0) {
          colMap = buildColIndexFromFormat(row, savedFormat.columns);
        }
        // 設定で見つからない or 不完全なら、ヒューリスティックで補完
        const heuristicMap = buildColIndexHeuristic(row);
        for (const f of TARGET_FIELDS) {
          if (colMap[f] === undefined && heuristicMap[f] !== undefined) {
            colMap[f] = heuristicMap[f];
          }
        }

        // LISTING_NUMBER か ITEM_NUMBER のいずれか、かつ SALE_AMOUNT か FEE のいずれかがあれば採用
        const hasKey = colMap.LISTING_NUMBER !== undefined || colMap.ITEM_NUMBER !== undefined;
        const hasValue = colMap.SALE_AMOUNT !== undefined || colMap.FEE !== undefined;
        if (hasKey && hasValue) {
          bestSheetName = sn;
          bestData = data;
          bestHeaderIdx = i;
          bestColMap = colMap;
          break;
        }
      }
      if (bestData) break;
    }

    if (!bestData || bestHeaderIdx < 0) {
      return NextResponse.json(
        {
          error: "対象列 (商品番号/出品番号 + 売り金額/手数料) を含むヘッダー行が見つかりませんでした",
          sheetNames: wb.SheetNames,
        },
        { status: 400 }
      );
    }

    // データ行を抽出
    const results: ExtractedRow[] = [];
    for (let i = bestHeaderIdx + 1; i < bestData.length; i++) {
      const row = bestData[i];
      if (!row || row.every(c => cellStr(c) === "")) continue;

      const get = (f: TargetField) => {
        const idx = bestColMap[f];
        return idx !== undefined ? cellStr(row[idx]) : "";
      };

      const listingNumber = get("LISTING_NUMBER");
      const itemNumber = get("ITEM_NUMBER");
      const saleAmount = get("SALE_AMOUNT");
      const fee = get("FEE");

      // キーも値も空の行はスキップ
      if (!listingNumber && !itemNumber) continue;
      if (!saleAmount && !fee) continue;

      results.push({ listingNumber, itemNumber, saleAmount, fee });
    }

    return NextResponse.json({
      success: true,
      mode,
      market,
      formatName: savedFormat?.name || null,
      sheetName: bestSheetName,
      headerRow: bestHeaderIdx + 1,
      matchedColumns: bestColMap,
      totalRows: results.length,
      results,
    });
  } catch (error) {
    console.error("Sales import error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import type { AppSettings, ColumnFieldType } from "@/app/api/settings/route";
import { mapHeaderToField } from "@/lib/headerMapping";
import { getMarketProfile, type SalesTargetField } from "@/lib/marketProfiles";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/import
 *
 * multipart/form-data:
 *   file: xlsx/xls/csv
 *   market: 市場名 (省略時は現在設定中の市場を使用)
 *
 * 動作:
 *  1. 市場プロファイルから売上取込設定を取得 (なければヒューリスティック)
 *  2. ファイルのヘッダー行を検出
 *  3. プロファイルの headerMap に基づき列を特定
 *  4. セリ結果フィルタがあれば適用
 *  5. 各データ行から値を抽出して返す
 */

interface ExtractedRow {
  listingNumber: string;
  itemNumber: string;
  saleAmount: string;
  fee: string;
  campaign: string;
}

const cellStr = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  return String(v).trim();
};

const TARGET_FIELDS: SalesTargetField[] = ["LISTING_NUMBER", "ITEM_NUMBER", "SALE_AMOUNT", "FEE", "CAMPAIGN"];

function isTargetField(f: ColumnFieldType | string): f is SalesTargetField {
  return TARGET_FIELDS.includes(f as SalesTargetField);
}

/**
 * プロファイルの headerMap を使ってヘッダー行から列index を特定
 */
function buildColIndexFromProfile(
  headerRow: unknown[],
  headerMap: Record<string, SalesTargetField>
): Partial<Record<SalesTargetField, number>> {
  const map: Partial<Record<SalesTargetField, number>> = {};
  headerRow.forEach((cell, idx) => {
    const text = cellStr(cell);
    if (!text) return;
    const field = headerMap[text];
    if (field && map[field] === undefined) {
      map[field] = idx;
    }
  });
  return map;
}

/**
 * ヒューリスティック: headerMapping.ts を使って列index を推定
 */
function buildColIndexHeuristic(
  headerRow: unknown[]
): Partial<Record<SalesTargetField, number>> {
  const map: Partial<Record<SalesTargetField, number>> = {};
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
      .from("app_settings").select("data").eq("id", 1).single();
    const settings: AppSettings = (settingsRes.data?.data as AppSettings) || {};
    const market = marketInput || settings.market || "";

    // 市場プロファイルを取得
    const profile = market ? getMarketProfile(market) : undefined;
    const salesConfig = profile?.salesImport;
    const skipPatterns = salesConfig?.skipSheetPatterns || [];
    const mode: "profile" | "heuristic" = salesConfig ? "profile" : "heuristic";

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });

    let bestSheetName = wb.SheetNames[0];
    let bestData: unknown[][] | null = null;
    let bestHeaderIdx = -1;
    let bestColMap: Partial<Record<SalesTargetField, number>> = {};
    let resultFilterIdx = -1; // セリ結果列のindex

    for (const sn of wb.SheetNames) {
      if (skipPatterns.some(p => sn.includes(p))) continue;

      const ws = wb.Sheets[sn];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      if (data.length < 2) continue;

      for (let i = 0; i < Math.min(8, data.length); i++) {
        const row = data[i];
        const nonEmpty = row.filter(c => cellStr(c).length > 0).length;
        if (nonEmpty < 2) continue;

        // プロファイルの headerMap を使って列を特定
        let colMap: Partial<Record<SalesTargetField, number>> = {};
        if (salesConfig?.headerMap) {
          colMap = buildColIndexFromProfile(row, salesConfig.headerMap);
        }
        // 不足分をヒューリスティックで補完
        const heuristicMap = buildColIndexHeuristic(row);
        for (const f of TARGET_FIELDS) {
          if (colMap[f] === undefined && heuristicMap[f] !== undefined) {
            colMap[f] = heuristicMap[f];
          }
        }

        const hasKey = colMap.LISTING_NUMBER !== undefined || colMap.ITEM_NUMBER !== undefined;
        const hasValue = colMap.SALE_AMOUNT !== undefined || colMap.FEE !== undefined;
        if (hasKey && hasValue) {
          bestSheetName = sn;
          bestData = data;
          bestHeaderIdx = i;
          bestColMap = colMap;

          // セリ結果フィルタ列を検出
          if (salesConfig?.resultFilter) {
            const filterHeader = salesConfig.resultFilter.header;
            const filterIdx = row.findIndex(c => cellStr(c) === filterHeader);
            if (filterIdx >= 0) resultFilterIdx = filterIdx;
          }
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
    let filteredRows = 0;
    for (let i = bestHeaderIdx + 1; i < bestData.length; i++) {
      const row = bestData[i];
      if (!row || row.every(c => cellStr(c) === "")) continue;

      // セリ結果フィルタ
      if (resultFilterIdx >= 0 && salesConfig?.resultFilter) {
        const resultVal = cellStr(row[resultFilterIdx]);
        if (resultVal !== salesConfig.resultFilter.value) {
          filteredRows++;
          continue;
        }
      }

      const get = (f: SalesTargetField) => {
        const idx = bestColMap[f];
        return idx !== undefined ? cellStr(row[idx]) : "";
      };

      const listingNumber = get("LISTING_NUMBER");
      const itemNumber = get("ITEM_NUMBER");
      const saleAmount = get("SALE_AMOUNT");
      const fee = get("FEE");
      const campaign = get("CAMPAIGN");

      if (!listingNumber && !itemNumber) continue;
      if (!saleAmount && !fee) continue;

      results.push({ listingNumber, itemNumber, saleAmount, fee, campaign });
    }

    return NextResponse.json({
      success: true,
      mode,
      market,
      profileName: profile?.name || null,
      sheetName: bestSheetName,
      headerRow: bestHeaderIdx + 1,
      matchedColumns: bestColMap,
      totalRows: results.length,
      filteredRows,
      results,
    });
  } catch (error) {
    console.error("Sales import error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

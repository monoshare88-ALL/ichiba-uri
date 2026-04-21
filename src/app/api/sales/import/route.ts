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

/**
 * PDF委託販売精算書パーサー（市場連盟 TABA 用）
 *
 * unpdf (pdfjs-dist wrapper) でテキスト抽出し、正規表現でパース
 * 各売上ページ: 頁番号(3桁) + 枝番1-10の商品行 (金額+枝番+品名+枝番+数量)
 * 通番 = (頁 - 先頭頁) × 10 + 枝番
 */
async function parseTabaPdf(buffer: Buffer): Promise<{
  results: ExtractedRow[];
  totalPages: number;
  salesPages: number;
}> {
  const { extractText } = await import("unpdf");
  const data = new Uint8Array(buffer);
  const extracted = await extractText(data, { mergePages: false });

  const results: ExtractedRow[] = [];
  let salesPages = 0;

  const pages: string[] = extracted.text || [];
  for (const pageText of pages) {
    if (!pageText.includes("委託販売精算書")) continue;
    salesPages++;

    // 頁番号を取得 (独立行の3桁数字)
    let pageNum = 0;
    const pageNumMatch = pageText.match(/\n(\d{3})\n/);
    if (pageNumMatch) pageNum = parseInt(pageNumMatch[1], 10);

    // データ行パターン: "金額+枝番 品名+枝番 数量"
    // 例: "388,0001 ﾊﾞｯｸﾞ ｼｬﾈﾙ ｺｺﾊﾝﾄﾞﾙﾐﾆ1 1"
    // 正規表現: ([\d,]+)(\d{1,2}) (.+?)(\d{1,2}) 1$
    const lines = pageText.split("\n");
    for (const line of lines) {
      // パターン: 金額(カンマ付き数字) + 枝番 + スペース + 品名 + 枝番 + スペース + 数量(1)
      // 例: "388,0001 ﾊﾞｯｸﾞ ｼｬﾈﾙ ｺｺﾊﾝﾄﾞﾙﾐﾆ1 1"
      // 金額: \d{1,3}(,\d{3})* + 末尾0で終わる
      const m = line.match(/^(\d{1,3}(?:,\d{3})*)(\d{1,2})\s+(.+?)(\d{1,2})\s+1$/);
      if (!m) continue;

      const amountStr = m[1].replace(/,/g, "");
      const branch1 = parseInt(m[2], 10);
      const branch2 = parseInt(m[4], 10);
      const amount = parseInt(amountStr, 10);

      // 枝番の整合性チェック
      if (branch1 !== branch2) continue;
      if (branch1 < 1 || branch1 > 20) continue;
      if (isNaN(amount) || amount < 100) continue;

      // 品名に合計系キーワードがあればスキップ
      const name = m[3].trim();
      if (name.includes("頁") || name.includes("合計")) continue;

      results.push({
        listingNumber: `${pageNum}-${branch1}`,
        itemNumber: "",
        saleAmount: String(amount),
        fee: "",
        campaign: "",
      });
    }
  }

  // 通番を計算: (頁 - 先頭頁) * 10 + 枝番
  if (results.length > 0) {
    const pageNums = results.map((r) => {
      const [pg] = r.listingNumber.split("-");
      return parseInt(pg, 10);
    }).filter((n) => !isNaN(n));
    const firstPage = Math.min(...pageNums);

    for (const r of results) {
      const [pgStr, brStr] = r.listingNumber.split("-");
      const pg = parseInt(pgStr, 10);
      const br = parseInt(brStr, 10);
      if (!isNaN(pg) && !isNaN(br)) {
        r.listingNumber = String((pg - firstPage) * 10 + br);
      }
    }
  }

  return { results, totalPages: extracted.totalPages || 0, salesPages };
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
    const fileName = (file as File).name || "";

    // PDF の場合: 市場連盟 委託販売精算書をパース
    if (fileName.toLowerCase().endsWith(".pdf")) {
      const { results, totalPages, salesPages } = await parseTabaPdf(buffer);
      return NextResponse.json({
        success: true,
        mode: "pdf",
        market,
        profileName: profile?.name || "市場連盟",
        sheetName: "委託販売精算書",
        headerRow: 0,
        matchedColumns: {},
        totalRows: results.length,
        filteredRows: 0,
        results,
        pdfInfo: { totalPages, salesPages },
      });
    }

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

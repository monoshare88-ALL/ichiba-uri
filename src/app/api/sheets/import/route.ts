import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { getMarketProfile } from "@/lib/marketProfiles";
import type { AppSettings } from "@/app/api/settings/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/sheets/import
 * 過去のExcelファイルから新規シートを作成
 *
 * multipart/form-data:
 *   file: xlsxファイル
 *   sheetName: (任意) 新規シート名 (省略時はファイル名)
 *   market:    (任意) 市場名 (省略時は設定値を使用)
 */

/** デフォルトのヘッダーエイリアス (プロファイル未設定時のフォールバック) */
const DEFAULT_HEADER_ALIASES: Record<string, string[]> = {
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
};

function buildColumnIndexMap(
  headers: unknown[],
  aliases: Record<string, string[]>
): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const text = String(h || "").trim();
    if (!text) return;
    for (const [field, aliasList] of Object.entries(aliases)) {
      if (map[field] !== undefined) continue;
      if (aliasList.some(a => text === a || text.includes(a))) {
        map[field] = i;
      }
    }
  });
  return map;
}

const cellStr = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  return String(v).trim();
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const sheetNameInput = formData.get("sheetName");
    const marketInput = String(formData.get("market") || "").trim();

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    // 市場名を決定 (リクエスト → 設定値)
    let market = marketInput;
    if (!market) {
      const { data: settingsRow } = await supabase
        .from("app_settings").select("data").eq("id", 1).single();
      const settings = (settingsRow?.data as AppSettings) || {};
      market = settings.market || "";
    }

    // 市場プロファイルを取得
    const profile = market ? getMarketProfile(market) : undefined;
    const aliases = profile?.import.headerAliases || DEFAULT_HEADER_ALIASES;
    const skipPatterns = profile?.import.skipSheetPatterns || [];

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });

    let bestSheetName = wb.SheetNames[0];
    let bestData: unknown[][] | null = null;
    let bestColMap: Record<string, number> | null = null;
    let totalRawRows = 0;
    let skippedRows = 0;
    let bestRowCount = 0;

    // プロファイルのスキップパターンに該当するシートを除外し、最大行数のシートを採用
    for (const sn of wb.SheetNames) {
      if (skipPatterns.some(p => sn.includes(p))) continue;

      const ws = wb.Sheets[sn];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      if (data.length < 2) continue;

      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(8, data.length); i++) {
        const map = buildColumnIndexMap(data[i], aliases);
        if (map.item_number !== undefined || map.listing_number !== undefined) {
          headerRowIdx = i;
          break;
        }
      }
      if (headerRowIdx < 0) continue;

      const sliced = data.slice(headerRowIdx);
      if (sliced.length > bestRowCount) {
        bestSheetName = sn;
        bestData = sliced;
        bestColMap = buildColumnIndexMap(data[headerRowIdx], aliases);
        bestRowCount = sliced.length;
      }
    }

    // スキップパターンに全シートが該当した場合はフォールバック
    if (!bestData) {
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
        if (data.length < 2) continue;
        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(8, data.length); i++) {
          const map = buildColumnIndexMap(data[i], aliases);
          if (map.item_number !== undefined || map.listing_number !== undefined) {
            headerRowIdx = i;
            break;
          }
        }
        if (headerRowIdx < 0) continue;
        bestSheetName = sn;
        bestData = data.slice(headerRowIdx);
        bestColMap = buildColumnIndexMap(data[headerRowIdx], aliases);
        break;
      }
    }

    if (!bestData || !bestColMap) {
      return NextResponse.json(
        {
          error: "識別列 (商品番号 または 出品番号) を含むシートが見つかりませんでした",
          sheetNames: wb.SheetNames,
        },
        { status: 400 }
      );
    }

    // データ行を構築 (0行目はヘッダー)
    const dataRows: Record<string, unknown>[] = [];
    for (let i = 1; i < bestData.length; i++) {
      const row = bestData[i];
      if (!row || row.every(c => c === "" || c === null || c === undefined)) {
        continue;
      }
      totalRawRows++;

      const get = (key: string) => {
        const idx = bestColMap![key];
        return idx !== undefined ? cellStr(row[idx]) : "";
      };

      const itemNumber = get("item_number");
      const listingNumber = get("listing_number");
      const brand = get("brand");
      const itemName = get("item_name");

      if (!itemNumber && !listingNumber && !brand && !itemName) {
        skippedRows++;
        continue;
      }

      dataRows.push({
        item_number: itemNumber || null,
        listing_number: listingNumber || null,
        brand: brand || null,
        item_name: itemName || null,
        accessories: get("accessories") || null,
        condition: get("condition") || null,
        reserve_price: get("reserve_price") || null,
        buyer: get("buyer") || null,
        purchase_price: get("purchase_price") || null,
        sale_price: get("sale_price") || null,
        sale_amount: get("sale_amount") || null,
        fee: get("fee") || null,
        lot_no: get("lot_no") || null,
        box_no: get("box_no") || null,
        sold_out: false,
        tkb: false,
        broken: false,
        copy: false,
      });
    }

    if (dataRows.length === 0) {
      return NextResponse.json(
        {
          error: "有効なデータ行がありませんでした",
          sheetName: bestSheetName,
          totalRawRows,
          skippedRows,
        },
        { status: 400 }
      );
    }

    const fileName = (file as File).name || "import.xlsx";
    const baseName = String(sheetNameInput || fileName.replace(/\.xlsx?$/i, ""));

    const sheetRes = await supabase
      .from("ago_sheets")
      .insert({ name: `${baseName} (取込)` })
      .select()
      .single();

    if (sheetRes.error) {
      return NextResponse.json({ error: sheetRes.error.message }, { status: 500 });
    }

    const newSheetId = sheetRes.data.id;
    const toInsert = dataRows.map((row, i) => ({ ...row, sheet_id: newSheetId, position: i }));

    const insRes = await supabase.from("ago_rows").insert(toInsert);
    if (insRes.error) {
      await supabase.from("ago_sheets").delete().eq("id", newSheetId);
      return NextResponse.json({ error: insRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      sheet: sheetRes.data,
      importedRows: dataRows.length,
      totalRawRows,
      skippedRows,
      sourceSheet: bestSheetName,
      detectedColumns: Object.keys(bestColMap),
      market: market || undefined,
      profile: profile?.name || undefined,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

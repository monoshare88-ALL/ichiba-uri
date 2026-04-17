import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/sheets/import
 * 過去のExcelファイルから新規シートを作成
 *
 * multipart/form-data:
 *   file: xlsxファイル
 *   sheetName: (任意) 新規シート名 (省略時はファイル名)
 */

const HEADER_ALIASES: Record<string, string[]> = {
  item_number:    ["商品番号", "SKU", "管理番号", "item_number", "商品No"],
  listing_number: ["出品番号", "出品No", "出品ID", "listing_number"],
  brand:          ["ブランド", "brand", "メーカー"],
  item_name:      ["バッグ名", "ブランド名", "商品名", "品名", "item_name"],
  accessories:    ["付属品", "accessories"],
  condition:      ["状態", "condition", "コンディション"],
  reserve_price:  ["指値", "指値(円)", "リザーブ", "reserve_price"],
  buyer:          ["バイヤー", "バイヤー名", "buyer", "担当者"],
  purchase_price: ["仕入価格", "買値", "仕入れ", "purchase_price"],
  sale_price:     ["販売価格", "売値", "sale_price"],
  sale_amount:    ["売り金額", "売上", "成立金額", "落札価格", "sale_amount"],
  fee:            ["手数料", "システム手数料", "落札手数料", "fee"],
  lot_no:         ["ロットNo", "ロットNo.", "lot_no", "ロット"],
  box_no:         ["箱番", "箱番、枝番", "箱番号", "box_no"],
};

function buildColumnIndexMap(headers: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const text = String(h || "").trim();
    if (!text) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] !== undefined) continue;
      if (aliases.some(a => text === a || text.includes(a))) {
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

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });

    // 全シートを走査してヘッダー行を検出
    // item_number または listing_number のどちらかの列を含む行をヘッダーとみなす
    let bestSheetName = wb.SheetNames[0];
    let bestData: unknown[][] | null = null;
    let bestColMap: Record<string, number> | null = null;
    let totalRawRows = 0;
    let skippedRows = 0;

    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      if (data.length < 2) continue;

      // ヘッダー行を探す (最初の8行から識別列 or 主要列が含まれる行)
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(8, data.length); i++) {
        const map = buildColumnIndexMap(data[i]);
        // 識別列 (item_number/listing_number) のいずれかがあれば採用
        if (map.item_number !== undefined || map.listing_number !== undefined) {
          headerRowIdx = i;
          break;
        }
      }
      if (headerRowIdx < 0) continue;

      const colMap = buildColumnIndexMap(data[headerRowIdx]);
      bestSheetName = sn;
      bestData = data.slice(headerRowIdx);
      bestColMap = colMap;
      break;
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
        continue; // 完全空行はスキップ (カウントしない)
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

      // 識別子が無くてもブランドか商品名があれば取込む (柔軟に)
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

    // ファイル名 (Blob.name は File 派生の時のみ)
    const fileName = (file as File).name || "import.xlsx";
    const baseName = String(sheetNameInput || fileName.replace(/\.xlsx?$/i, ""));

    // 新規シート作成
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
      // 失敗時は作成したシートを削除
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
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

export interface AgoItem {
  rowIndex: number;
  sourceFile: string;
  sourceSheet: string;
  boxNo: string;
  lotNo: string;
  selfEntry: string;
  brand: string;
  itemName: string;
  accessories: string;
  condition: string;
  reservePrice: number | null;
  buyer: string;
  purchasePrice: number | null;
  purchasePriceTax: number | null;
  itemNumber: string;
  buyer2: string;
}

/**
 * ヘッダー行を解析し、列インデックスのマップを返す
 */
function buildColumnMap(headers: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  const aliases: Record<string, string[]> = {
    boxNo: ["箱番", "箱番、枝番", "箱番枝番"],
    lotNo: ["ロットNo", "ロット", "lot"],
    selfEntry: ["自社出品", "自社"],
    brand: ["ブランド"],
    itemName: ["ブランド名", "商品名", "品名"],
    accessories: ["付属品"],
    condition: ["状態"],
    reservePrice: ["指値(円)", "指値"],
    buyer: ["バイヤー"],
    purchasePrice: ["買値"],
    purchasePriceTax: ["買値税込み", "買値税込"],
    itemNumber: ["商品番号", "SKU", "管理番号"],
    buyer2: ["バイヤー２", "バイヤー2"],
  };

  headers.forEach((h, i) => {
    const text = String(h || "").trim();
    for (const [key, names] of Object.entries(aliases)) {
      if (names.some(n => text === n || text.includes(n))) {
        if (map[key] === undefined) map[key] = i;
      }
    }
  });
  return map;
}

function parseRow(row: unknown[], colMap: Record<string, number>, fileName: string, sheetName: string, rowIndex: number): AgoItem | null {
  const get = (key: string) => {
    const idx = colMap[key];
    return idx !== undefined ? row[idx] : "";
  };

  const itemNumber = String(get("itemNumber") || "").trim();
  if (!itemNumber || itemNumber === "0") return null;

  return {
    rowIndex,
    sourceFile: fileName,
    sourceSheet: sheetName,
    boxNo: String(get("boxNo") || ""),
    lotNo: String(get("lotNo") || ""),
    selfEntry: String(get("selfEntry") || ""),
    brand: String(get("brand") || ""),
    itemName: String(get("itemName") || ""),
    accessories: String(get("accessories") || ""),
    condition: String(get("condition") || ""),
    reservePrice: get("reservePrice") ? Number(get("reservePrice")) : null,
    buyer: String(get("buyer") || ""),
    purchasePrice: get("purchasePrice") ? Number(get("purchasePrice")) : null,
    purchasePriceTax: get("purchasePriceTax") ? Number(get("purchasePriceTax")) : null,
    itemNumber,
    buyer2: String(get("buyer2") || ""),
  };
}

/**
 * 全Excelファイルを走査して商品番号で検索
 */
function searchAcrossFiles(searchDir: string, itemNumber: string): AgoItem[] {
  const results: AgoItem[] = [];

  if (!fs.existsSync(searchDir)) return results;

  const files = fs.readdirSync(searchDir)
    .filter(f => f.endsWith(".xlsx") && !f.startsWith("~$"));

  for (const file of files) {
    try {
      const fullPath = path.join(searchDir, file);
      const buffer = fs.readFileSync(fullPath);
      const wb = XLSX.read(buffer, { type: "buffer" });

      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (rows.length < 2) continue;

        const headers = rows[0] as unknown[];
        const colMap = buildColumnMap(headers);
        if (colMap.itemNumber === undefined) continue;

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || (row as unknown[]).every(c => c === "")) continue;
          const item = parseRow(row, colMap, file, sheetName, i);
          if (item && item.itemNumber === itemNumber) {
            results.push(item);
          }
        }
      }
    } catch (e) {
      console.error(`Failed to read ${file}:`, e);
    }
  }

  return results;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const itemNumber = searchParams.get("itemNumber");
  const all = searchParams.get("all") === "1";

  try {
    const envPath = process.env.EXCEL_REF_PATH || "./data/komehyo_ref.xlsx";
    const primaryPath = path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
    const searchDir = process.env.EXCEL_SEARCH_DIR || path.dirname(primaryPath);

    if (!itemNumber && !all) {
      return NextResponse.json({ error: "itemNumber or all=1 required" }, { status: 400 });
    }

    if (itemNumber) {
      // 1. プライマリファイルをまず読む
      const results: AgoItem[] = [];

      if (fs.existsSync(primaryPath)) {
        const buffer = fs.readFileSync(primaryPath);
        const wb = XLSX.read(buffer, { type: "buffer" });
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          if (rows.length < 2) continue;
          const colMap = buildColumnMap(rows[0] as unknown[]);
          if (colMap.itemNumber === undefined) continue;
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || (row as unknown[]).every(c => c === "")) continue;
            const item = parseRow(row, colMap, path.basename(primaryPath), sheetName, i);
            if (item && item.itemNumber === itemNumber) results.push(item);
          }
        }
      }

      // 2. 見つからなければ全ファイル横断検索
      if (results.length === 0 && fs.existsSync(searchDir)) {
        const found = searchAcrossFiles(searchDir, itemNumber);
        results.push(...found);
      }

      return NextResponse.json({
        success: true,
        item: results[0] || null,
        allMatches: results,
        searched: { primaryPath, searchDir },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Excel read error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

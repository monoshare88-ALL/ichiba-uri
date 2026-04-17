import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { mapHeaderToField } from "@/lib/headerMapping";

export const dynamic = "force-dynamic";

/**
 * POST /api/format/parse
 * multipart/form-data:
 *   file: テンプレートExcelファイル
 *   sheetName: (任意) 対象シート名 (省略時は最初のシート)
 *
 * レスポンス:
 *   columns: [{ header, field, width? }] - 自動マッピング済み
 *   sheetName: 解析したシート名
 *   sheetNames: 全シート名一覧
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const requestedSheet = formData.get("sheetName");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });

    if (wb.SheetNames.length === 0) {
      return NextResponse.json({ error: "シートがありません" }, { status: 400 });
    }

    // シート選択 (指定があればそれを優先、なければ全シートからヘッダーらしい行を持つ最初のもの)
    let targetSheet = wb.SheetNames[0];
    if (requestedSheet && wb.SheetNames.includes(String(requestedSheet))) {
      targetSheet = String(requestedSheet);
    }

    const ws = wb.Sheets[targetSheet];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];

    if (data.length === 0) {
      return NextResponse.json({ error: "データが空です" }, { status: 400 });
    }

    // ヘッダー行を探す: 最初の5行でテキストセルが3つ以上ある最初の行
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i];
      const textCellCount = row.filter(c => String(c || "").trim().length > 0).length;
      if (textCellCount >= 3) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx < 0) headerRowIdx = 0;

    const headerRow = data[headerRowIdx];

    // 各セルを列定義に変換
    const columns = headerRow.map((cell, idx) => {
      const header = String(cell || "").trim();
      const field = mapHeaderToField(header);
      return {
        header: header || `列${idx + 1}`,
        field,
        width: Math.max(header.length * 2, 12),
      };
    });

    return NextResponse.json({
      success: true,
      sheetName: targetSheet,
      sheetNames: wb.SheetNames,
      headerRowIndex: headerRowIdx,
      columns,
      detectedCount: columns.filter(c => c.field !== "EMPTY").length,
    });
  } catch (error) {
    console.error("Format parse error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

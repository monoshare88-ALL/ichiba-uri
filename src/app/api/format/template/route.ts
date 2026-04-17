import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { mapHeaderToField } from "@/lib/headerMapping";

export const dynamic = "force-dynamic";

/**
 * POST /api/format/template
 * テンプレートExcelをアップロード→列構造を解析→ファイル本体をDBに保存
 *
 * multipart/form-data:
 *   file: xlsx
 *   market: 市場名
 *   formatType: "internal" | "submission"
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const market = String(formData.get("market") || "").trim();
    const formatType = String(formData.get("formatType") || "").trim();

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    if (!market) {
      return NextResponse.json({ error: "market required" }, { status: 400 });
    }
    if (
      formatType !== "internal" &&
      formatType !== "submission" &&
      formatType !== "sales_import"
    ) {
      return NextResponse.json(
        { error: "formatType must be 'internal', 'submission' or 'sales_import'" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 列ヘッダーを解析
    const wb = XLSX.read(buffer, { type: "buffer" });
    if (wb.SheetNames.length === 0) {
      return NextResponse.json({ error: "シートがありません" }, { status: 400 });
    }
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];

    // ヘッダー行検出
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i];
      const textCount = row.filter(c => String(c || "").trim().length > 0).length;
      if (textCount >= 3) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx < 0) headerRowIdx = 0;
    const headerRow = data[headerRowIdx] || [];

    const columns = headerRow.map((cell, idx) => {
      const header = String(cell || "").trim();
      return {
        header: header || `列${idx + 1}`,
        field: mapHeaderToField(header),
        width: Math.max(header.length * 2, 12),
      };
    });

    const fileName = (file as File).name || "template.xlsx";

    // sales_import はファイル本体を保存しない (列マッピングのみ使用)
    if (formatType !== "sales_import") {
      const dataBase64 = buffer.toString("base64");
      const { error: upsertErr } = await supabase
        .from("format_templates")
        .upsert(
          {
            market,
            format_type: formatType,
            filename: fileName,
            header_row: headerRowIdx + 1, // 1-based
            data_base64: dataBase64,
          },
          { onConflict: "market,format_type" }
        );

      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      sheetName,
      headerRow: headerRowIdx + 1,
      columns,
      detectedCount: columns.filter(c => c.field !== "EMPTY").length,
      fileSize: buffer.length,
      filename: fileName,
      stored: formatType !== "sales_import",
    });
  } catch (error) {
    console.error("Template upload error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * GET /api/format/template?market=X&formatType=Y
 * 保存済みテンプレートのメタ情報を返す (data_base64 は重いので metaOnly=1で除外可能)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get("market");
  const formatType = searchParams.get("formatType");
  const metaOnly = searchParams.get("metaOnly") === "1";

  if (!market || !formatType) {
    return NextResponse.json({ error: "market and formatType required" }, { status: 400 });
  }

  const cols = metaOnly
    ? "id, market, format_type, filename, header_row, updated_at"
    : "*";

  const { data, error } = await supabase
    .from("format_templates")
    .select(cols)
    .eq("market", market)
    .eq("format_type", formatType)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ template: null });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ template: data });
}

/**
 * DELETE /api/format/template?market=X&formatType=Y
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get("market");
  const formatType = searchParams.get("formatType");

  if (!market || !formatType) {
    return NextResponse.json({ error: "market and formatType required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("format_templates")
    .delete()
    .eq("market", market)
    .eq("format_type", formatType);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

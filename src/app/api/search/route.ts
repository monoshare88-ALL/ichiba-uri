import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?itemNumber=XXX
 * 全あご表シートを横断して商品番号で検索
 * シート情報も結合して返す
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const itemNumber = searchParams.get("itemNumber")?.trim();

  if (!itemNumber) {
    return NextResponse.json({ error: "itemNumber required" }, { status: 400 });
  }

  // ago_rows から完全一致で検索 (シート情報をjoin)
  const { data, error } = await supabase
    .from("ago_rows")
    .select(`
      *,
      ago_sheets ( id, name, updated_at )
    `)
    .eq("item_number", itemNumber)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    count: (data || []).length,
    results: data || [],
  });
}

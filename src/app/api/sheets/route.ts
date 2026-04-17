import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/sheets - 全シート一覧 (新しい順)
 */
export async function GET() {
  const { data, error } = await supabase
    .from("ago_sheets")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sheets: data || [] });
}

/**
 * POST /api/sheets - 新規シート作成
 * body: { name: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = (body.name || "あご表").toString().slice(0, 200);

  const { data, error } = await supabase
    .from("ago_sheets")
    .insert({ name })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sheet: data });
}

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const sheetRes = await supabase.from("ago_sheets").select("*").eq("id", id).single();
  if (sheetRes.error) {
    return NextResponse.json({ error: sheetRes.error.message }, { status: 404 });
  }

  const rowsRes = await supabase
    .from("ago_rows")
    .select("*")
    .eq("sheet_id", id)
    .order("position");
  if (rowsRes.error) {
    return NextResponse.json({ error: rowsRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ sheet: sheetRes.data, rows: rowsRes.data || [] });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();

  if (typeof body.name === "string") {
    const upd = await supabase.from("ago_sheets").update({ name: body.name }).eq("id", id);
    if (upd.error) {
      return NextResponse.json({ error: upd.error.message }, { status: 500 });
    }
  }

  if (Array.isArray(body.rows)) {
    const allowedFields = [
      "item_number", "listing_number", "brand", "item_name", "accessories", "condition",
      "reserve_price", "buyer", "purchase_price", "sale_price", "sale_amount", "fee",
      "campaign", "lot_no", "box_no", "image_url", "front_image_url",
      "kintone_title", "gemini_title", "sold_out", "tkb", "broken", "copy",
    ];

    // 既存行を取得して差分だけ更新
    const existingRes = await supabase
      .from("ago_rows")
      .select("id, position")
      .eq("sheet_id", id)
      .order("position");
    const existingRows = existingRes.data || [];

    const toUpsert: Record<string, unknown>[] = [];
    const reusableIds = existingRows.map(r => r.id);

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i] as Record<string, unknown>;
      const clean: Record<string, unknown> = { sheet_id: id, position: i };
      // 既存行のIDを再利用（UPDATE扱い）、足りなければ新規INSERT
      if (i < reusableIds.length) {
        clean.id = reusableIds[i];
      }
      for (const key of allowedFields) {
        if (key in row) clean[key] = row[key];
      }
      toUpsert.push(clean);
    }

    // 余分な既存行を削除（行数が減った場合）
    if (existingRows.length > body.rows.length) {
      const idsToDelete = reusableIds.slice(body.rows.length);
      const del = await supabase.from("ago_rows").delete().in("id", idsToDelete);
      if (del.error) {
        return NextResponse.json({ error: del.error.message }, { status: 500 });
      }
    }

    // UPSERT: 既存行はUPDATE、新規行はINSERT
    if (toUpsert.length > 0) {
      const ups = await supabase.from("ago_rows").upsert(toUpsert);
      if (ups.error) {
        return NextResponse.json({ error: ups.error.message }, { status: 500 });
      }
    }

    await supabase
      .from("ago_sheets")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await supabase.from("ago_sheets").delete().eq("id", id);
  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

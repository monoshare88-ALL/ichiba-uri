import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface GeminiResult {
  category?: string;
  brand?: string;
  name?: string;
  title?: string;
  material?: string;
  hardware?: string;
  condition?: string;
  confidence?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { imageUrl, itemNumber, force } = await request.json();

    if (!imageUrl) {
      return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
    }

    // ===================================
    // ① キャッシュチェック (itemNumberがある場合)
    // ===================================
    if (itemNumber && !force) {
      const { data: cached } = await supabase
        .from("gemini_cache")
        .select("*")
        .eq("item_number", String(itemNumber))
        .single();

      if (cached) {
        return NextResponse.json({
          success: true,
          cached: true,
          data: {
            category: cached.category,
            brand: cached.brand,
            name: cached.name,
            title: cached.title,
            material: cached.material,
            hardware: cached.hardware,
            condition: cached.condition,
            confidence: cached.confidence,
          },
          rawText: cached.raw_text,
        });
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    // ===================================
    // ② 画像取得 → Gemini呼び出し
    // ===================================
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      return NextResponse.json({ error: "Failed to fetch image", imageUrl }, { status: 400 });
    }
    const arrayBuffer = await imageRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = imageRes.headers.get("content-type") || "image/jpeg";

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `この画像はブランド品です。バッグ、衣類（ワンピース・ジャケット・コート等）、靴、財布、アクセサリー、時計、ジュエリー、ベルト、スカーフ等、いずれの可能性もあります。以下の情報を日本語で抽出してください。

1. カテゴリ（例: バッグ、ワンピース、ジャケット、コート、靴、財布、ベルト、スカーフ、時計、ネックレス など）
2. ブランド名（例: CHANEL, HERMES, Louis Vuitton, Dior, Gucci, Prada など。ロゴや特徴から推定）
3. 商品名・モデル名（例: マトラッセ, バーキン35, ツイードジャケット, ロゴTシャツ, デニム, ローファー など。型番が読み取れれば含める）
4. 素材・カラー（分かる場合）
5. 金具/装飾の色（あれば）
6. 状態の所感（A/AB/B+/B など、外見から判断できる場合）

重要:
- バッグ以外でも必ずカテゴリ・ブランド・商品名を返してください
- ブランドが特定できない場合のみ "不明" としてください
- titleは「ブランド名 + 商品名 + カテゴリ」のような英語タイトル形式で出力してください（eBay等の出品タイトルとして使えるもの）

レスポンスはJSON形式のみで返してください:
{
  "category": "カテゴリ",
  "brand": "ブランド名",
  "name": "商品名・モデル名",
  "title": "英語タイトル（出品用）",
  "material": "素材・カラー",
  "hardware": "金具/装飾色",
  "condition": "状態",
  "confidence": "high/medium/low"
}`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64, mimeType } },
    ]);

    const text = result.response.text();

    let parsed: GeminiResult = { title: text };
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]) as GeminiResult;
      } catch {}
    }

    // ===================================
    // ③ キャッシュ保存
    // ===================================
    if (itemNumber) {
      await supabase.from("gemini_cache").upsert({
        item_number: String(itemNumber),
        image_url: imageUrl,
        category: parsed.category || null,
        brand: parsed.brand || null,
        name: parsed.name || null,
        title: parsed.title || null,
        material: parsed.material || null,
        hardware: parsed.hardware || null,
        condition: parsed.condition || null,
        confidence: parsed.confidence || null,
        raw_text: text,
      });
    }

    return NextResponse.json({ success: true, cached: false, data: parsed, rawText: text });
  } catch (error) {
    console.error("Analyze error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

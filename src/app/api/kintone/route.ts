import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Kintone monoshare アプリ #171 (商品)
 * 主要フィールド:
 *   商品番号 (NUMBER)        商品SKU
 *   ブランド (SINGLE_LINE)
 *   メインブランド
 *   バッグ名 / バッグ名フリー
 *   タイトル / タイトル用 / タイトルフリー
 *   文字列__1行_ (日本語タイトル)
 *   文字列__1行__0 (英語タイトル)
 *   バイヤーコード (CC, UU 等)
 *   文字列__1行__5 (バイヤー名)
 *   文字列__1行__7 (バイヤーメモ)
 *   仕入価格 (NUMBER)
 *   販売価格 (NUMBER)
 *   Cataリザーブ (NUMBER)
 *   マックス金額 / 数値_0 (NUMBER)
 *   数値 (NUMBER)  欲しい金額
 *   ほしい金額 (SINGLE_LINE)
 *   ロット番号
 *   箱番 (社内) / 文字列__1行__10 (市場)
 *   付属品1 / 付属品2 / 付属品フリー / 付属品種類
 *   状態文言 / 状態その他 / 状態1〜10
 *   分類 (DROP_DOWN)
 *   日付 (DATE)
 *   市場
 *   画像商品番号
 */

interface KintoneRecord {
  [key: string]: { type: string; value: unknown };
}

const get = (rec: KintoneRecord, key: string): string => {
  const v = rec[key]?.value;
  if (v === null || v === undefined) return "";
  return String(v);
};

const formatRecord = (rec: KintoneRecord) => ({
  recordId: get(rec, "$id"),
  itemNumber: get(rec, "商品番号"),
  brand: get(rec, "ブランド") || get(rec, "メインブランド"),
  bagName: get(rec, "バッグ名") || get(rec, "バッグ名フリー"),
  title: get(rec, "タイトル") || get(rec, "タイトル用") || get(rec, "タイトルフリー"),
  titleJa: get(rec, "文字列__1行_"),
  titleEn: get(rec, "文字列__1行__0"),
  buyerCode: get(rec, "バイヤーコード"),
  buyerName: get(rec, "文字列__1行__5"),
  buyerMemo: get(rec, "文字列__1行__7"),
  purchasePrice: get(rec, "仕入価格"),
  salePrice: get(rec, "販売価格"),
  cataReserve: get(rec, "Cataリザーブ"),
  maxPrice: get(rec, "マックス金額") || get(rec, "数値_0"),
  desiredPrice: get(rec, "ほしい金額") || get(rec, "数値"),
  lotNo: get(rec, "ロット番号"),
  boxNoInternal: get(rec, "箱番"),
  boxNoMarket: get(rec, "文字列__1行__10"),
  accessories: [
    get(rec, "付属品1"),
    get(rec, "付属品2"),
    get(rec, "付属品フリー"),
  ].filter(Boolean).join(" / "),
  accessoryType: get(rec, "付属品種類"),
  conditionText: get(rec, "状態文言") || get(rec, "状態その他"),
  conditions: Array.from({ length: 10 }, (_, i) => get(rec, `状態${i + 1}`)).filter(Boolean),
  category: get(rec, "分類"),
  date: get(rec, "日付"),
  market: get(rec, "市場"),
  imageItemNumber: get(rec, "画像商品番号"),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const itemNumber = searchParams.get("itemNumber");
  const customQuery = searchParams.get("query");
  const includeRaw = searchParams.get("raw") === "1";

  const subdomain = process.env.KINTONE_SUBDOMAIN;
  const token = process.env.KINTONE_API_TOKEN_APP171;
  const appId = process.env.KINTONE_APP_ID || "171";

  if (!subdomain || !token) {
    return NextResponse.json({ error: "Kintone credentials not configured" }, { status: 500 });
  }

  try {
    let kintoneQuery = "";

    if (itemNumber) {
      // 商品番号は NUMBER型 → 引用符なし
      const num = String(itemNumber).trim();
      if (!/^\d+$/.test(num)) {
        return NextResponse.json({ error: "itemNumber must be numeric" }, { status: 400 });
      }
      kintoneQuery = `商品番号 = ${num}`;
    } else if (customQuery) {
      kintoneQuery = customQuery;
    } else {
      return NextResponse.json({ error: "itemNumber or query is required" }, { status: 400 });
    }

    const url = new URL(`https://${subdomain}.cybozu.com/k/v1/records.json`);
    url.searchParams.set("app", appId);
    url.searchParams.set("query", kintoneQuery);

    const res = await fetch(url, {
      headers: { "X-Cybozu-API-Token": token },
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Kintone API error: ${res.status}`, detail: errText, query: kintoneQuery },
        { status: res.status }
      );
    }

    const data = await res.json();
    const records: KintoneRecord[] = data.records || [];
    const formatted = records.map(formatRecord);

    return NextResponse.json({
      success: true,
      records: formatted,
      total: records.length,
      query: kintoneQuery,
      ...(includeRaw && { rawRecords: records }),
    });
  } catch (error) {
    console.error("Kintone error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

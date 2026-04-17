import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getS3FolderPrefix } from "@/lib/s3ImageUrl";

export const dynamic = "force-dynamic";

const S3_PUBLIC_BASE = "https://ebay-items.s3.ap-northeast-1.amazonaws.com";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "ap-northeast-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

/**
 * GET /api/images?itemNumber=2342061
 * 指定商品の実在する画像URL一覧を返す
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const itemNumber = searchParams.get("itemNumber");

  if (!itemNumber) {
    return NextResponse.json({ error: "itemNumber required" }, { status: 400 });
  }

  try {
    const prefix = getS3FolderPrefix(itemNumber);
    const bucket = process.env.S3_BUCKET || "ebay-items";

    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 100,
    });
    const res = await s3.send(cmd);

    // 当該商品番号で始まり、直後が数字1桁または "x" のもののみ抽出
    // 例: 2342061 → 23420610.jpg, 2342061x.jpg はOK
    //     23420611.jpg もOK だが 234206110.jpg は別商品とみなす
    const itemLen = itemNumber.length;
    const items = (res.Contents || [])
      .map(obj => obj.Key || "")
      .filter(key => {
        const filename = key.split("/").pop() || "";
        const stem = filename.replace(/\.jpg$/i, "");
        if (!stem.startsWith(itemNumber)) return false;
        const suffix = stem.slice(itemLen);
        // 写真suffix は1文字 (0-9 または x)
        return /^[0-9x]$/.test(suffix);
      })
      .sort((a, b) => {
        // x → 0 → 1 → 2 ... の順
        const ax = a.endsWith("x.jpg");
        const bx = b.endsWith("x.jpg");
        if (ax && !bx) return -1;
        if (bx && !ax) return 1;
        return a.localeCompare(b);
      });

    const urls = items.map(key => `${S3_PUBLIC_BASE}/${key}`);

    // x.jpg = 代表画像、0.jpg = 正面画像
    const mainImage = urls.find(u => u.endsWith("x.jpg")) || urls[0] || null;
    const frontImage = urls.find(u => u.endsWith(`${itemNumber}0.jpg`)) || null;

    return NextResponse.json({
      success: true,
      itemNumber,
      prefix,
      count: urls.length,
      urls,
      mainImage,
      frontImage,
    });
  } catch (error) {
    console.error("S3 list error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * 商品番号からS3画像のフォルダパスを取得する
 *
 * S3バケット: ebay-items
 * Base: https://ebay-items.s3.ap-northeast-1.amazonaws.com/Photo/
 *
 * 100万以上(7桁以上):
 *   2nd folder: 先頭1桁 + "00"
 *   3rd folder: 先頭2桁 + "0"
 *
 * 100万未満(6桁):
 *   2nd folder: 先頭1桁 + "0"
 *   3rd folderなし
 *
 * ファイル名規則: {商品番号}{写真番号}.jpg
 *   写真番号: 0-9 (個別写真) または x (代表画像)
 *   例) 商品3651105 → 36511050.jpg, 36511051.jpg, ..., 3651105x.jpg
 */

const S3_BASE = "https://ebay-items.s3.ap-northeast-1.amazonaws.com";

export function getS3FolderPrefix(itemNumber: string | number): string {
  const num = String(itemNumber).trim();

  if (parseInt(num) >= 1_000_000) {
    const folder2 = num[0] + "00";
    const folder3 = num.slice(0, 2) + "0";
    return `Photo/${folder2}/${folder3}/${num}`;
  } else {
    const folder2 = num[0] + "0";
    return `Photo/${folder2}/${num}`;
  }
}

/**
 * デフォルトの代表画像URL（写真0）
 * 互換性のため残すが、新コードは getS3PhotoUrls を使うべき
 */
export function getS3ImageUrl(itemNumber: string | number, photoIndex: string | number = "0"): string {
  const prefix = getS3FolderPrefix(itemNumber);
  return `${S3_BASE}/${prefix}${photoIndex}.jpg`;
}

/**
 * 商品の代表画像URL（xサフィックス）
 */
export function getS3MainImageUrl(itemNumber: string | number): string {
  return getS3ImageUrl(itemNumber, "x");
}

/**
 * 写真0〜9の候補URL一覧を返す
 */
export function getS3PhotoCandidates(itemNumber: string | number): string[] {
  const prefix = getS3FolderPrefix(itemNumber);
  const urls: string[] = [];
  // x (代表) を最優先
  urls.push(`${S3_BASE}/${prefix}x.jpg`);
  // 0-9 の写真
  for (let i = 0; i < 10; i++) {
    urls.push(`${S3_BASE}/${prefix}${i}.jpg`);
  }
  return urls;
}

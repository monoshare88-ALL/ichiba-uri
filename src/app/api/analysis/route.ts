import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// ------- types -------
interface ProfitRow {
  date: string;
  source: string;
  brand: string;
  itemName: string;
  condition: string;
  buyer: string;
  itemNo: string;
  listingId: string;  // 出品番号: コメ兵=A-1, 市場連盟=186-3
  reserve: number;
  purchase: number;
  purchaseTax: number;
  saleAmount: number;
  fee: number;
  feeTax: number;
  feeRate: number;
  campaign: number;
  campaignTax: number;
  saleTax: number;
  saleTaxIncl: number;
  profit: number;
  isReturned: boolean;
  returnFee: number;  // 引き手数料 (コメ兵: ¥500/件)
}

interface DateSummary {
  date: string;
  count: number;
  lossCount: number;
  returnedCount: number;
  purchase: number;
  sale: number;
  profit: number;
  profitRate: number;
}

interface GroupSummary {
  name: string;
  count: number;
  lossCount: number;
  purchase: number;
  profit: number;
  profitRate: number;
  returnCount?: number;
  returnFee?: number;
}

// ------- helpers -------
function extractDate(filename: string): string | null {
  const m = filename.match(/コメ(\d{6})社内用/);
  return m ? m[1] : null;
}

function safeNum(val: unknown): number {
  if (val == null || val === "") return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function getCellVal(
  sheet: XLSX.WorkSheet,
  r: number,
  c: number,
): unknown {
  const cell = sheet[XLSX.utils.encode_cell({ r, c })];
  return cell ? cell.v : null;
}

function getSheetRange(sheet: XLSX.WorkSheet) {
  if (!sheet["!ref"]) return null;
  return XLSX.utils.decode_range(sheet["!ref"]);
}

/** ヘッダー文字列を正規化: 改行除去、全角英数→半角、全角記号→半角 */
function normalizeHeader(s: string): string {
  return s.trim()
    .replace(/\r?\n/g, "")
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
}

function getAllHeaders(sheet: XLSX.WorkSheet) {
  const range = getSheetRange(sheet);
  if (!range) return { headerRow: 0, headers: {} as Record<number, string> };

  let bestRow = 0;
  let bestCount = 0;

  const maxScan = Math.min(range.s.r + 10, range.e.r);
  for (let r = range.s.r; r <= maxScan; r++) {
    let count = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = getCellVal(sheet, r, c);
      if (v && typeof v === "string") count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestRow = r;
    }
  }

  const headers: Record<number, string> = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const v = getCellVal(sheet, bestRow, c);
    if (v != null) headers[c] = normalizeHeader(String(v));
  }

  // 2行ヘッダー対応: bestRowの前後1行を調べて空セルを補完
  for (const adjRow of [bestRow - 1, bestRow + 1]) {
    if (adjRow < range.s.r || adjRow > maxScan) continue;
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (headers[c]) continue;
      const v = getCellVal(sheet, adjRow, c);
      if (v && typeof v === "string") {
        headers[c] = normalizeHeader(String(v));
      }
    }
  }

  return { headerRow: bestRow, headers };
}

function hasSellData(headers: Record<number, string>): boolean {
  const vals = Object.values(headers);
  const exactMatch = ["売り", "売", "金額", "利益", "粗利"];
  const partialMatch = ["売り税", "売り金額", "成立金額", "セリ結果", "市場売り",
    "金額(税", "金額+税", "売り計", "販売額", "販売金額", "売上金額", "売り価格",
    "商談確定"];
  return vals.some((h) =>
    exactMatch.some((k) => h === k) || partialMatch.some((k) => h.includes(k))
  );
}

function hasItemInfo(headers: Record<number, string>): boolean {
  const vals = Object.values(headers);
  return vals.some((h) => h === "ブランド" || h.includes("ブランド名") || h.includes("品名") || h.includes("商品名") || h.includes("商品"));
}

function hasPurchaseData(headers: Record<number, string>): boolean {
  const vals = Object.values(headers);
  return vals.some((h) => h === "買値" || h.includes("買値") || h.includes("仕入") || h.includes("金額"));
}

function extractRows(
  sheet: XLSX.WorkSheet,
  dateStr: string,
  sheetName: string,
  opts?: { returnFee?: number },
): ProfitRow[] {
  const range = getSheetRange(sheet);
  if (!range) return [];

  const { headerRow, headers } = getAllHeaders(sheet);
  const col: Record<string, number> = {};

  for (const [cStr, h] of Object.entries(headers)) {
    const c = Number(cStr);
    // ブランド
    if (h === "ブランド" && col.brand == null) col.brand = c;
    else if ((h === "ブランド名" || h === "品名" || h === "モデル名") && col.item_name == null) col.item_name = c;
    // 商品名 (バッグ名、商品、商品名)
    else if ((h === "商品名" || h === "商品" || h === "バッグ名" || h === "モデル/商品名") && col.item_name == null) col.item_name = c;
    // 状態・ランク
    else if ((h === "状態" || h === "ランク" || h === "ﾗﾝｸ") && col.condition == null) col.condition = c;
    // 指値
    else if (h.includes("指値") && col.reserve == null) col.reserve = c;
    // バイヤー
    else if ((h === "バイヤー" || h === "バイヤー名") && col.buyer == null) col.buyer = c;
    else if ((h === "バイヤー２" || h === "バイヤー2" || h === "担当2" || h === "元のバイヤー") && col.buyer2 == null) col.buyer2 = c;
    // 管理番号・商品番号
    else if ((h === "商品番号" || h === "管理番号") && col.item_no == null) col.item_no = c;
    // 出品番号
    else if ((h === "自社出品" || h === "自社" || h === "出品番号" || h === "No." || h === "番号" || h === "札番") && col.listing_id == null) col.listing_id = c;
    // 箱番・枝番 (listing_id候補)
    else if ((h === "箱番" || h === "箱番枝番") && col.box == null) col.box = c;
    else if ((h === "枝番") && col.branch == null) col.branch = c;
    // 仕入 (様々な表記)
    else if (h === "買値" && col.purchase == null) col.purchase = c;
    else if ((h === "仕入れ" || h === "仕入" || h === "仕入れ金額" || h === "仕入れ税抜き" || h === "仕入金額(込)" || h === "仕入れ金額(税抜)" || h === "仕入れ(税抜)" || h === "仕入(税抜)" || h === "仕入れ(税抜き)" || h.startsWith("仕入") && !h.includes("税込")) && col.purchase == null) col.purchase = c;
    else if (h === "金額" && col.purchase == null && col.sale_amount == null) col.purchase = c;
    // 仕入税込
    else if ((h === "買値税込み" || h === "買値 税込み" || h === "仕入れ税込み" || h === "仕入計" || h === "仕入+税" || h === "仕入税" || h === "仕入れ(税込)" || h === "仕入(税込)") && col.purchase_tax == null) col.purchase_tax = c;
    else if ((h === "税込み修理代込み" || h.includes("税込") && h.includes("修理") || h === "税込み") && col.purchase_tax == null) {
      // 「税込み」は文脈で判断: 仕入の近くなら仕入税込み
      if (col.purchase != null && c <= col.purchase + 3) col.purchase_tax = c;
      else if (col.sale_amount != null && c > col.sale_amount && col.sale_tax == null) col.sale_tax = c;
      else if (col.purchase != null) col.purchase_tax = c;
    }
    // 売り (様々な表記)
    else if ((h === "売り税抜き" || h === "売り税抜") && col.sale_notax == null) col.sale_notax = c;
    else if ((h === "売り金額" || h.includes("売り金額")) && !h.includes("税込") && col.sale_amount == null) col.sale_amount = c;
    else if (h.includes("売り金額") && h.includes("税込") && col.sale_tax == null) col.sale_tax = c;
    else if ((h === "売り" || h === "売") && col.sale_amount == null) col.sale_amount = c;
    else if ((h === "売り税込み" || h === "売り税込" || h === "税込み売り" || h === "売税込み" || h === "売り計") && col.sale_tax == null) {
      if (col.purchase != null && c <= col.purchase + 2 && col.purchase_tax == null) {
        col.purchase_tax = c;
      } else {
        col.sale_tax = c;
      }
    }
    else if (h === "成立金額" && col.sale_amount == null) col.sale_amount = c;
    else if (h === "市場売り" && col.sale_amount == null) col.sale_amount = c;
    else if ((h === "金額(税抜)" || h === "最終売上金額" || h === "販売金額" || h === "売り価格" || h === "税抜き(商談確定)") && col.sale_amount == null) col.sale_amount = c;
    else if ((h === "金額" || h === "売り結果") && col.purchase != null && c > col.purchase + 2 && col.sale_amount == null) col.sale_amount = c;
    else if ((h === "金額(税込)" || h === "金額+税" || h === "売り税込み" || h === "売税込み" || h === "税込み(商談確定)") && col.sale_tax == null) col.sale_tax = c;
    else if ((h.includes("セリ結果") || h === "結果") && col.sale_amount == null) {
      // 最初の数行を確認して数値データがあれば売り金額列と判定
      for (let tr = headerRow + 1; tr <= Math.min(headerRow + 5, range.e.r); tr++) {
        const testCell = sheet[XLSX.utils.encode_cell({ r: tr, c })];
        if (testCell && testCell.t === "n") { col.sale_amount = c; break; }
      }
    }
    // 手数料
    else if ((h === "手数料" || h === "販売手数料" || h === "手数料(税抜)" || h === "撮影代金") && !h.includes("税込") && col.fee == null) col.fee = c;
    else if ((h.includes("手数料税込") || h.includes("手数料 税込") || h === "手数料(税込)" || h === "手数料+税") && col.fee_tax == null) col.fee_tax = c;
    // 販売額+手数料 (エコリング形式: 売り+手数料の合算)
    else if (h === "販売額+手数料" && col.sale_plus_fee == null) col.sale_plus_fee = c;
    // キャンペーン
    else if (h.includes("キャンペーン") && col.campaign == null) col.campaign = c;
    // 返品
    else if (h === "返品" && col.return_flag == null) col.return_flag = c;
    // 粗利・利益・売り(手数料引いた額)
    else if ((h.includes("粗利") || h === "利益" || h.includes("利益") || h.includes("手数料引いた") || h.includes("手数料ひいた")) && col.gross == null) col.gross = c;
  }

  if (col.item_name == null && col.brand != null) col.item_name = col.brand + 1;

  const saleCol = col.sale_amount ?? col.sale_notax ?? undefined;
  const saleTaxCol = col.sale_tax ?? undefined;
  const retFee = opts?.returnFee ?? 0;

  // 箱番のマージセル対応
  let lastBox = "";

  const rows: ProfitRow[] = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    let hasData = false;
    for (let c = range.s.c; c <= Math.min(range.s.c + 5, range.e.c); c++) {
      if (getCellVal(sheet, r, c) != null) { hasData = true; break; }
    }
    if (!hasData) continue;

    const brand = getCellVal(sheet, r, col.brand ?? -1);
    const itemName = getCellVal(sheet, r, col.item_name ?? -1);
    const purchase = safeNum(getCellVal(sheet, r, col.purchase ?? -1));
    let purchaseTax = safeNum(getCellVal(sheet, r, col.purchase_tax ?? -1));
    if (purchaseTax === 0 && purchase > 0) purchaseTax = Math.round(purchase * 1.1);

    let saleAmount = saleCol != null ? safeNum(getCellVal(sheet, r, saleCol)) : 0;
    let saleTax = saleTaxCol != null ? safeNum(getCellVal(sheet, r, saleTaxCol)) : 0;

    // エコリング形式: 販売額+手数料 の合算列がある場合
    if (saleAmount === 0 && saleTax === 0 && col.sale_plus_fee != null) {
      const combined = safeNum(getCellVal(sheet, r, col.sale_plus_fee));
      if (combined > 0) {
        // 手数料を差し引いた売り金額を算出
        const feeVal = safeNum(getCellVal(sheet, r, col.fee ?? -1));
        saleAmount = combined - feeVal;
        saleTax = Math.round(saleAmount * 1.1);
      }
    }

    if (saleAmount > 0 && saleTax === 0) saleTax = Math.round(saleAmount * 1.1);
    if (saleAmount === 0 && saleTax > 0) saleAmount = Math.round(saleTax / 1.1);

    const fee = safeNum(getCellVal(sheet, r, col.fee ?? -1));
    const feeTax = safeNum(getCellVal(sheet, r, col.fee_tax ?? -1));
    const campaign = safeNum(getCellVal(sheet, r, col.campaign ?? -1));
    const returnFlag = safeNum(getCellVal(sheet, r, col.return_flag ?? -1));
    const gross = safeNum(getCellVal(sheet, r, col.gross ?? -1));

    const isReturned = returnFlag >= 500 || (saleAmount === 0 && (purchase > 0 || purchaseTax > 0));

    // 税込み値を確定: 直接取れればそれを使い、なければ税抜き×1.1
    const actualFeeTax = feeTax > 0 ? feeTax : (fee > 0 ? Math.round(fee * 1.1) : 0);
    const actualFee = fee > 0 ? fee : (feeTax > 0 ? Math.round(feeTax / 1.1) : 0);
    let profit = 0;
    let netSaleTaxIncl = 0;
    if (saleAmount > 0 && purchaseTax > 0) {
      netSaleTaxIncl = saleTax - actualFeeTax + Math.round(campaign * 1.1);
      profit = netSaleTaxIncl - purchaseTax;
    } else if (gross !== 0 && purchaseTax > 0) {
      // 粗利が直接ある場合はそれを使う (ただし税込みかどうか不明なので仕入税込みとの差分)
      profit = gross;
      netSaleTaxIncl = gross + purchaseTax;
    }

    const feeRate = saleAmount > 0 && actualFee > 0 ? Math.round((actualFee / saleAmount) * 1000) / 10 : 0;

    // listing_id: 箱番+枝番 or 直接列
    let listingId = String(getCellVal(sheet, r, col.listing_id ?? -1) || "");
    if (!listingId && col.box != null) {
      const boxVal = getCellVal(sheet, r, col.box);
      if (boxVal) lastBox = String(boxVal);
      const branchVal = col.branch != null ? getCellVal(sheet, r, col.branch) : null;
      if (lastBox) {
        listingId = branchVal ? `${lastBox}-${branchVal}` : lastBox;
      }
    }

    if (purchase > 0 || saleAmount > 0 || brand || itemName) {
      rows.push({
        date: dateStr,
        source: sheetName,
        brand: String(brand || ""),
        itemName: String(itemName || ""),
        condition: String(getCellVal(sheet, r, col.condition ?? -1) || ""),
        buyer: (() => {
          const b = String(getCellVal(sheet, r, col.buyer ?? -1) || "");
          if (b === "再販" && col.buyer2 != null) {
            const b2 = String(getCellVal(sheet, r, col.buyer2) || "");
            return b2 ? `再販・${b2}` : "再販";
          }
          return b;
        })(),
        itemNo: String(getCellVal(sheet, r, col.item_no ?? -1) || ""),
        listingId,
        reserve: safeNum(getCellVal(sheet, r, col.reserve ?? -1)),
        purchase,
        purchaseTax,
        saleAmount,
        fee: actualFee,
        feeTax: actualFeeTax,
        feeRate,
        campaign,
        campaignTax: Math.round(campaign * 1.1),
        saleTax,
        saleTaxIncl: netSaleTaxIncl,
        profit,
        isReturned,
        returnFee: isReturned ? retFee : 0,
      });
    }
  }
  return rows;
}

// ------- コメ兵 rows collector -------
function collectKomehyoRows(baseDir: string): ProfitRow[] {
  const files = fs.readdirSync(baseDir)
    .filter((f: string) => f.startsWith("コメ") && f.endsWith("社内用.xlsx") && !f.includes("競合"))
    .sort();

  const allRows: ProfitRow[] = [];

  for (const fname of files) {
    const dateStr = extractDate(fname);
    if (!dateStr) continue;

    const filepath = path.join(baseDir, fname);
    let wb: XLSX.WorkBook;
    try {
      const buf = fs.readFileSync(filepath);
      wb = XLSX.read(buf, { type: "buffer" });
    } catch {
      continue;
    }

    const sheetAnalysis = wb.SheetNames.map((sn: string) => {
      const ws = wb.Sheets[sn];
      const { headers } = getAllHeaders(ws);
      return { name: sn, hasSell: hasSellData(headers), hasItem: hasItemInfo(headers), hasPurchase: hasPurchaseData(headers) };
    });

    const sellSheets = sheetAnalysis.filter((s) => s.hasSell);
    // itemSheets: 商品+買値情報を持つシート (sellヘッダーがあっても実データがなければ対象)
    const itemSheets = sheetAnalysis.filter((s) => s.hasItem && s.hasPurchase);

    // 全sellSheetを一旦読み取り、実際に販売データがあるかチェック
    const sheetRows: Record<string, ProfitRow[]> = {};
    for (const ss of sellSheets) {
      sheetRows[ss.name] = extractRows(wb.Sheets[ss.name], dateStr, "コメ兵");
    }

    // itemSheetsの中で「売りデータが実際にある」シートを除外して、ジョイン用ソースにする
    // (sellヘッダーがあるが実データ0件のシートもジョイン用に使える)
    const joinSources: ProfitRow[] = [];
    for (const is_ of itemSheets) {
      const rows = sheetRows[is_.name] ?? extractRows(wb.Sheets[is_.name], dateStr, "コメ兵");
      const hasPurchaseRows = rows.some((r) => r.purchase > 0);
      if (hasPurchaseRows) {
        joinSources.push(...rows);
      }
    }
    const joinIndex: Record<string, ProfitRow> = {};
    for (const r of joinSources) {
      if (r.itemNo) joinIndex[r.itemNo] = r;
    }

    for (const ss of sellSheets) {
      let rows = sheetRows[ss.name];
      const hasSoldRows = rows.some((r) => r.saleAmount > 0);
      if (!hasSoldRows) continue; // 販売データが実際にないシートはスキップ

      // 商品情報や買値が欠けている行をジョインで補完
      if (Object.keys(joinIndex).length > 0) {
        rows = rows.map((r) => {
          if (r.saleAmount > 0) {
            const src = joinIndex[r.itemNo];
            if (src) {
              return {
                ...r,
                brand: r.brand || src.brand,
                itemName: r.itemName || src.itemName,
                condition: r.condition || src.condition,
                buyer: r.buyer || src.buyer,
                listingId: r.listingId || src.listingId,
                purchase: r.purchase || src.purchase,
                purchaseTax: r.purchaseTax || src.purchaseTax,
                reserve: r.reserve || src.reserve,
              };
            }
          }
          return r;
        });
      }
      allRows.push(...rows);
    }
  }

  return allRows;
}

// ------- 市場連盟 (TABA) rows collector -------
function collectTabaRows(baseDir: string): ProfitRow[] {
  const files = fs.readdirSync(baseDir)
    .filter((f: string) => f.includes("バイヤー用") && (f.endsWith(".xlsm") || f.endsWith(".xlsx")))
    .sort();

  const allRows: ProfitRow[] = [];

  for (const fname of files) {
    // 日付抽出: "...バイヤー用250502.xlsm" / "...バイヤー用2501002.xlsm" / "...2024.12.02バイヤー用.xlsm"
    let dateStr: string | null = null;
    const mDigits = fname.match(/バイヤー用(\d+)\./);
    const mDot = fname.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (mDigits) {
      const d = mDigits[1];
      if (d.length === 6) {
        // YYMMDD (例: 250502 = 25/05/02)
        dateStr = d;
      } else if (d.length === 7) {
        // YY + 0MM + DD (例: 2501002 → YY=25, MM=10, DD=02)
        dateStr = d.slice(0, 2) + d.slice(3, 5) + d.slice(5, 7);
      }
    } else if (mDot) {
      dateStr = mDot[1].slice(2) + mDot[2] + mDot[3]; // "2024.12.02" -> "241202"
    }
    if (!dateStr) continue;

    const filepath = path.join(baseDir, fname);
    let wb: XLSX.WorkBook;
    try {
      const buf = fs.readFileSync(filepath);
      wb = XLSX.read(buf, { type: "buffer" });
    } catch {
      continue;
    }

    // 入力用ｼｰﾄ を探す
    const sheetName = wb.SheetNames.find((sn: string) => sn.includes("入力"));
    if (!sheetName) continue;
    const ws = wb.Sheets[sheetName];
    const range = getSheetRange(ws);
    if (!range) continue;

    // ヘッダー検出 (row 0)
    const headers: Record<number, string> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = getCellVal(ws, 0, c);
      if (v != null) headers[c] = String(v).trim();
    }

    // カラム位置を検出 (フォーマットA/B自動判定)
    const col: Record<string, number> = {};
    for (const [cStr, h] of Object.entries(headers)) {
      const c = Number(cStr);
      if (h === "ﾌﾞﾗﾝﾄﾞ名" || h === "ブランド名") col.brand = c;
      else if (h === "ﾓﾃﾞﾙ名" || h === "モデル名") col.item_name = c;
      else if (h === "品名") col.category = c;
      else if (h === "ﾗﾝｸ" || h === "ランク") col.condition = c;
      else if (h.includes("指値")) col.reserve = c;
      else if (h === "バイヤー名" || h === "バイヤー") col.buyer = c;
      else if (h === "バイヤー２") col.buyer2 = c;
      else if (h === "商品番号") col.item_no = c;
      else if (h === "仕入れ金額" || h === "仕入れ税抜き") col.purchase = c;
      else if (h === "仕入れ税込み") col.purchase_tax = c;
      else if (h === "税込み" && col.purchase != null && c === col.purchase + 1) col.purchase_tax = c;
      else if (h === "売り" || h === "売り金額") col.sale = c;
      else if (h === "売り税込み") col.sale_tax = c;
      else if (h === "手数料" && col.sale != null) col.fee = c;
      else if (h === "手数料税込み") col.fee_tax = c;
      else if (h === "粗利") col.gross = c;
      else if (h === "通番") col.listing = c;
      else if (h === "箱番") col.box = c;
      else if (h === "枝番") col.branch = c;
      else if (h === "頁") col.page = c;
    }

    // brand列がヘッダーなしの場合 (バイヤー用で消える場合) — category+1 or固定位置
    if (col.brand == null && col.category != null) col.brand = col.category + 1;

    // バイヤー名がヘッダーなしの場合 (241202旧フォーマット: 仕入れ列の直前)
    if (col.buyer == null && col.purchase != null) {
      // 仕入れ列の1つ前にデータがあるか確認
      const testVal = getCellVal(ws, 1, col.purchase - 1);
      if (testVal && typeof testVal === "string") col.buyer = col.purchase - 1;
    }

    // 売り税込みが別列でない場合、売りの次を確認
    if (col.sale_tax == null && col.sale != null) {
      const nextH = headers[col.sale + 1];
      if (nextH && (nextH.includes("税込") || nextH === "売り税込み")) col.sale_tax = col.sale + 1;
    }

    // 箱番はマージセルで10行に1つ → 前の値を引き継ぐ
    let lastBox = "";
    for (let r = 1; r <= range.e.r; r++) {
      const sale = safeNum(getCellVal(ws, r, col.sale ?? -1));
      if (sale <= 0) continue; // 販売データなしはスキップ

      const brand = getCellVal(ws, r, col.brand ?? -1);
      const itemName = getCellVal(ws, r, col.item_name ?? -1);
      const purchase = safeNum(getCellVal(ws, r, col.purchase ?? -1));
      let purchaseTax = safeNum(getCellVal(ws, r, col.purchase_tax ?? -1));
      if (purchaseTax === 0 && purchase > 0) purchaseTax = Math.round(purchase * 1.1);

      const saleTax = col.sale_tax != null ? safeNum(getCellVal(ws, r, col.sale_tax)) : Math.round(sale * 1.1);
      const fee = safeNum(getCellVal(ws, r, col.fee ?? -1));
      const feeTaxRaw = safeNum(getCellVal(ws, r, col.fee_tax ?? -1));

      let feeTax: number;
      if (col.fee_tax != null && feeTaxRaw > 0) {
        feeTax = feeTaxRaw;
      } else {
        feeTax = fee;
      }

      const netSaleTaxIncl = saleTax - feeTax;
      const profit = netSaleTaxIncl - purchaseTax;

      const feeRate = sale > 0 && fee > 0 ? Math.round((fee / sale) * 1000) / 10 : 0;

      // 箱番-枝番の構築 (箱番はマージセルなので前の値を引き継ぐ)
      const boxVal = getCellVal(ws, r, col.box ?? -1);
      if (boxVal) lastBox = String(boxVal);
      const branchVal = getCellVal(ws, r, col.branch ?? -1);
      const branchStr = branchVal ? String(branchVal) : "";
      const listingId = lastBox && branchStr ? `${lastBox}-${branchStr}` : "";

      allRows.push({
        date: dateStr,
        source: "市場連盟",
        brand: String(brand || ""),
        itemName: String(itemName || ""),
        condition: String(getCellVal(ws, r, col.condition ?? -1) || ""),
        buyer: (() => {
          const b = String(getCellVal(ws, r, col.buyer ?? -1) || "");
          if (b === "再販" && col.buyer2 != null) {
            const b2 = String(getCellVal(ws, r, col.buyer2) || "");
            return b2 ? `再販・${b2}` : "再販";
          }
          return b;
        })(),
        itemNo: String(getCellVal(ws, r, col.item_no ?? -1) || ""),
        listingId,
        reserve: safeNum(getCellVal(ws, r, col.reserve ?? -1)),
        purchase,
        purchaseTax,
        saleAmount: sale,
        fee,
        feeTax,
        feeRate,
        campaign: 0,
        campaignTax: 0,
        saleTax,
        saleTaxIncl: netSaleTaxIncl,
        profit,
        isReturned: false,
        returnFee: 0,
      });
    }
  }

  return allRows;
}

// ------- 集計 (共通) -------
function buildSummary(allRows: ProfitRow[]) {
  // dedupe
  const seen = new Set<string>();
  const unique: ProfitRow[] = [];
  for (const r of allRows) {
    const key = `${r.itemNo}|${r.brand}|${r.itemName}|${r.purchase}|${r.saleAmount}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  const hasCost = (r: ProfitRow) => r.purchase > 0 || r.purchaseTax > 0;
  const sold = unique.filter((r) => !r.isReturned && r.saleAmount > 0);
  const profitRows = sold.filter(hasCost);
  const returned = unique.filter((r) => r.isReturned);
  // 全商品 = 利益計算可能な商品 + 引き商品 (表示用)
  const allDisplayRows = [...profitRows, ...returned.filter(hasCost)];

  // date summary
  const byDate: Record<string, { count: number; lossCount: number; returnedCount: number; purchase: number; sale: number; profit: number }> = {};
  for (const r of profitRows) {
    if (!byDate[r.date]) byDate[r.date] = { count: 0, lossCount: 0, returnedCount: 0, purchase: 0, sale: 0, profit: 0 };
    const d = byDate[r.date];
    d.count++;
    d.purchase += r.purchaseTax;
    d.sale += r.saleTaxIncl;
    d.profit += r.profit;
    if (r.profit < 0) d.lossCount++;
  }
  for (const r of returned) {
    if (!byDate[r.date]) byDate[r.date] = { count: 0, lossCount: 0, returnedCount: 0, purchase: 0, sale: 0, profit: 0 };
    byDate[r.date].returnedCount++;
  }
  const dateSummary: DateSummary[] = Object.entries(byDate)
    .filter(([, d]) => d.count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      count: d.count,
      lossCount: d.lossCount,
      returnedCount: d.returnedCount,
      purchase: Math.round(d.purchase),
      sale: Math.round(d.sale),
      profit: Math.round(d.profit),
      profitRate: d.purchase > 0 ? Math.round((d.profit / d.purchase) * 1000) / 10 : 0,
    }));

  // brand summary
  const byBrand: Record<string, { count: number; lossCount: number; purchase: number; profit: number }> = {};
  for (const r of profitRows) {
    const b = r.brand || "(不明)";
    if (!byBrand[b]) byBrand[b] = { count: 0, lossCount: 0, purchase: 0, profit: 0 };
    byBrand[b].count++;
    byBrand[b].purchase += r.purchaseTax;
    byBrand[b].profit += r.profit;
    if (r.profit < 0) byBrand[b].lossCount++;
  }
  const brandSummary: GroupSummary[] = Object.entries(byBrand)
    .filter(([, d]) => d.count >= 3)
    .sort((a, b) => b[1].profit - a[1].profit)
    .map(([name, d]) => ({
      name,
      count: d.count,
      lossCount: d.lossCount,
      purchase: Math.round(d.purchase),
      profit: Math.round(d.profit),
      profitRate: d.purchase > 0 ? Math.round((d.profit / d.purchase) * 1000) / 10 : 0,
    }));

  // buyer summary (販売 + 引き)
  const byBuyer: Record<string, { count: number; lossCount: number; purchase: number; profit: number; returnCount: number; returnFee: number }> = {};
  for (const r of profitRows) {
    const b = r.buyer || "(不明)";
    if (!byBuyer[b]) byBuyer[b] = { count: 0, lossCount: 0, purchase: 0, profit: 0, returnCount: 0, returnFee: 0 };
    byBuyer[b].count++;
    byBuyer[b].purchase += r.purchaseTax;
    byBuyer[b].profit += r.profit;
    if (r.profit < 0) byBuyer[b].lossCount++;
  }
  for (const r of returned) {
    const b = r.buyer || "(不明)";
    if (!byBuyer[b]) byBuyer[b] = { count: 0, lossCount: 0, purchase: 0, profit: 0, returnCount: 0, returnFee: 0 };
    byBuyer[b].returnCount++;
    byBuyer[b].returnFee += r.returnFee;
  }
  const buyerSummary: GroupSummary[] = Object.entries(byBuyer)
    .filter(([, d]) => d.count >= 2 || d.returnCount > 0)
    .sort((a, b) => b[1].profit - a[1].profit)
    .map(([name, d]) => ({
      name,
      count: d.count,
      lossCount: d.lossCount,
      purchase: Math.round(d.purchase),
      profit: Math.round(d.profit),
      profitRate: d.purchase > 0 ? Math.round((d.profit / d.purchase) * 1000) / 10 : 0,
      returnCount: d.returnCount,
      returnFee: d.returnFee,
    }));

  // 半期別引き手数料集計 (12-5月 / 6-11月)
  // date format: YYMMDD → 月を取得
  const getHalfPeriod = (dateStr: string): string => {
    const yy = parseInt(dateStr.slice(0, 2), 10);
    const mm = parseInt(dateStr.slice(2, 4), 10);
    const fullYear = 2000 + yy;
    // 12-5月期: 前年12月〜当年5月 → ラベルは "YY年12月-YY年5月"
    // 6-11月期: 当年6月〜当年11月
    if (mm >= 6 && mm <= 11) {
      return `${fullYear}年6-11月`;
    }
    // 12月は次の期の開始
    if (mm === 12) {
      return `${fullYear}年12月-${fullYear + 1}年5月`;
    }
    // 1-5月は前年12月開始の期
    return `${fullYear - 1}年12月-${fullYear}年5月`;
  };

  interface ReturnByPeriodBuyer { buyer: string; count: number; fee: number }
  interface ReturnPeriod { period: string; buyers: ReturnByPeriodBuyer[]; totalCount: number; totalFee: number }

  const returnByPeriod: Record<string, Record<string, { count: number; fee: number }>> = {};
  for (const r of returned) {
    if (r.returnFee <= 0) continue;
    const period = getHalfPeriod(r.date);
    const buyer = r.buyer || "(不明)";
    if (!returnByPeriod[period]) returnByPeriod[period] = {};
    if (!returnByPeriod[period][buyer]) returnByPeriod[period][buyer] = { count: 0, fee: 0 };
    returnByPeriod[period][buyer].count++;
    returnByPeriod[period][buyer].fee += r.returnFee;
  }

  const returnPeriodSummary: ReturnPeriod[] = Object.entries(returnByPeriod)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, buyers]) => {
      const buyerList = Object.entries(buyers)
        .sort((a, b) => b[1].fee - a[1].fee)
        .map(([buyer, d]) => ({ buyer, count: d.count, fee: d.fee }));
      return {
        period,
        buyers: buyerList,
        totalCount: buyerList.reduce((s, b) => s + b.count, 0),
        totalFee: buyerList.reduce((s, b) => s + b.fee, 0),
      };
    });

  // totals
  const totalPurchase = profitRows.reduce((s, r) => s + r.purchaseTax, 0);
  const totalProfit = profitRows.reduce((s, r) => s + r.profit, 0);
  const totalFee = profitRows.reduce((s, r) => s + r.feeTax, 0);
  const totalCampaign = profitRows.reduce((s, r) => s + r.campaignTax, 0);
  const totalReturnFee = returned.reduce((s, r) => s + r.returnFee, 0);

  return {
    summary: {
      totalItems: profitRows.length,
      totalLoss: profitRows.filter((r) => r.profit < 0).length,
      totalReturned: returned.length,
      totalReturnFee,
      totalPurchase: Math.round(totalPurchase),
      totalProfit: Math.round(totalProfit),
      totalFee: Math.round(totalFee),
      totalCampaign: Math.round(totalCampaign),
      profitRate: totalPurchase > 0 ? Math.round((totalProfit / totalPurchase) * 1000) / 10 : 0,
    },
    dateSummary,
    brandSummary,
    buyerSummary,
    returnPeriodSummary,
    items: allDisplayRows.map((r) => ({
      ...r,
      purchaseTax: Math.round(r.purchaseTax),
      saleTax: Math.round(r.saleTax),
      saleTaxIncl: Math.round(r.saleTaxIncl),
      profit: Math.round(r.profit),
    })),
  };
}

// ------- 汎用日付抽出 -------
function extractDateGeneric(filename: string): string | null {
  // YYYYMMDD (例: 20260430, 20250315)
  let m = filename.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (m) return m[1].slice(2) + m[2] + m[3];

  // YY年M月D日 (例: 26年5月28日)
  m = filename.match(/(\d{2})年(\d{1,2})月(\d{1,2})日/);
  if (m) return m[1] + m[2].padStart(2, "0") + m[3].padStart(2, "0");

  // YYMMDD (例: 260506, 250315) — 6桁連続
  m = filename.match(/(?:^|[^\d])(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[^\d]|$)/);
  if (m) return m[1] + m[2] + m[3];

  // MMDD (例: 0530, 1024) — 4桁で月日
  m = filename.match(/(?:^|[^\d])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[^\d-]|$)/);
  if (m) return "__" + m[1] + m[2]; // 年不明 → "__MMDD"

  // M.D形式 (例: 5.29, 10.30)
  m = filename.match(/(?:^|[^\d])(\d{1,2})\.(\d{1,2})(?:[^\d]|$)/);
  if (m) {
    const mm = parseInt(m[1], 10);
    const dd = parseInt(m[2], 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return "__" + String(mm).padStart(2, "0") + String(dd).padStart(2, "0");
    }
  }

  // YYMM (例: 2605, 2411) — 4桁で月が有効な場合
  m = filename.match(/(?:^|[^\d])(2[3-9]|[3-9]\d)(0[1-9]|1[0-2])(?:[^\d]|$)/);
  if (m) return m[1] + m[2] + "01";

  // N月 (例: 5月, 12月) — 月のみ
  m = filename.match(/(\d{1,2})月/);
  if (m) {
    const mm = parseInt(m[1], 10);
    if (mm >= 1 && mm <= 12) return "__" + String(mm).padStart(2, "0") + "01";
  }

  return null;
}

/** ファイルの更新日から年(YY)を補完 */
function fixDateYear(dateStr: string, filepath: string): string {
  if (!dateStr.startsWith("__")) return dateStr;
  try {
    const stat = fs.statSync(filepath);
    const yy = String(stat.mtime.getFullYear()).slice(2);
    return yy + dateStr.slice(2);
  } catch {
    return "26" + dateStr.slice(2); // フォールバック
  }
}

// ------- 汎用 rows collector -------
interface GenericMarketDef {
  id: string;
  name: string;
  baseDir: string;
  /** ファイルフィルタ: trueのファイルだけ処理 */
  fileFilter: (filename: string) => boolean;
  /** 日付抽出 (デフォルト: extractDateGeneric) */
  extractDate?: (filename: string) => string | null;
  /** シートフィルタ (デフォルト: 全シート) */
  sheetFilter?: (sheetName: string) => boolean;
  /** 引き手数料/件 (デフォルト: 0) */
  returnFee?: number;
  /** サブフォルダも再帰的に検索 */
  recursive?: boolean;
}

function listFiles(dir: string, recursive: boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && recursive) {
      files.push(...listFiles(full, true));
    } else if (e.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function collectGenericRows(def: GenericMarketDef): ProfitRow[] {
  const allFiles = listFiles(def.baseDir, !!def.recursive);
  const dateExtractor = def.extractDate || extractDateGeneric;
  const sheetFilter = def.sheetFilter || (() => true);

  // ファイルをフィルタ＆新しい順にソート (同じ日付のファイルは最新のみ)
  const candidates = allFiles
    .map(fp => ({ fp, name: path.basename(fp) }))
    .filter(f => def.fileFilter(f.name))
    .sort((a, b) => {
      // 新しいファイルを優先
      try {
        return fs.statSync(b.fp).mtimeMs - fs.statSync(a.fp).mtimeMs;
      } catch { return 0; }
    });

  const allRows: ProfitRow[] = [];
  const seenDates = new Set<string>();

  for (const { fp, name } of candidates) {
    let dateStr = dateExtractor(name);
    if (!dateStr) {
      // 日付がファイル名から取れない場合、ファイル更新日を使用
      try {
        const stat = fs.statSync(fp);
        const d = stat.mtime;
        dateStr = String(d.getFullYear()).slice(2) +
          String(d.getMonth() + 1).padStart(2, "0") +
          String(d.getDate()).padStart(2, "0");
      } catch { continue; }
    }
    // 年不明の場合、ファイル更新日で補完
    dateStr = fixDateYear(dateStr, fp);
    // 同じ日付のファイルは最新のみ（ソート済みなので最初に来たもの）
    if (seenDates.has(dateStr)) continue;
    seenDates.add(dateStr);

    let wb: XLSX.WorkBook;
    try {
      const buf = fs.readFileSync(fp);
      wb = XLSX.read(buf, { type: "buffer" });
    } catch {
      continue;
    }

    // 全シートを解析して売りシート/仕入シートを分類
    const sheetData: { name: string; rows: ProfitRow[]; hasSell: boolean; hasPurchase: boolean }[] = [];
    for (const sn of wb.SheetNames) {
      if (!sheetFilter(sn)) continue;
      const ws = wb.Sheets[sn];
      const { headers } = getAllHeaders(ws);
      const hs = hasSellData(headers);
      const hp = hasPurchaseData(headers);
      if (!hs && !hp) continue;
      const rows = extractRows(ws, dateStr, def.name, { returnFee: def.returnFee || 0 });
      sheetData.push({ name: sn, rows, hasSell: hs, hasPurchase: hp });
    }

    // ジョインインデックスを構築 (仕入データのある行を商品番号でインデックス化)
    const joinIndex: Record<string, ProfitRow> = {};
    for (const sd of sheetData) {
      for (const r of sd.rows) {
        if (r.itemNo && r.purchaseTax > 0) joinIndex[r.itemNo] = r;
      }
    }

    // 売りデータのある行を収集し、仕入が欠けていればジョインで補完
    for (const sd of sheetData) {
      for (const r of sd.rows) {
        if (r.saleAmount > 0 && r.purchaseTax === 0 && r.itemNo && joinIndex[r.itemNo]) {
          const src = joinIndex[r.itemNo];
          r.purchase = r.purchase || src.purchase;
          r.purchaseTax = r.purchaseTax || src.purchaseTax;
          r.brand = r.brand || src.brand;
          r.itemName = r.itemName || src.itemName;
          r.condition = r.condition || src.condition;
          r.buyer = r.buyer || src.buyer;
          r.reserve = r.reserve || src.reserve;
          // 利益を再計算
          if (r.saleAmount > 0 && r.purchaseTax > 0) {
            const actualFeeTax = r.feeTax > 0 ? r.feeTax : (r.fee > 0 ? Math.round(r.fee * 1.1) : 0);
            r.saleTaxIncl = r.saleTax - actualFeeTax + Math.round(r.campaign * 1.1);
            r.profit = r.saleTaxIncl - r.purchaseTax;
          }
        }
        allRows.push(r);
      }
    }
  }

  return allRows;
}

// ------- 全市場定義 -------
const AGO_BASE = "D:/JP Dropbox/バイヤー用/あご表";

const isExcel = (f: string) => f.endsWith(".xlsx") || f.endsWith(".xlsm") || f.endsWith(".xls");
const notTilde = (f: string) => !f.startsWith("~$");

const GENERIC_MARKETS: GenericMarketDef[] = [
  {
    id: "jaa",
    name: "JAA",
    baseDir: `${AGO_BASE}/JAA`,
    fileFilter: f => isExcel(f) && notTilde(f) && f.includes("社内用"),
    // まとめ or Sheet1 のみ (元シートはjoinソースとして別途利用されるが、
    // 汎用コレクターではシート内で完結するデータのみ取得)
    returnFee: 0,
  },
  {
    id: "oba",
    name: "OBA",
    baseDir: `${AGO_BASE}/OBA`,
    fileFilter: f => isExcel(f) && notTilde(f) && (f.includes("仕入") || f.includes("社内用") || f.includes("OBA")),
    returnFee: 0,
  },
  {
    id: "monobank",
    name: "ものばんく",
    baseDir: `${AGO_BASE}/ものばんく`,
    fileFilter: f => isExcel(f) && notTilde(f) && f.includes("社内用"),
    sheetFilter: sn => !sn.includes("原本"),
    returnFee: 0,
  },
  {
    id: "ecoring",
    name: "エコリング",
    baseDir: `${AGO_BASE}/エコリング出品`,
    fileFilter: f => isExcel(f) && notTilde(f) && f.includes("エコリング"),
    returnFee: 0,
  },
  {
    id: "timeless",
    name: "タイムレス",
    baseDir: `${AGO_BASE}/タイムレスオークション`,
    fileFilter: f => isExcel(f) && notTilde(f) && f.includes("社内用"),
    recursive: true,
    returnFee: 0,
  },
  {
    id: "namara",
    name: "なまら",
    baseDir: `${AGO_BASE}/その他市場/なまら`,
    fileFilter: f => isExcel(f) && notTilde(f) && f.includes("社内用"),
    returnFee: 0,
  },
  {
    id: "toyohashi",
    name: "豊橋競市",
    baseDir: `${AGO_BASE}/豊橋競市`,
    fileFilter: f => isExcel(f) && notTilde(f) && (f.includes("自社用") || f.includes("社内用") || f.includes("豊橋競市")),
    recursive: true,
    sheetFilter: sn => !sn.includes("原本") && !sn.includes("見本"),
    returnFee: 0,
  },
  {
    id: "prime",
    name: "プライム",
    baseDir: `${AGO_BASE}/プライム`,
    fileFilter: f => isExcel(f) && notTilde(f) && f.includes("社内用"),
    sheetFilter: sn => sn.includes("まとめ") || sn === "Sheet1" || sn === "元シート" || /^\d+$/.test(sn),
    returnFee: 0,
  },
  {
    id: "bo_kanazawa",
    name: "BO金沢",
    baseDir: `${AGO_BASE}/BO金沢`,
    fileFilter: f => isExcel(f) && notTilde(f) && (f.includes("仕入") || f.includes("JBA")),
    returnFee: 0,
  },
  {
    id: "apre",
    name: "アプレ",
    baseDir: `${AGO_BASE}/アプレ`,
    fileFilter: f => (isExcel(f)) && notTilde(f) && f.includes("社内用"),
    recursive: true,
    sheetFilter: sn => sn.includes("入力") || sn === "Sheet1",
    returnFee: 0,
  },
  {
    id: "daikichi",
    name: "大吉卸商談",
    baseDir: `${AGO_BASE}/大吉卸商談`,
    fileFilter: f => isExcel(f) && notTilde(f) && f.includes("商談") && !f.includes("手順"),
    returnFee: 0,
  },
  {
    id: "manekiya",
    name: "まねきや",
    baseDir: `${AGO_BASE}/まねきや`,
    fileFilter: f => isExcel(f) && notTilde(f),
    returnFee: 0,
  },
  {
    id: "auc_net",
    name: "オークネット",
    baseDir: `${AGO_BASE}/その他市場/オークネット`,
    fileFilter: f => isExcel(f) && notTilde(f),
    returnFee: 0,
  },
  {
    id: "yba",
    name: "YBA",
    baseDir: `${AGO_BASE}/YBA`,
    fileFilter: f => isExcel(f) && notTilde(f) && (f.includes("社内") || f.includes("仕入")),
    recursive: true,
    sheetFilter: sn => sn.includes("まとめ") || /^\d+$/.test(sn),
    returnFee: 0,
  },
  {
    id: "rs",
    name: "RS",
    baseDir: `${AGO_BASE}/RS`,
    fileFilter: f => isExcel(f) && notTilde(f) && f.includes("社内用"),
    recursive: true,
    sheetFilter: sn => sn.includes("出品表") || /^\d+$/.test(sn),
    returnFee: 0,
  },
  {
    id: "tokioka",
    name: "トキオカ",
    baseDir: `${AGO_BASE}/あご表ジュエリーチーム/トキオカ`,
    fileFilter: f => isExcel(f) && notTilde(f),
    sheetFilter: sn => sn === "入力欄",
    returnFee: 0,
  },
  {
    id: "second",
    name: "セカンド",
    baseDir: `${AGO_BASE}/セカンド`,
    fileFilter: f => isExcel(f) && notTilde(f) && !f.includes("提出"),
    returnFee: 0,
  },
  {
    id: "kome_apparel",
    name: "コメ兵アパレル",
    baseDir: `${AGO_BASE}/コメ兵アパレル`,
    fileFilter: f => isExcel(f) && notTilde(f) && f.includes("社内用"),
    sheetFilter: sn => sn === "Sheet1" || sn.includes("原本"),
    returnFee: 0,
  },
  {
    id: "kameido",
    name: "亀戸",
    baseDir: `${AGO_BASE}/亀戸`,
    fileFilter: f => isExcel(f) && notTilde(f),
    returnFee: 0,
  },
];

// ------- 市場売り明細 (全市場横断の原本Excel) -------
const MEISAI_BASE = "D:/JP Dropbox/バイヤー用/市場売り明細";

/** XLSX日付シリアル値を YYMMDD 文字列に変換 */
function xlsDateToYYMMDD(val: unknown): string {
  if (!val) return "";
  // Date オブジェクトの場合 (ExcelJS経由 etc)
  if (val instanceof Date) {
    const y = String(val.getFullYear()).slice(2);
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }
  // 数値 (Excelシリアル日付)
  if (typeof val === "number" && val > 30000) {
    const dt = XLSX.SSF.parse_date_code(val);
    if (dt) {
      const y = String(dt.y).slice(2);
      const m = String(dt.m).padStart(2, "0");
      const d = String(dt.d).padStart(2, "0");
      return `${y}${m}${d}`;
    }
  }
  // 文字列の場合
  const s = String(val);
  const match = s.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (match) {
    const y = match[1].slice(2);
    const m = match[2].padStart(2, "0");
    const d = match[3].padStart(2, "0");
    return `${y}${m}${d}`;
  }
  return "";
}

/** ヘッダー行から列インデックスを検出 */
function findMeisaiColumns(sheet: XLSX.WorkSheet): {
  format: "current" | "mid" | "old" | null;
  buyerCol: number;
  purchaseCol: number;
  dateCol: number;
  marketCol: number;
  saleCol: number;
  profitCol: number;
  itemNoCol: number;
  unsoldCol: number;
} | null {
  const range = getSheetRange(sheet);
  if (!range) return null;

  // ヘッダーセルを読む
  const headers: Record<number, string> = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const v = getCellVal(sheet, 0, c);
    if (v) headers[c] = String(v);
  }

  const find = (keyword: string) => {
    for (const [c, h] of Object.entries(headers)) {
      if (h.includes(keyword)) return Number(c);
    }
    return -1;
  };

  // 現行形式 (2206~): バイヤー, 仕入れ（税抜き）, 仕入金額（込）, 販売日付, 販売市場名, 販売金額, 差し引き利益, 商品番号, 売れなかったら
  if (find("バイヤー") === 0 && find("仕入金額") >= 0) {
    return {
      format: "current",
      buyerCol: 0,
      purchaseCol: find("仕入金額"),
      dateCol: find("販売日付"),
      marketCol: find("販売市場名"),
      saleCol: find("販売金額"),
      profitCol: find("差し引き"),
      itemNoCol: find("商品番号"),
      unsoldCol: find("売れなかったら"),
    };
  }

  // 中間形式 (1906~2111): No., バイヤー, 仕入日付, 仕入金額, 販売日付, 販売市場名, 販売番号, 販売金額, 差し引き利益
  if (find("No.") === 0 && find("バイヤー") >= 0) {
    return {
      format: "mid",
      buyerCol: find("バイヤー"),
      purchaseCol: find("仕入金額"),
      dateCol: find("販売日付"),
      marketCol: find("販売市場名"),
      saleCol: find("販売金額"),
      profitCol: find("差し引き"),
      itemNoCol: find("販売番号"),
      unsoldCol: -1,
    };
  }

  // 旧形式 (~1811): No., 市場名, 仕入日付, 仕入金額, 仕入れ番号, 販売日付, 販売市場名, 販売番号, 販売金額, 販売期間, 差し引き利益
  if (find("No.") === 0 && find("市場名") >= 0) {
    return {
      format: "old",
      buyerCol: find("市場名"), // 旧形式ではバイヤーなし、市場名で代替
      purchaseCol: find("仕入金額"),
      dateCol: find("販売日付"),
      marketCol: find("販売市場名"),
      saleCol: find("販売金額"),
      profitCol: find("差し引き"),
      itemNoCol: find("販売番号"),
      unsoldCol: -1,
    };
  }

  return null;
}

/** ファイル名からカテゴリを判定 */
function getMeisaiCategory(filename: string): string {
  if (filename.includes("時計") || filename.includes("ジュエリー")) return "時計宝石";
  if (filename.includes("道具")) return "道具";
  return "バッグ";
}

/** 既知の日付入力ミスを補正 (元データは変更しない) */
const MEISAI_DATE_FIXES: Record<string, { market?: string; corrected: string }> = {
  "261210": { market: "エコリング", corrected: "251210" },
};

/** 今日の YYMMDD */
function todayYYMMDD(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function collectMeisaiRows(): ProfitRow[] {
  const rows: ProfitRow[] = [];
  const today = todayYYMMDD();
  const dirs = [MEISAI_BASE, path.join(MEISAI_BASE, "過去分")];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(
      f => (f.startsWith("市場売り明細") && (f.endsWith(".xlsm") || f.endsWith(".xlsx")) && !f.startsWith("~$"))
    );

    for (const file of files) {
      const filePath = path.join(dir, file);
      const category = getMeisaiCategory(file);
      try {
        const buf = fs.readFileSync(filePath);
        const wb = XLSX.read(buf, { type: "buffer", cellDates: false });

        // 明細シート
        const meisaiSheet = wb.Sheets["明細"];
        if (meisaiSheet) {
          const cols = findMeisaiColumns(meisaiSheet);
          if (cols) {
            const range = getSheetRange(meisaiSheet)!;
            for (let r = 1; r <= range.e.r; r++) {
              const buyer = getCellVal(meisaiSheet, r, cols.buyerCol);
              if (!buyer) continue;
              const purchaseTax = safeNum(getCellVal(meisaiSheet, r, cols.purchaseCol));
              const dateVal = getCellVal(meisaiSheet, r, cols.dateCol);
              let dateStr = xlsDateToYYMMDD(dateVal);
              if (!dateStr) continue;
              // 日付が2016-2027の範囲外ならスキップ
              const yyCheck = parseInt(dateStr.slice(0, 2), 10);
              if (yyCheck < 16 || yyCheck > 27) continue;
              const market = String(getCellVal(meisaiSheet, r, cols.marketCol) || "");
              // 日付補正
              const fix = MEISAI_DATE_FIXES[dateStr];
              if (fix && (!fix.market || market === fix.market)) {
                dateStr = fix.corrected;
              }
              const saleAmount = safeNum(getCellVal(meisaiSheet, r, cols.saleCol));
              const rawProfit = safeNum(getCellVal(meisaiSheet, r, cols.profitCol));
              const itemNo = cols.itemNoCol >= 0 ? String(getCellVal(meisaiSheet, r, cols.itemNoCol) || "") : "";
              const unsold = cols.unsoldCol >= 0 ? getCellVal(meisaiSheet, r, cols.unsoldCol) : null;
              const isUnsold = unsold === 1 || unsold === "1";
              // 未来日付: まだ売れていないので利益0, 赤字扱いしない
              const isFuture = dateStr > today;
              const profit = isFuture ? 0 : Math.round(rawProfit);

              rows.push({
                date: dateStr,
                source: market || "(不明)",
                brand: category,
                itemName: market,
                condition: isUnsold ? "不落札" : (isFuture ? "未売上" : ""),
                buyer: String(buyer),
                itemNo,
                listingId: "",
                reserve: 0,
                purchase: Math.round(purchaseTax / 1.1),
                purchaseTax: Math.round(purchaseTax),
                saleAmount: isFuture ? 0 : Math.round(saleAmount),
                fee: 0,
                feeTax: 0,
                feeRate: 0,
                campaign: 0,
                campaignTax: 0,
                saleTax: isFuture ? 0 : Math.round(saleAmount),
                saleTaxIncl: isFuture ? 0 : Math.round(saleAmount),
                profit,
                isReturned: false,
                returnFee: 0,
              });
            }
          }
        }

        // 簡易明細シート — ヘッダー形式を自動判定
        const kangiSheet = wb.Sheets["簡易明細"];
        if (kangiSheet) {
          const range = getSheetRange(kangiSheet);
          if (range) {
            // ヘッダー判定: col0が「バイヤー」→現行形式、「販売日付」→旧形式
            const h0 = String(getCellVal(kangiSheet, 0, 0) || "");
            const isCurrentFormat = h0.includes("バイヤー");
            // 旧形式: 販売日付(0), 販売市場名(1), 仕入(2), 販売金額(3), 差し引き利益(4), バイヤー名(5), 備考(6)
            // 現行:   バイヤー(0), 仕入税抜(1), 仕入込(2), 販売日付(3), 販売市場名(4), 販売金額(5), 差し引き利益(6), 備考(7)
            // 旧形式のバイヤー列を探す（ファイルごとに微妙に違う）
            let oldBuyerCol = -1;
            if (!isCurrentFormat) {
              for (let c = 0; c <= Math.min(range.e.c, 10); c++) {
                const hv = String(getCellVal(kangiSheet, 0, c) || "");
                if (hv.includes("バイヤー")) { oldBuyerCol = c; break; }
              }
            }

            for (let r = 1; r <= range.e.r; r++) {
              const firstCell = getCellVal(kangiSheet, r, 0);
              if (firstCell == null) continue;

              let buyer: string, purchaseTax: number, dateStr: string, market: string, saleAmount: number, profit: number, note: string;

              if (isCurrentFormat) {
                buyer = String(firstCell);
                purchaseTax = safeNum(getCellVal(kangiSheet, r, 2));
                dateStr = xlsDateToYYMMDD(getCellVal(kangiSheet, r, 3));
                market = String(getCellVal(kangiSheet, r, 4) || "");
                saleAmount = safeNum(getCellVal(kangiSheet, r, 5));
                profit = safeNum(getCellVal(kangiSheet, r, 6));
                note = String(getCellVal(kangiSheet, r, 7) || "");
              } else {
                // 旧形式
                dateStr = xlsDateToYYMMDD(firstCell);
                market = String(getCellVal(kangiSheet, r, 1) || "");
                purchaseTax = safeNum(getCellVal(kangiSheet, r, 2));
                saleAmount = safeNum(getCellVal(kangiSheet, r, 3));
                profit = safeNum(getCellVal(kangiSheet, r, 4));
                buyer = oldBuyerCol >= 0 ? String(getCellVal(kangiSheet, r, oldBuyerCol) || "(不明)") : "(不明)";
                note = String(getCellVal(kangiSheet, r, oldBuyerCol >= 0 ? oldBuyerCol + 1 : 6) || "");
              }

              if (!dateStr) continue;
              // 日付が2016-2027の範囲外ならスキップ
              const yy = parseInt(dateStr.slice(0, 2), 10);
              if (yy < 16 || yy > 27) continue;
              // 日付補正
              const fixK = MEISAI_DATE_FIXES[dateStr];
              if (fixK && (!fixK.market || market === fixK.market)) {
                dateStr = fixK.corrected;
              }
              // 未来日付: まだ売れていないので利益0
              const isFutureK = dateStr > today;
              const adjSale = isFutureK ? 0 : Math.round(saleAmount);
              const adjProfit = isFutureK ? 0 : Math.round(profit);

              rows.push({
                date: dateStr,
                source: market || "(不明)",
                brand: category + "(まとめ)",
                itemName: `${market} まとめ ${note}`.trim(),
                condition: isFutureK ? "未売上(まとめ)" : "まとめ売り",
                buyer,
                itemNo: note,
                listingId: "",
                reserve: 0,
                purchase: Math.round(purchaseTax / 1.1),
                purchaseTax: Math.round(purchaseTax),
                saleAmount: adjSale,
                fee: 0,
                feeTax: 0,
                feeRate: 0,
                campaign: 0,
                campaignTax: 0,
                saleTax: adjSale,
                saleTaxIncl: adjSale,
                profit: adjProfit,
                isReturned: false,
                returnFee: 0,
              });
            }
          }
        }
      } catch (e) {
        console.error(`[meisai] Error reading ${file}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  return rows;
}

// ------- market configs -------
const MARKET_CONFIGS: Record<string, { name: string; baseDir: string; collector: (dir: string) => ProfitRow[] }> = {
  meisai:  { name: "市場売り明細(原本)", baseDir: MEISAI_BASE, collector: collectMeisaiRows },
  komehyo: { name: "コメ兵", baseDir: `${AGO_BASE}/コメ兵`, collector: collectKomehyoRows },
  taba:    { name: "市場連盟", baseDir: `${AGO_BASE}/市場連盟`, collector: collectTabaRows },
};

// 汎用市場を登録
for (const def of GENERIC_MARKETS) {
  MARKET_CONFIGS[def.id] = {
    name: def.name,
    baseDir: def.baseDir,
    collector: () => collectGenericRows(def),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get("market") || "";

  // 市場一覧を返す
  if (market === "_list") {
    const markets = Object.entries(MARKET_CONFIGS).map(([id, c]) => ({ id, name: c.name }));
    return NextResponse.json({ markets });
  }

  // "all" → 全市場横断分析
  if (market === "all") {
    try {
      const allRows: ProfitRow[] = [];
      for (const [, config] of Object.entries(MARKET_CONFIGS)) {
        try {
          const rows = config.collector(config.baseDir);
          allRows.push(...rows);
        } catch (e) {
          console.error(`[analysis] error in ${config.name}:`, e);
        }
      }
      const data = buildSummary(allRows);
      return NextResponse.json({ ...data, market: "all" });
    } catch (e: unknown) {
      console.error("[analysis] all error:", e);
      const msg = e instanceof Error ? e.message : "Unknown error";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const config = MARKET_CONFIGS[market || "komehyo"];
  if (!config) {
    return NextResponse.json({ error: `Unknown market: ${market}` }, { status: 400 });
  }

  try {
    const rows = config.collector(config.baseDir);
    const data = buildSummary(rows);
    return NextResponse.json({ ...data, market });
  } catch (e: unknown) {
    console.error("[analysis] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

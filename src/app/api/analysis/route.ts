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

function getAllHeaders(sheet: XLSX.WorkSheet) {
  const range = getSheetRange(sheet);
  if (!range) return { headerRow: 0, headers: {} as Record<number, string> };

  let bestRow = 0;
  let bestCount = 0;

  for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
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
    if (v != null) headers[c] = String(v).trim();
  }
  return { headerRow: bestRow, headers };
}

function hasSellData(headers: Record<number, string>): boolean {
  const vals = Object.values(headers);
  const kw = ["売り税抜", "売り税込", "売り金額", "成立金額", "セリ結果", "市場売り"];
  return vals.some((h) => kw.some((k) => h.includes(k)));
}

function hasItemInfo(headers: Record<number, string>): boolean {
  const vals = Object.values(headers);
  return vals.some((h) => h === "ブランド" || h.includes("ブランド名") || h.includes("品名"));
}

function hasPurchaseData(headers: Record<number, string>): boolean {
  const vals = Object.values(headers);
  return vals.some((h) => h === "買値" || h.includes("買値"));
}

function extractRows(
  sheet: XLSX.WorkSheet,
  dateStr: string,
  sheetName: string,
): ProfitRow[] {
  const range = getSheetRange(sheet);
  if (!range) return [];

  const { headerRow, headers } = getAllHeaders(sheet);
  const col: Record<string, number> = {};

  for (const [cStr, h] of Object.entries(headers)) {
    const c = Number(cStr);
    if (h === "ブランド" && col.brand == null) col.brand = c;
    else if ((h === "ブランド名" || h === "品名" || h === "モデル名") && col.item_name == null) col.item_name = c;
    else if (h === "状態" && col.condition == null) col.condition = c;
    else if (h.includes("指値") && col.reserve == null) col.reserve = c;
    else if (h === "バイヤー" && col.buyer == null) col.buyer = c;
    else if (h === "商品番号" && col.item_no == null) col.item_no = c;
    else if ((h === "自社出品" || h === "自社") && col.listing_id == null) col.listing_id = c;
    else if (h === "買値" && col.purchase == null) col.purchase = c;
    else if ((h === "買値税込み" || h === "買値 税込み") && col.purchase_tax == null) col.purchase_tax = c;
    else if (h === "税込み" || h === "買値 税込み") {
      // 「税込み」は文脈で判断: 買値の直後なら買値税込み、それ以外なら売り税込み
      if (col.purchase != null && c === col.purchase + 1 && col.purchase_tax == null) col.purchase_tax = c;
      else if (col.sale_amount != null && c > col.sale_amount && col.sale_tax == null) col.sale_tax = c;
    }
    else if ((h === "売り税抜き" || h === "売り税抜") && col.sale_notax == null) col.sale_notax = c;
    else if ((h === "売り金額" || h.includes("売り金額")) && !h.includes("税込") && col.sale_amount == null) col.sale_amount = c;
    else if (h.includes("売り金額") && h.includes("税込") && col.sale_tax == null) col.sale_tax = c;
    else if ((h === "売り税込み" || h === "売り税込" || h === "税込み売り") && col.sale_tax == null) {
      if (col.purchase != null && c <= col.purchase + 2) {
        if (col.purchase_tax == null) col.purchase_tax = c;
      } else {
        col.sale_tax = c;
      }
    }
    else if (h === "成立金額" && col.sale_amount == null) col.sale_amount = c;
    else if (h === "市場売り" && col.sale_amount == null) col.sale_amount = c;
    else if (h.includes("セリ結果") && col.sale_amount == null) {
      // セリ結果は金額の場合と参照番号(A-1)の場合がある → 最初のデータ行で判定
      const testCell = sheet[XLSX.utils.encode_cell({ r: headerRow + 1, c })];
      if (testCell && testCell.t === "n") col.sale_amount = c; // 数値なら売り金額
    }
    else if ((h === "手数料" || h === "販売手数料") && !h.includes("税込") && col.fee == null) col.fee = c;
    else if ((h.includes("手数料税込") || h.includes("手数料 税込")) && col.fee_tax == null) col.fee_tax = c;
    else if (h.includes("キャンペーン") && col.campaign == null) col.campaign = c;
    else if (h === "返品" && col.return_flag == null) col.return_flag = c;
    else if (h.includes("粗利") && col.gross == null) col.gross = c;
  }

  if (col.item_name == null && col.brand != null) col.item_name = col.brand + 1;

  const saleCol = col.sale_amount ?? col.sale_notax ?? undefined;
  const saleTaxCol = col.sale_tax ?? undefined;

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
    if (saleAmount > 0 && saleTax === 0) saleTax = Math.round(saleAmount * 1.1);
    if (saleAmount === 0 && saleTax > 0) saleAmount = Math.round(saleTax / 1.1);

    const fee = safeNum(getCellVal(sheet, r, col.fee ?? -1));
    const feeTax = safeNum(getCellVal(sheet, r, col.fee_tax ?? -1));
    const campaign = safeNum(getCellVal(sheet, r, col.campaign ?? -1));
    const returnFlag = safeNum(getCellVal(sheet, r, col.return_flag ?? -1));
    const gross = safeNum(getCellVal(sheet, r, col.gross ?? -1));

    const isReturned = returnFlag >= 500 || (saleAmount === 0 && purchase > 0);

    // 税込み値を確定: 直接取れればそれを使い、なければ税抜き×1.1
    const actualFeeTax = feeTax > 0 ? feeTax : (fee > 0 ? Math.round(fee * 1.1) : 0);
    const actualFee = fee > 0 ? fee : (feeTax > 0 ? Math.round(feeTax / 1.1) : 0);
    let profit = 0;
    let netSaleTaxIncl = 0;
    if (saleAmount > 0 && purchaseTax > 0) {
      // 利益 = 売り金額税込み − 手数料税込み + キャンペーン×1.1 − 買値税込み
      // (キャンペーン欄は税抜きで記載されている)
      netSaleTaxIncl = saleTax - actualFeeTax + Math.round(campaign * 1.1);
      profit = netSaleTaxIncl - purchaseTax;
    } else if (gross !== 0 && purchaseTax > 0) {
      profit = gross - purchaseTax;
      netSaleTaxIncl = gross;
    }

    const feeRate = saleAmount > 0 && actualFee > 0 ? Math.round((actualFee / saleAmount) * 1000) / 10 : 0;

    if (purchase > 0 || saleAmount > 0 || brand || itemName) {
      rows.push({
        date: dateStr,
        source: sheetName,
        brand: String(brand || ""),
        itemName: String(itemName || ""),
        condition: String(getCellVal(sheet, r, col.condition ?? -1) || ""),
        buyer: String(getCellVal(sheet, r, col.buyer ?? -1) || ""),
        itemNo: String(getCellVal(sheet, r, col.item_no ?? -1) || ""),
        listingId: String(getCellVal(sheet, r, col.listing_id ?? -1) || ""),
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
        returnFee: isReturned ? 500 : 0,  // コメ兵: 引き手数料 ¥500/件
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
      sheetRows[ss.name] = extractRows(wb.Sheets[ss.name], dateStr, ss.name);
    }

    // itemSheetsの中で「売りデータが実際にある」シートを除外して、ジョイン用ソースにする
    // (sellヘッダーがあるが実データ0件のシートもジョイン用に使える)
    const joinSources: ProfitRow[] = [];
    for (const is_ of itemSheets) {
      const rows = sheetRows[is_.name] ?? extractRows(wb.Sheets[is_.name], dateStr, is_.name);
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
        source: sheetName,
        brand: String(brand || ""),
        itemName: String(itemName || ""),
        condition: String(getCellVal(ws, r, col.condition ?? -1) || ""),
        buyer: String(getCellVal(ws, r, col.buyer ?? -1) || ""),
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

  const sold = unique.filter((r) => !r.isReturned && r.saleAmount > 0);
  const profitRows = sold.filter((r) => r.purchase > 0);
  const returned = unique.filter((r) => r.isReturned);
  // 全商品 = 利益計算可能な商品 + 引き商品 (表示用)
  const allDisplayRows = [...profitRows, ...returned.filter((r) => r.purchase > 0)];

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
    items: allDisplayRows.map((r) => ({
      ...r,
      purchaseTax: Math.round(r.purchaseTax),
      saleTax: Math.round(r.saleTax),
      saleTaxIncl: Math.round(r.saleTaxIncl),
      profit: Math.round(r.profit),
    })),
  };
}

// ------- market configs -------
const MARKET_CONFIGS: Record<string, { baseDir: string; collector: (dir: string) => ProfitRow[] }> = {
  komehyo: { baseDir: "D:/JP Dropbox/バイヤー用/あご表/コメ兵", collector: collectKomehyoRows },
  taba:    { baseDir: "D:/JP Dropbox/バイヤー用/あご表/市場連盟", collector: collectTabaRows },
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get("market") || "komehyo";
  const config = MARKET_CONFIGS[market];

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

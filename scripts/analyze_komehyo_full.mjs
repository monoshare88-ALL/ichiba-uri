// コメ兵社内用ファイルの全解析
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const FOLDER = "D:/JP Dropbox/バイヤー用/あご表/コメ兵";

// ファイル名 (コメYYMMDD社内用.xlsx) から日付抽出
function parseDate(fname) {
  const m = fname.match(/コメ(\d{6})/);
  if (!m) return null;
  const s = m[1];
  const yy = parseInt(s.slice(0, 2), 10);
  const year = yy >= 50 ? 1900 + yy : 2000 + yy;
  const month = parseInt(s.slice(2, 4), 10);
  const day = parseInt(s.slice(4, 6), 10);
  return { year, month, day, iso: `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}` };
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[,¥\s]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function cellStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

// 1ファイルから整列済みシートの行を抽出
function extractSoldRows(filePath, dateInfo) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer" });

  // "整列済み" シートを優先、なければ "見やすい方"
  const sheetName =
    wb.SheetNames.find(s => s === "整列済み") ||
    wb.SheetNames.find(s => s === "見やすい方") ||
    wb.SheetNames[0];
  if (!sheetName) return { rows: [], sheet: null, error: "no sheets" };

  const ws = wb.Sheets[sheetName];
  if (!ws["!ref"]) return { rows: [], sheet: sheetName, error: "empty sheet" };

  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (data.length < 2) return { rows: [], sheet: sheetName, error: "too few rows" };

  // ヘッダー行検出
  let headerIdx = -1;
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const cells = data[i].map(c => cellStr(c));
    if (cells.includes("ブランド") && cells.includes("指値(円)")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { rows: [], sheet: sheetName, error: "no header detected" };

  const header = data[headerIdx].map(c => cellStr(c));
  const col = (name) => header.indexOf(name);

  const idxBoxNo = col("箱番、枝番");
  const idxLot = col("ロットNo");
  const idxListing = col("自社出品");
  const idxBrand = col("ブランド");
  const idxName = col("ブランド名");
  const idxAcc = col("付属品");
  const idxCondition = col("状態");
  const idxReserve = col("指値(円)");
  const idxBuyer = col("バイヤー");
  const idxPurchase = col("買値");
  const idxPurchaseTax = col("買値税込み");
  const idxItemNo = col("商品番号");
  const idxBuyer2 = col("バイヤー２");
  const idxSaleAmount = col("売り金額");
  const idxSaleAmountTax = col("税込み売り");
  const idxFee = col("手数料");
  const idxFeeTax = col("手数料税込み");
  const idxProfit = col("粗利");

  const rows = [];
  for (let r = headerIdx + 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.every(c => cellStr(c) === "")) continue;

    const brand = cellStr(row[idxBrand]);
    const itemName = cellStr(row[idxName]);
    const reserve = toNum(row[idxReserve]);
    const purchase = toNum(row[idxPurchase]);
    const purchaseTax = toNum(row[idxPurchaseTax]);
    const saleAmount = idxSaleAmount >= 0 ? toNum(row[idxSaleAmount]) : 0;
    const fee = idxFee >= 0 ? toNum(row[idxFee]) : 0;
    const profit = idxProfit >= 0 ? toNum(row[idxProfit]) : 0;
    const buyer = cellStr(row[idxBuyer]);
    const buyer2 = idxBuyer2 >= 0 ? cellStr(row[idxBuyer2]) : "";
    const condition = cellStr(row[idxCondition]);
    const itemNo = idxItemNo >= 0 ? cellStr(row[idxItemNo]) : "";

    if (!brand && !itemName && saleAmount === 0 && reserve === 0) continue;

    rows.push({
      date: dateInfo?.iso || "",
      year: dateInfo?.year || 0,
      month: dateInfo?.month || 0,
      boxNo: idxBoxNo >= 0 ? cellStr(row[idxBoxNo]) : "",
      lot: idxLot >= 0 ? cellStr(row[idxLot]) : "",
      listing: idxListing >= 0 ? cellStr(row[idxListing]) : "",
      brand,
      itemName,
      accessories: idxAcc >= 0 ? cellStr(row[idxAcc]) : "",
      condition,
      reserve,
      buyer: buyer2 || buyer,  // バイヤー2優先 (人名)
      buyerCode: buyer,
      purchase,
      purchaseTax,
      saleAmount,
      fee,
      profit,
      itemNo,
      sold: saleAmount > 0,
    });
  }
  return { rows, sheet: sheetName, error: null, headerIdx };
}

// ========== main ==========
const files = fs.readdirSync(FOLDER)
  .filter(f => /^コメ\d{6}社内用\.xlsx$/i.test(f))
  .sort();

console.log(`Target files: ${files.length}`);

const allRows = [];
const fileReport = [];
for (const f of files) {
  const date = parseDate(f);
  const full = path.join(FOLDER, f);
  try {
    const { rows, sheet, error, headerIdx } = extractSoldRows(full, date);
    fileReport.push({ file: f, date: date?.iso, sheet, headerIdx, rows: rows.length, error });
    for (const r of rows) allRows.push({ ...r, __file: f });
  } catch (e) {
    fileReport.push({ file: f, date: date?.iso, error: e.message });
  }
}

console.log("\n=== ファイル別取込結果 ===");
for (const r of fileReport) {
  console.log(
    `${(r.date || "????-??-??").padEnd(12)} | ${String(r.rows ?? "-").padStart(4)} rows | ${r.sheet || "-"} ${r.error ? "[ERR: " + r.error + "]" : ""}`
  );
}

const totalRows = allRows.length;
const soldRows = allRows.filter(r => r.sold);
const unsoldRows = allRows.filter(r => !r.sold);

console.log(`\n=== 概要 ===`);
console.log(`総登録件数:       ${totalRows.toLocaleString()}`);
console.log(`売れた件数:       ${soldRows.length.toLocaleString()} (${((soldRows.length/totalRows)*100).toFixed(1)}%)`);
console.log(`売れなかった件数: ${unsoldRows.length.toLocaleString()} (${((unsoldRows.length/totalRows)*100).toFixed(1)}%)`);

const sum = (arr, key) => arr.reduce((a, b) => a + (b[key] || 0), 0);
const totalReserve = sum(allRows, "reserve");
const totalPurchase = sum(allRows, "purchase");
const totalSale = sum(soldRows, "saleAmount");
const totalFee = sum(soldRows, "fee");
const totalProfit = sum(soldRows, "profit");

console.log(`\n=== 金額サマリ (税抜) ===`);
console.log(`総指値:       ¥${totalReserve.toLocaleString()}`);
console.log(`総仕入(買値): ¥${totalPurchase.toLocaleString()}`);
console.log(`総売上:       ¥${totalSale.toLocaleString()}`);
console.log(`総手数料:     ¥${totalFee.toLocaleString()}`);
console.log(`総粗利:       ¥${totalProfit.toLocaleString()}`);
const profitRate = totalPurchase > 0 ? (totalProfit / totalPurchase) * 100 : 0;
console.log(`粗利率(対仕入): ${profitRate.toFixed(1)}%`);

// ブランド別
const byBrand = {};
for (const r of allRows) {
  const b = (r.brand || "不明").trim() || "不明";
  if (!byBrand[b]) byBrand[b] = { count: 0, sold: 0, purchase: 0, sale: 0, profit: 0, reserve: 0 };
  const bb = byBrand[b];
  bb.count++;
  bb.reserve += r.reserve;
  bb.purchase += r.purchase;
  if (r.sold) {
    bb.sold++;
    bb.sale += r.saleAmount;
    bb.profit += r.profit;
  }
}

console.log(`\n=== ブランド別 (総売上TOP15) ===`);
const brandTop = Object.entries(byBrand)
  .sort((a, b) => b[1].sale - a[1].sale)
  .slice(0, 15);
console.log("ブランド".padEnd(20) + "件数".padStart(6) + "売れ".padStart(6) + "売上".padStart(14) + "粗利".padStart(14) + "粗利率");
for (const [b, s] of brandTop) {
  const rate = s.purchase > 0 ? ((s.profit / s.purchase) * 100).toFixed(1) + "%" : "-";
  console.log(
    b.padEnd(20) +
    String(s.count).padStart(6) +
    String(s.sold).padStart(6) +
    ("¥" + s.sale.toLocaleString()).padStart(14) +
    ("¥" + s.profit.toLocaleString()).padStart(14) +
    rate.padStart(8)
  );
}

// バイヤー別
const byBuyer = {};
for (const r of allRows) {
  const b = r.buyer.trim() || "(未設定)";
  if (!byBuyer[b]) byBuyer[b] = { count: 0, sold: 0, purchase: 0, sale: 0, profit: 0 };
  const bb = byBuyer[b];
  bb.count++;
  bb.purchase += r.purchase;
  if (r.sold) {
    bb.sold++;
    bb.sale += r.saleAmount;
    bb.profit += r.profit;
  }
}
console.log(`\n=== バイヤー別 (粗利順) ===`);
const buyerTop = Object.entries(byBuyer)
  .sort((a, b) => b[1].profit - a[1].profit)
  .slice(0, 15);
console.log("バイヤー".padEnd(14) + "件数".padStart(6) + "売れ".padStart(6) + "売上".padStart(14) + "粗利".padStart(14) + "粗利率");
for (const [b, s] of buyerTop) {
  const rate = s.purchase > 0 ? ((s.profit / s.purchase) * 100).toFixed(1) + "%" : "-";
  console.log(
    b.padEnd(14) +
    String(s.count).padStart(6) +
    String(s.sold).padStart(6) +
    ("¥" + s.sale.toLocaleString()).padStart(14) +
    ("¥" + s.profit.toLocaleString()).padStart(14) +
    rate.padStart(8)
  );
}

// 月別
const byMonth = {};
for (const r of allRows) {
  const key = r.date;
  if (!key) continue;
  if (!byMonth[key]) byMonth[key] = { count: 0, sold: 0, sale: 0, profit: 0, purchase: 0 };
  const m = byMonth[key];
  m.count++;
  m.purchase += r.purchase;
  if (r.sold) { m.sold++; m.sale += r.saleAmount; m.profit += r.profit; }
}
console.log(`\n=== 開催日別 (全期間) ===`);
console.log("日付".padEnd(12) + "件数".padStart(6) + "売れ".padStart(6) + "率".padStart(7) + "売上".padStart(14) + "粗利".padStart(14));
for (const [date, s] of Object.entries(byMonth).sort()) {
  const rate = s.count > 0 ? ((s.sold / s.count) * 100).toFixed(0) + "%" : "-";
  console.log(
    date.padEnd(12) +
    String(s.count).padStart(6) +
    String(s.sold).padStart(6) +
    rate.padStart(7) +
    ("¥" + s.sale.toLocaleString()).padStart(14) +
    ("¥" + s.profit.toLocaleString()).padStart(14)
  );
}

// 高額取引 TOP10
console.log(`\n=== 売上 TOP10 ===`);
const top10 = [...soldRows].sort((a, b) => b.saleAmount - a.saleAmount).slice(0, 10);
for (const r of top10) {
  console.log(
    `${r.date} ${r.brand.padEnd(12)} ${r.itemName.slice(0, 30).padEnd(30)} 売上:¥${r.saleAmount.toLocaleString().padStart(10)} 粗利:¥${r.profit.toLocaleString().padStart(10)}`
  );
}

// 粗利率 TOP10
console.log(`\n=== 粗利額 TOP10 ===`);
const topProfit = [...soldRows].sort((a, b) => b.profit - a.profit).slice(0, 10);
for (const r of topProfit) {
  const rate = r.purchase > 0 ? ((r.profit / r.purchase) * 100).toFixed(0) + "%" : "-";
  console.log(
    `${r.date} ${r.brand.padEnd(12)} ${r.itemName.slice(0, 28).padEnd(28)} 買値:¥${r.purchase.toLocaleString().padStart(9)} 売上:¥${r.saleAmount.toLocaleString().padStart(10)} 粗利:¥${r.profit.toLocaleString().padStart(10)} (${rate})`
  );
}

// 失敗 (大きな損失): 売れたけど粗利マイナス
console.log(`\n=== 損失 TOP10 (売れたが赤字) ===`);
const loss = soldRows.filter(r => r.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 10);
if (loss.length === 0) {
  console.log("なし");
} else {
  for (const r of loss) {
    console.log(
      `${r.date} ${r.brand.padEnd(12)} ${r.itemName.slice(0, 28).padEnd(28)} 買値:¥${r.purchase.toLocaleString().padStart(9)} 売上:¥${r.saleAmount.toLocaleString().padStart(10)} 粗利:¥${r.profit.toLocaleString().padStart(10)}`
    );
  }
}

// 未売却だった高額品 (指値が高いが売れず)
console.log(`\n=== 売れ残り 指値TOP10 (回収機会損失) ===`);
const unsoldTop = [...unsoldRows]
  .filter(r => r.reserve > 0)
  .sort((a, b) => b.reserve - a.reserve).slice(0, 10);
for (const r of unsoldTop) {
  console.log(
    `${r.date} ${r.brand.padEnd(12)} ${r.itemName.slice(0, 30).padEnd(30)} 指値:¥${r.reserve.toLocaleString().padStart(10)} 買値:¥${r.purchase.toLocaleString().padStart(10)}`
  );
}

// 総計レポート
console.log(`\n=== 最終レポート ===`);
console.log(`解析対象期間: ${Object.keys(byMonth).sort()[0]} 〜 ${Object.keys(byMonth).sort().slice(-1)[0]}`);
console.log(`開催回数:     ${Object.keys(byMonth).length}`);
console.log(`ブランド種類: ${Object.keys(byBrand).length}`);
console.log(`バイヤー種類: ${Object.keys(byBuyer).length}`);

// CSV で書き出し
const csvPath = path.join(FOLDER, "_analysis_all_rows.csv");
const csvHeader = "date,boxNo,listing,brand,itemName,condition,reserve,buyer,purchase,saleAmount,fee,profit,sold,itemNo,file";
const csvRows = allRows.map(r =>
  [
    r.date,
    r.boxNo,
    r.listing,
    (r.brand || "").replace(/"/g, '""'),
    (r.itemName || "").replace(/,/g, " "),
    (r.condition || "").replace(/,/g, " ").replace(/\n/g, " "),
    r.reserve,
    r.buyer,
    r.purchase,
    r.saleAmount,
    r.fee,
    r.profit,
    r.sold ? 1 : 0,
    r.itemNo,
    r.__file,
  ].join(",")
).join("\n");
fs.writeFileSync(csvPath, csvHeader + "\n" + csvRows, "utf-8");
console.log(`\n全行CSV: ${csvPath}`);

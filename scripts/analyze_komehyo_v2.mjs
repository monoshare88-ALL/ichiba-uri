// コメ兵社内用ファイルの全解析 v2 - 柔軟なシート・列検出
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const FOLDER = "D:/JP Dropbox/バイヤー用/あご表/コメ兵";

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

// ブランド名正規化 (表記揺れを吸収)
function normalizeBrand(raw) {
  const s = raw.trim();
  if (!s) return "不明";
  const lower = s.toLowerCase();
  if (/lv|vuitton|ヴィトン|ルイ/i.test(s)) return "LOUIS VUITTON";
  if (/chanel|シャネル/i.test(s)) return "CHANEL";
  if (/hermes|エルメス|hermès/i.test(s)) return "HERMES";
  if (/gucci|グッチ/i.test(s)) return "GUCCI";
  if (/celine|セリーヌ/i.test(s)) return "CELINE";
  if (/dior|ディオール/i.test(s)) return "DIOR";
  if (/prada|プラダ/i.test(s)) return "PRADA";
  if (/fendi|フェンディ/i.test(s)) return "FENDI";
  if (/bottega|ボッテガ/i.test(s)) return "BOTTEGA VENETA";
  if (/tiffany|ティファニー/i.test(s)) return "TIFFANY";
  if (/cartier|カルティエ/i.test(s)) return "CARTIER";
  if (/balenciaga|バレンシアガ/i.test(s)) return "BALENCIAGA";
  if (/saint.?laurent|ysl|イヴサンローラン|サンローラン/i.test(s)) return "SAINT LAURENT";
  if (/loewe|ロエベ/i.test(s)) return "LOEWE";
  if (/miu.?miu|ミュウミュウ/i.test(s)) return "MIU MIU";
  if (/bv|ボッテガ/i.test(s)) return "BOTTEGA VENETA";
  return s.toUpperCase();
}

// ヘッダー→標準フィールドのマッピング
const HEADER_MAP = {
  brand: ["ブランド"],
  itemName: ["ブランド名", "品名", "商品名", "モデル名"],
  reserve: ["指値(円)", "指値", "入札"],
  purchase: ["買値"],
  purchaseTax: ["買値税込み", "税込み"],
  saleAmount: ["売り金額", "成立金額"],
  fee: ["手数料", "販売手数料"],
  profit: ["粗利"],
  buyer1: ["バイヤー"],
  buyer2: ["バイヤー２", "バイヤー2"],
  boxNo: ["箱番、枝番", "箱番"],
  lot: ["ロットNo"],
  listing: ["自社出品"],
  condition: ["状態"],
  itemNo: ["商品番号", "番号"],
  accessories: ["付属品"],
};

function findHeaderRow(sheetData) {
  // ブランド and 売り金額/成立金額/粗利 のいずれかを含む行がある
  for (let i = 0; i < Math.min(8, sheetData.length); i++) {
    const cells = sheetData[i].map(c => cellStr(c));
    const hasBrand = cells.includes("ブランド");
    const hasSalesCol = cells.some(c => ["売り金額", "成立金額", "粗利"].includes(c));
    if (hasBrand && hasSalesCol) return i;
  }
  return -1;
}

function buildColMap(headerRow) {
  const cells = headerRow.map(c => cellStr(c));
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_MAP)) {
    for (const alias of aliases) {
      const idx = cells.indexOf(alias);
      if (idx >= 0) {
        map[field] = idx;
        break;
      }
    }
    // バイヤー1と2で同名あり → 最初と2回目を別々に取る
  }
  // 「バイヤー」が2回出る場合は2番目を buyer2 に割り当て
  if (!map.buyer2) {
    const positions = [];
    cells.forEach((c, i) => { if (c === "バイヤー") positions.push(i); });
    if (positions.length >= 2) {
      map.buyer1 = positions[0];
      map.buyer2 = positions[1];
    }
  }
  return map;
}

function extractFromSheet(ws, dateInfo, sheetName) {
  if (!ws["!ref"]) return null;
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (data.length < 2) return null;

  const headerIdx = findHeaderRow(data);
  if (headerIdx < 0) return null;

  const col = buildColMap(data[headerIdx]);
  if (col.brand === undefined) return null;

  const rows = [];
  for (let r = headerIdx + 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.every(c => cellStr(c) === "")) continue;

    const brand = cellStr(row[col.brand]);
    const itemName = col.itemName !== undefined ? cellStr(row[col.itemName]) : "";
    const reserve = col.reserve !== undefined ? toNum(row[col.reserve]) : 0;
    const purchase = col.purchase !== undefined ? toNum(row[col.purchase]) : 0;
    const saleAmount = col.saleAmount !== undefined ? toNum(row[col.saleAmount]) : 0;
    const fee = col.fee !== undefined ? toNum(row[col.fee]) : 0;
    const profit = col.profit !== undefined ? toNum(row[col.profit]) : 0;
    const buyer1 = col.buyer1 !== undefined ? cellStr(row[col.buyer1]) : "";
    const buyer2 = col.buyer2 !== undefined ? cellStr(row[col.buyer2]) : "";
    const condition = col.condition !== undefined ? cellStr(row[col.condition]) : "";

    // 完全空行をスキップ
    if (!brand && !itemName && reserve === 0 && purchase === 0 && saleAmount === 0) continue;

    rows.push({
      date: dateInfo?.iso || "",
      year: dateInfo?.year || 0,
      month: dateInfo?.month || 0,
      sheet: sheetName,
      brand: normalizeBrand(brand),
      rawBrand: brand,
      itemName,
      condition,
      reserve,
      purchase,
      saleAmount,
      fee,
      profit,
      buyer: buyer2 || buyer1,
      sold: saleAmount > 0,
    });
  }
  return rows.length > 0 ? rows : null;
}

// 優先度順にシートを試す
function extractFromFile(filePath, dateInfo) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer" });

  const priority = [
    "整列済み",
    "見やすい方 (2)",
    "原本",
    "見やすい方",
  ];

  // 優先シートを順に試す
  for (const name of priority) {
    if (wb.SheetNames.includes(name)) {
      const rows = extractFromSheet(wb.Sheets[name], dateInfo, name);
      if (rows && rows.length > 0) return { rows, sheet: name };
    }
  }

  // フォールバック: どのシートでも検出できる最初のもの
  for (const sn of wb.SheetNames) {
    if (priority.includes(sn)) continue;
    if (/^\(/.test(sn)) continue; // 括弧付き重複
    const rows = extractFromSheet(wb.Sheets[sn], dateInfo, sn);
    if (rows && rows.length > 0) return { rows, sheet: sn };
  }

  return { rows: [], sheet: null };
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
    const { rows, sheet } = extractFromFile(full, date);
    fileReport.push({ file: f, date: date?.iso, sheet, rows: rows.length });
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
const totalPurchase = sum(soldRows, "purchase");
const totalSale = sum(soldRows, "saleAmount");
const totalFee = sum(soldRows, "fee");
const totalProfit = sum(soldRows, "profit");
const profitRate = totalPurchase > 0 ? (totalProfit / totalPurchase) * 100 : 0;

console.log(`\n=== 金額サマリ (売れた行のみ、税抜) ===`);
console.log(`総仕入(買値): ¥${totalPurchase.toLocaleString()}`);
console.log(`総売上:       ¥${totalSale.toLocaleString()}`);
console.log(`総手数料:     ¥${totalFee.toLocaleString()}`);
console.log(`総粗利:       ¥${totalProfit.toLocaleString()}`);
console.log(`粗利率:       ${profitRate.toFixed(1)}%`);
console.log(`総指値(全行): ¥${totalReserve.toLocaleString()}`);

// ブランド別 (売上のあるものだけ)
const byBrand = {};
for (const r of allRows) {
  const b = r.brand;
  if (!byBrand[b]) byBrand[b] = { count: 0, sold: 0, purchase: 0, sale: 0, profit: 0, reserve: 0 };
  const bb = byBrand[b];
  bb.count++;
  bb.reserve += r.reserve;
  if (r.sold) {
    bb.sold++;
    bb.sale += r.saleAmount;
    bb.purchase += r.purchase;
    bb.profit += r.profit;
  }
}

console.log(`\n=== ブランド別 (売上TOP20) ===`);
const brandTop = Object.entries(byBrand)
  .sort((a, b) => b[1].sale - a[1].sale)
  .slice(0, 20);
console.log("ブランド".padEnd(18) + "出品".padStart(6) + "売れ".padStart(6) + "率".padStart(6) + "売上".padStart(14) + "粗利".padStart(14) + "粗利率");
for (const [b, s] of brandTop) {
  const sellRate = s.count > 0 ? ((s.sold / s.count) * 100).toFixed(0) + "%" : "-";
  const profitRate = s.purchase > 0 ? ((s.profit / s.purchase) * 100).toFixed(0) + "%" : "-";
  console.log(
    b.padEnd(18) +
    String(s.count).padStart(6) +
    String(s.sold).padStart(6) +
    sellRate.padStart(6) +
    ("¥" + s.sale.toLocaleString()).padStart(14) +
    ("¥" + s.profit.toLocaleString()).padStart(14) +
    profitRate.padStart(8)
  );
}

// バイヤー別
const byBuyer = {};
for (const r of allRows) {
  const b = r.buyer.trim() || "(未設定)";
  if (!byBuyer[b]) byBuyer[b] = { count: 0, sold: 0, purchase: 0, sale: 0, profit: 0 };
  const bb = byBuyer[b];
  bb.count++;
  if (r.sold) {
    bb.sold++;
    bb.sale += r.saleAmount;
    bb.purchase += r.purchase;
    bb.profit += r.profit;
  }
}
console.log(`\n=== バイヤー別 (粗利順TOP15) ===`);
const buyerTop = Object.entries(byBuyer)
  .sort((a, b) => b[1].profit - a[1].profit)
  .slice(0, 15);
console.log("バイヤー".padEnd(14) + "出品".padStart(6) + "売れ".padStart(6) + "率".padStart(6) + "売上".padStart(14) + "粗利".padStart(14) + "粗利率");
for (const [b, s] of buyerTop) {
  const sellRate = s.count > 0 ? ((s.sold / s.count) * 100).toFixed(0) + "%" : "-";
  const pr = s.purchase > 0 ? ((s.profit / s.purchase) * 100).toFixed(0) + "%" : "-";
  console.log(
    b.padEnd(14) +
    String(s.count).padStart(6) +
    String(s.sold).padStart(6) +
    sellRate.padStart(6) +
    ("¥" + s.sale.toLocaleString()).padStart(14) +
    ("¥" + s.profit.toLocaleString()).padStart(14) +
    pr.padStart(8)
  );
}

// 月別 (sold only)
const byDate = {};
for (const r of allRows) {
  const key = r.date;
  if (!key) continue;
  if (!byDate[key]) byDate[key] = { count: 0, sold: 0, sale: 0, profit: 0, purchase: 0 };
  const m = byDate[key];
  m.count++;
  if (r.sold) { m.sold++; m.sale += r.saleAmount; m.profit += r.profit; m.purchase += r.purchase; }
}

console.log(`\n=== 開催日別 (売上があった回のみ) ===`);
console.log("日付".padEnd(12) + "出品".padStart(6) + "売れ".padStart(6) + "率".padStart(6) + "売上".padStart(14) + "粗利".padStart(14) + "粗利率");
const sortedDates = Object.entries(byDate).sort();
for (const [date, s] of sortedDates) {
  if (s.sold === 0) continue;
  const sellRate = ((s.sold / s.count) * 100).toFixed(0) + "%";
  const pr = s.purchase > 0 ? ((s.profit / s.purchase) * 100).toFixed(0) + "%" : "-";
  console.log(
    date.padEnd(12) +
    String(s.count).padStart(6) +
    String(s.sold).padStart(6) +
    sellRate.padStart(6) +
    ("¥" + s.sale.toLocaleString()).padStart(14) +
    ("¥" + s.profit.toLocaleString()).padStart(14) +
    pr.padStart(8)
  );
}

// 売上 TOP10
console.log(`\n=== 売上 TOP10 ===`);
const top10 = [...soldRows].sort((a, b) => b.saleAmount - a.saleAmount).slice(0, 10);
for (const r of top10) {
  console.log(
    `${r.date} ${r.brand.padEnd(14)} ${(r.itemName || "").slice(0, 32).padEnd(32)} 売:¥${String(r.saleAmount.toLocaleString()).padStart(9)} 粗:¥${String(r.profit.toLocaleString()).padStart(9)}`
  );
}

// 粗利 TOP10
console.log(`\n=== 粗利 TOP10 ===`);
const topProfit = [...soldRows].sort((a, b) => b.profit - a.profit).slice(0, 10);
for (const r of topProfit) {
  const rate = r.purchase > 0 ? ((r.profit / r.purchase) * 100).toFixed(0) + "%" : "-";
  console.log(
    `${r.date} ${r.brand.padEnd(14)} ${(r.itemName || "").slice(0, 28).padEnd(28)} 買:¥${String(r.purchase.toLocaleString()).padStart(8)} 売:¥${String(r.saleAmount.toLocaleString()).padStart(9)} 粗:¥${String(r.profit.toLocaleString()).padStart(9)} ${rate.padStart(5)}`
  );
}

// 損失 (売れたが粗利マイナス)
const losses = soldRows.filter(r => r.profit < 0).sort((a, b) => a.profit - b.profit);
console.log(`\n=== 赤字成約 (売れたが粗利マイナス) ${losses.length}件中 TOP10 ===`);
for (const r of losses.slice(0, 10)) {
  console.log(
    `${r.date} ${r.brand.padEnd(14)} ${(r.itemName || "").slice(0, 28).padEnd(28)} 買:¥${String(r.purchase.toLocaleString()).padStart(8)} 売:¥${String(r.saleAmount.toLocaleString()).padStart(9)} 粗:¥${String(r.profit.toLocaleString()).padStart(9)}`
  );
}

// 売れ残りTOP10 (指値高)
console.log(`\n=== 売れ残り 指値TOP10 (機会損失) ===`);
const unsoldTop = [...unsoldRows]
  .filter(r => r.reserve > 0 && r.brand !== "不明")
  .sort((a, b) => b.reserve - a.reserve).slice(0, 10);
for (const r of unsoldTop) {
  console.log(
    `${r.date} ${r.brand.padEnd(14)} ${(r.itemName || "").slice(0, 32).padEnd(32)} 指値:¥${String(r.reserve.toLocaleString()).padStart(10)}`
  );
}

// 指値 vs 実売上の乖離分析 (売れたもの)
console.log(`\n=== 指値と実売上の乖離 (売れた行、差額TOP10) ===`);
const withDiff = soldRows.filter(r => r.reserve > 0 && r.saleAmount > 0)
  .map(r => ({ ...r, diff: r.saleAmount - r.reserve, diffRate: (r.saleAmount / r.reserve) }));

console.log("  指値より高く売れたTOP5:");
const over = [...withDiff].sort((a, b) => b.diff - a.diff).slice(0, 5);
for (const r of over) {
  console.log(
    `  ${r.date} ${r.brand.padEnd(14)} ${(r.itemName || "").slice(0, 24).padEnd(24)} 指:¥${String(r.reserve.toLocaleString()).padStart(8)} 売:¥${String(r.saleAmount.toLocaleString()).padStart(9)} +¥${String(r.diff.toLocaleString()).padStart(8)} (${(r.diffRate*100).toFixed(0)}%)`
  );
}
console.log("  指値を大きく割ったTOP5:");
const under = [...withDiff].sort((a, b) => a.diff - b.diff).slice(0, 5);
for (const r of under) {
  console.log(
    `  ${r.date} ${r.brand.padEnd(14)} ${(r.itemName || "").slice(0, 24).padEnd(24)} 指:¥${String(r.reserve.toLocaleString()).padStart(8)} 売:¥${String(r.saleAmount.toLocaleString()).padStart(9)} ${String(r.diff.toLocaleString()).padStart(10)} (${(r.diffRate*100).toFixed(0)}%)`
  );
}

// CSV 書き出し
const csvPath = path.join(FOLDER, "_analysis_v2.csv");
const csvHeader = "date,sheet,brand,rawBrand,itemName,condition,reserve,buyer,purchase,saleAmount,fee,profit,sold,file";
const csvRows = allRows.map(r =>
  [
    r.date,
    r.sheet,
    `"${(r.brand || "").replace(/"/g, '""')}"`,
    `"${(r.rawBrand || "").replace(/"/g, '""')}"`,
    `"${(r.itemName || "").replace(/"/g, '""').replace(/\n/g, " ")}"`,
    `"${(r.condition || "").replace(/"/g, '""').replace(/\n/g, " ")}"`,
    r.reserve,
    `"${r.buyer}"`,
    r.purchase,
    r.saleAmount,
    r.fee,
    r.profit,
    r.sold ? 1 : 0,
    `"${r.__file}"`,
  ].join(",")
).join("\n");
fs.writeFileSync(csvPath, csvHeader + "\n" + csvRows, "utf-8");
console.log(`\n全行CSV: ${csvPath}`);

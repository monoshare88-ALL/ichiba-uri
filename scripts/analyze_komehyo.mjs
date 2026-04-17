// 過去のコメ兵あご表データを解析するスクリプト
// 使い方: node scripts/analyze_komehyo.mjs
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const FOLDER = "D:/JP Dropbox/バイヤー用/あご表/コメ兵";

function readRow(ws, rowIdx) {
  const row = [];
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
    const cell = ws[addr];
    row.push(cell ? cell.v : "");
  }
  return row;
}

function inspectFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheets = [];
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws["!ref"]) {
      sheets.push({ name: sn, rowCount: 0, cols: 0, headers: [] });
      continue;
    }
    const range = XLSX.utils.decode_range(ws["!ref"]);
    // ヘッダー候補: 最初の5行
    const headerCandidates = [];
    for (let r = range.s.r; r <= Math.min(range.s.r + 4, range.e.r); r++) {
      const row = readRow(ws, r);
      headerCandidates.push(row.map(c => String(c ?? "").trim()));
    }
    sheets.push({
      name: sn,
      rowCount: range.e.r - range.s.r + 1,
      cols: range.e.c - range.s.c + 1,
      headerCandidates,
    });
  }
  return sheets;
}

const files = fs.readdirSync(FOLDER)
  .filter(f => f.toLowerCase().endsWith(".xlsx"))
  .sort();

console.log(`Total files: ${files.length}\n`);

// 最初の3ファイル (2つの系統を代表) の構造を詳しく見る
const inspectTargets = [
  files.find(f => f.startsWith("JP.company") && f.includes("241211")),
  files.find(f => f.startsWith("コメ2412")),
  files.find(f => f === "ご返却商品明細 (1).xlsx"),
  files.find(f => f.includes("出品商品登録")),
].filter(Boolean);

for (const fname of inspectTargets) {
  const fpath = path.join(FOLDER, fname);
  console.log("=".repeat(80));
  console.log("FILE:", fname);
  try {
    const sheets = inspectFile(fpath);
    for (const s of sheets) {
      console.log(`  Sheet: "${s.name}"  (rows=${s.rowCount}, cols=${s.cols})`);
      s.headerCandidates?.forEach((row, i) => {
        const nonEmpty = row.filter(c => c.length > 0);
        if (nonEmpty.length === 0) return;
        console.log(`    r${i}: [${row.slice(0, 20).map(c => c.length > 20 ? c.slice(0, 20) + "…" : c).join(" | ")}]`);
      });
    }
  } catch (e) {
    console.log("  ERROR:", e.message);
  }
  console.log();
}

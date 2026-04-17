// 各ファイルの全シートを調べ、売り金額・粗利 列がどこにあるかを特定
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const FOLDER = "D:/JP Dropbox/バイヤー用/あご表/コメ兵";

function cellStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

const files = fs.readdirSync(FOLDER)
  .filter(f => /^コメ\d{6}社内用\.xlsx$/i.test(f))
  .sort();

const keyHeaders = ["売り金額", "粗利", "手数料", "税込み売り"];

for (const f of files) {
  const full = path.join(FOLDER, f);
  const buf = fs.readFileSync(full);
  const wb = XLSX.read(buf, { type: "buffer" });

  console.log(`\n## ${f}`);
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws["!ref"]) { console.log(`  - ${sn}: (empty)`); continue; }
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const dataRows = range.e.r - range.s.r + 1;

    // ヘッダー行候補 (最初の6行のうち keyHeaders がある行を探す)
    let matchedRow = -1;
    let matchedHeaders = [];
    for (let i = 0; i < Math.min(8, data.length); i++) {
      const cells = data[i].map(c => cellStr(c));
      const hits = keyHeaders.filter(k => cells.includes(k));
      if (hits.length > matchedHeaders.length) {
        matchedRow = i;
        matchedHeaders = hits;
      }
    }

    console.log(`  - ${sn}: rows=${dataRows}, headerRow=${matchedRow}, salesKeys=[${matchedHeaders.join(", ")}]`);
    if (matchedRow >= 0) {
      const cells = data[matchedRow].map(c => cellStr(c));
      console.log(`    header: [${cells.filter(c => c.length > 0).join(" | ")}]`);
    }
  }
}

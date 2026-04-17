"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { COLUMN_FIELDS, DEFAULT_FORMAT_COLUMNS } from "@/lib/columnFields";
import type { ColumnDef, ColumnFieldType, MarketFormat, FormatType } from "@/app/api/settings/route";

interface BuyerEntry {
  id: string;
  code: string;
  name: string;
}

interface ColumnEntry {
  id: string;
  header: string;
  field: ColumnFieldType;
  fixedValue: string;
  width: string;
}

interface FormatTemplateState {
  columns: ColumnEntry[];
  sourceFile?: string;
  name?: string;
}

interface MarketFormatState {
  internal: FormatTemplateState;
  submission: FormatTemplateState;
  salesImport: FormatTemplateState;
}

interface AppSettings {
  market?: string;
  buyerMap?: Record<string, string>;
  marketFormats?: Record<string, MarketFormat>;
  taxRate?: number;
}

/** FormatType ("sales_import") → MarketFormatState キー ("salesImport") への変換 */
const formatTypeToKey = (t: FormatType): keyof MarketFormatState =>
  t === "sales_import" ? "salesImport" : t;

const emptyTemplate = (): FormatTemplateState => ({ columns: [], sourceFile: undefined, name: "" });
const emptyMarketFormat = (): MarketFormatState => ({
  internal: emptyTemplate(),
  submission: emptyTemplate(),
  salesImport: emptyTemplate(),
});

const FORMAT_TYPE_LABEL: Record<FormatType, string> = {
  internal: "① 社内用",
  submission: "② あご表 (提出用)",
  sales_import: "③ 売上取込",
};

const SALES_IMPORT_DEFAULT_COLUMNS = [
  { header: "出品番号",  field: "LISTING_NUMBER" as ColumnFieldType, width: 12 },
  { header: "商品番号",  field: "ITEM_NUMBER"    as ColumnFieldType, width: 12 },
  { header: "売り金額",  field: "SALE_AMOUNT"    as ColumnFieldType, width: 12 },
  { header: "手数料",    field: "FEE"            as ColumnFieldType, width: 12 },
];

export default function SettingsPage() {
  const [market, setMarket] = useState("");
  const [taxRate, setTaxRate] = useState<string>("10");
  const [buyers, setBuyers] = useState<BuyerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string>("");
  const [csvText, setCsvText] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");

  // 市場別Excel形式 (社内用/提出用)
  const [marketFormats, setMarketFormats] = useState<Record<string, MarketFormatState>>({});
  const [editingMarket, setEditingMarket] = useState<string>("");
  const [editingType, setEditingType] = useState<FormatType>("internal");
  const [parsing, setParsing] = useState(false);

  // 起動時に設定を読み込み
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        const s: AppSettings = data.settings || {};
        setMarket(s.market || "");
        setTaxRate(
          s.taxRate === undefined || s.taxRate === null ? "10" : String(s.taxRate)
        );
        const map = s.buyerMap || {};
        const entries = Object.entries(map).map(([code, name]) => ({
          id: crypto.randomUUID(),
          code,
          name,
        }));
        if (entries.length === 0) {
          entries.push({ id: crypto.randomUUID(), code: "", name: "" });
        }
        setBuyers(entries);

        // 市場別Excel形式 (新形式: internal/submission)
        const formats = s.marketFormats || {};
        const formatsState: Record<string, MarketFormatState> = {};
        const colDefToEntry = (c: ColumnDef): ColumnEntry => ({
          id: crypto.randomUUID(),
          header: c.header,
          field: c.field,
          fixedValue: c.fixedValue || "",
          width: c.width ? String(c.width) : "",
        });
        for (const [marketName, fmt] of Object.entries(formats)) {
          const ms = emptyMarketFormat();
          if (fmt.internal?.columns) {
            ms.internal = {
              columns: fmt.internal.columns.map(colDefToEntry),
              sourceFile: fmt.internal.sourceFile,
              name: fmt.internal.name || "",
            };
          }
          if (fmt.submission?.columns) {
            ms.submission = {
              columns: fmt.submission.columns.map(colDefToEntry),
              sourceFile: fmt.submission.sourceFile,
              name: fmt.submission.name || "",
            };
          }
          if (fmt.salesImport?.columns) {
            ms.salesImport = {
              columns: fmt.salesImport.columns.map(colDefToEntry),
              sourceFile: fmt.salesImport.sourceFile,
              name: fmt.salesImport.name || "",
            };
          }
          // 旧形式 (columns直下) を internal に移行
          if (!fmt.internal && !fmt.submission && !fmt.salesImport && fmt.columns) {
            ms.internal = { columns: fmt.columns.map(colDefToEntry) };
          }
          formatsState[marketName] = ms;
        }
        setMarketFormats(formatsState);

        // 編集対象の市場: 設定中の市場名 > 既存形式の最初 > 空
        const initial = s.market || Object.keys(formatsState)[0] || "";
        setEditingMarket(initial);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 編集中市場の MarketFormatState を取得 (なければ空オブジェクトを返す)
  const editingMarketFormat: MarketFormatState =
    marketFormats[editingMarket] || emptyMarketFormat();
  const editingTemplate: FormatTemplateState = editingMarketFormat[formatTypeToKey(editingType)] || emptyTemplate();
  const editingColumns = editingTemplate.columns;

  const setEditingTemplate = (patch: Partial<FormatTemplateState>) => {
    setMarketFormats(prev => {
      const ms = prev[editingMarket] || emptyMarketFormat();
      const key = formatTypeToKey(editingType);
      const tpl = ms[key] || emptyTemplate();
      return {
        ...prev,
        [editingMarket]: {
          ...ms,
          [key]: { ...tpl, ...patch },
        },
      };
    });
  };

  const setEditingColumns = (cols: ColumnEntry[]) => setEditingTemplate({ columns: cols });

  const addColumn = () => {
    const newCol: ColumnEntry = {
      id: crypto.randomUUID(),
      header: "",
      field: "EMPTY",
      fixedValue: "",
      width: "",
    };
    setEditingColumns([...editingColumns, newCol]);
  };

  const removeColumn = (id: string) => {
    setEditingColumns(editingColumns.filter(c => c.id !== id));
  };

  const updateColumn = (id: string, patch: Partial<ColumnEntry>) => {
    setEditingColumns(editingColumns.map(c => (c.id === id ? { ...c, ...patch } : c)));
  };

  const moveColumn = (id: string, dir: -1 | 1) => {
    const idx = editingColumns.findIndex(c => c.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= editingColumns.length) return;
    const next = [...editingColumns];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setEditingColumns(next);
  };

  const loadDefaultColumns = () => {
    if (!editingMarket) {
      alert("先に市場名を選択/入力してください");
      return;
    }
    if (editingColumns.length > 0 && !confirm("現在の列定義をデフォルトで上書きしますか？")) return;
    const defs: ColumnEntry[] = DEFAULT_FORMAT_COLUMNS.map(c => ({
      id: crypto.randomUUID(),
      header: c.header,
      field: c.field,
      fixedValue: "",
      width: c.width ? String(c.width) : "",
    }));
    setEditingColumns(defs);
  };

  const loadSalesImportDefaults = () => {
    if (!editingMarket) {
      alert("先に市場名を選択/入力してください");
      return;
    }
    if (editingColumns.length > 0 && !confirm("現在の列定義をデフォルト (出品番号/商品番号/売り金額/手数料) で上書きしますか？")) return;
    const defs: ColumnEntry[] = SALES_IMPORT_DEFAULT_COLUMNS.map(c => ({
      id: crypto.randomUUID(),
      header: c.header,
      field: c.field,
      fixedValue: "",
      width: c.width ? String(c.width) : "",
    }));
    setEditingColumns(defs);
  };

  const addNewMarket = () => {
    const name = prompt("新しい市場名を入力してください (例: コメ兵)");
    if (!name) return;
    if (marketFormats[name]) {
      alert("既に存在する市場名です");
      setEditingMarket(name);
      return;
    }
    setMarketFormats(prev => ({ ...prev, [name]: emptyMarketFormat() }));
    setEditingMarket(name);
  };

  const deleteMarketFormat = () => {
    if (!editingMarket) return;
    if (!confirm(`市場「${editingMarket}」のExcel形式 (社内用・提出用とも) を削除しますか？`)) return;
    setMarketFormats(prev => {
      const next = { ...prev };
      delete next[editingMarket];
      return next;
    });
    const remaining = Object.keys(marketFormats).filter(k => k !== editingMarket);
    setEditingMarket(remaining[0] || "");
  };

  // テンプレートExcelをアップロード→Supabaseに保存→列構造を取得して反映
  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!editingMarket) {
      alert("先に市場を選択してください");
      e.target.value = "";
      return;
    }
    if (editingColumns.length > 0 && !confirm("現在の列定義をテンプレートで上書きしますか？\n（アップロードしたExcelファイル本体もSupabaseに保存され、出力時にこのファイルへ追記されます）")) {
      e.target.value = "";
      return;
    }

    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("market", editingMarket);
      fd.append("formatType", editingType);
      const res = await fetch("/api/format/template", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        alert(`解析・保存失敗: ${data.error}`);
        return;
      }
      const cols: ColumnEntry[] = (data.columns || []).map((c: { header: string; field: ColumnFieldType; width?: number }) => ({
        id: crypto.randomUUID(),
        header: c.header,
        field: c.field,
        fixedValue: "",
        width: c.width ? String(c.width) : "",
      }));
      setEditingTemplate({ columns: cols, sourceFile: file.name });
      alert(
        `テンプレート保存完了\n` +
          `ファイル: ${file.name} (${(data.fileSize / 1024).toFixed(1)} KB)\n` +
          `シート: ${data.sheetName}\n` +
          `ヘッダー行: ${data.headerRow}行目\n` +
          `列数: ${cols.length}\n` +
          `自動マッピング: ${data.detectedCount} 列\n\n` +
          `※ 提出用Excel出力時、このテンプレートにデータが追記されます。\n` +
          `※ 設定保存ボタンを押して列マッピングも保存してください。`
      );
    } catch (err) {
      alert(`エラー: ${err}`);
    } finally {
      setParsing(false);
      e.target.value = "";
    }
  };

  // 保存済みテンプレートを削除
  const handleDeleteTemplate = async () => {
    if (!editingMarket) return;
    if (!confirm(`市場「${editingMarket}」の${FORMAT_TYPE_LABEL[editingType]}テンプレートExcelを削除しますか？\n（列マッピングは残ります）`)) return;
    try {
      const res = await fetch(
        `/api/format/template?market=${encodeURIComponent(editingMarket)}&formatType=${editingType}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setEditingTemplate({ sourceFile: undefined });
        alert("テンプレートExcelを削除しました");
      } else {
        const err = await res.json();
        alert(`削除失敗: ${err.error}`);
      }
    } catch (err) {
      alert(`エラー: ${err}`);
    }
  };

  const addBuyerRow = () => {
    setBuyers(prev => [...prev, { id: crypto.randomUUID(), code: "", name: "" }]);
  };

  const removeBuyerRow = (id: string) => {
    setBuyers(prev => prev.filter(b => b.id !== id));
  };

  const updateBuyer = (id: string, patch: Partial<BuyerEntry>) => {
    setBuyers(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
  };

  /**
   * CSV/テキストをパースしてバイヤー一覧を更新
   * 受け付ける形式 (1行1ペア):
   *   UU,坂巻
   *   UU=坂巻
   *   "UU"="坂巻"
   *   UU 坂巻       (タブ区切り)
   *   UU、坂巻      (全角カンマ)
   * 引用符・前後空白・全角=・全角""は除去
   */
  const parseCsvText = (text: string): { code: string; name: string }[] => {
    const lines = text.split(/\r?\n/);
    const result: { code: string; name: string }[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;

      // 区切り文字: , = タブ 、 全角=
      const parts = line.split(/[,=\t、]|=/u).map(s =>
        s.trim().replace(/^["'「」『』]+|["'「」『』]+$/g, "")
      );

      const code = parts[0]?.trim() || "";
      const name = parts[1]?.trim() || "";
      if (code) result.push({ code, name });
    }
    return result;
  };

  const importCsv = (text: string) => {
    const parsed = parseCsvText(text);
    if (parsed.length === 0) {
      alert("有効なバイヤー定義が見つかりませんでした");
      return;
    }

    if (importMode === "replace") {
      setBuyers(parsed.map(p => ({ id: crypto.randomUUID(), ...p })));
    } else {
      // merge: 既存codeは新しい名前で上書き、新規codeは追加
      setBuyers(prev => {
        const map = new Map<string, BuyerEntry>();
        for (const b of prev) {
          if (b.code.trim()) map.set(b.code.trim(), b);
        }
        for (const p of parsed) {
          const existing = map.get(p.code);
          if (existing) {
            map.set(p.code, { ...existing, name: p.name });
          } else {
            map.set(p.code, { id: crypto.randomUUID(), code: p.code, name: p.name });
          }
        }
        return Array.from(map.values());
      });
    }
    alert(`${parsed.length}件をインポートしました (${importMode === "replace" ? "全置換" : "追記マージ"})\n「設定を保存」を押して反映してください`);
    setCsvText("");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      importCsv(text);
    } catch (err) {
      alert(`ファイル読込失敗: ${err}`);
    } finally {
      e.target.value = ""; // 同じファイルを再選択できるようにリセット
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const buyerMap: Record<string, string> = {};
      for (const b of buyers) {
        const code = b.code.trim();
        const name = b.name.trim();
        if (code) buyerMap[code] = name;
      }

      // 市場別形式 (社内用/提出用) を整形
      const entryToColumnDef = (c: ColumnEntry): ColumnDef => ({
        header: c.header.trim(),
        field: c.field,
        ...(c.field === "FIXED" && c.fixedValue ? { fixedValue: c.fixedValue } : {}),
        ...(c.width && parseInt(c.width) > 0 ? { width: parseInt(c.width) } : {}),
      });
      const formats: Record<string, MarketFormat> = {};
      for (const [marketName, ms] of Object.entries(marketFormats)) {
        const internalCols = ms.internal.columns.filter(c => c.header.trim()).map(entryToColumnDef);
        const submissionCols = ms.submission.columns.filter(c => c.header.trim()).map(entryToColumnDef);
        const salesImportCols = ms.salesImport.columns.filter(c => c.header.trim()).map(entryToColumnDef);
        const out: MarketFormat = {};
        if (internalCols.length > 0) {
          out.internal = {
            columns: internalCols,
            sourceFile: ms.internal.sourceFile,
            ...(ms.internal.name?.trim() ? { name: ms.internal.name.trim() } : {}),
          };
        }
        if (submissionCols.length > 0) {
          out.submission = {
            columns: submissionCols,
            sourceFile: ms.submission.sourceFile,
            ...(ms.submission.name?.trim() ? { name: ms.submission.name.trim() } : {}),
          };
        }
        if (salesImportCols.length > 0) {
          out.salesImport = {
            columns: salesImportCols,
            ...(ms.salesImport.name?.trim() ? { name: ms.salesImport.name.trim() } : {}),
          };
        }
        if (out.internal || out.submission || out.salesImport) {
          formats[marketName] = out;
        }
      }

      // 税率: 空欄は0、数値以外は現値保持
      const taxRateNum = (() => {
        const n = parseFloat(taxRate);
        if (Number.isFinite(n) && n >= 0) return n;
        return 0;
      })();

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: market.trim(),
          buyerMap,
          marketFormats: formats,
          taxRate: taxRateNum,
        }),
      });
      if (res.ok) {
        const now = new Date().toLocaleString("ja-JP");
        setSavedAt(now);
      } else {
        const err = await res.json();
        alert(`保存失敗: ${err.error}`);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="text-[var(--fg-muted)] text-sm">読込中…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* ===================== App Bar ===================== */}
      <header className="sticky top-0 z-30 bg-[var(--bg)]/90 backdrop-blur-md border-b border-[var(--border)]">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-14 flex items-center gap-4">
          <Link
            href="/"
            className="btn btn-ghost btn-sm"
            title="あご表に戻る"
          >
            <span className="text-base leading-none">←</span>
            <span className="text-xs">戻る</span>
          </Link>
          <div className="h-6 w-px bg-[var(--border)]" />
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 flex items-center justify-center text-[28px] font-black italic"
              style={{
                background: "var(--ink-cyan)",
                border: "3px solid var(--fg)",
                borderRadius: "18px",
                boxShadow: "0 5px 0 var(--fg), inset 0 2px 0 rgba(255,255,255,0.6)",
                color: "var(--fg)",
                lineHeight: 1,
                fontFamily: "var(--font-display)",
              }}
            >
              ⚙
            </div>
            <div className="flex flex-col leading-none">
              <h1 className="display text-[26px]">
                設定
              </h1>
              <div className="mt-2">
                <span className="ink-tag ink-tag-pink">GEAR MENU</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ===================== Main ===================== */}
      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-6 pb-32">
        <div className="space-y-5">
          {/* ① 市場 */}
          <section className="panel p-6">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[var(--accent)] text-xs font-bold tabular-nums">01</span>
              <h2 className="text-base font-semibold tracking-tight">市場</h2>
            </div>
            <p className="text-xs text-[var(--fg-muted)] mb-4">
              ここで指定した市場名は、Excel出力時に各行の「市場」列に入ります。
              （例: コメ兵 / オークネット / starbuyers / モノシェア など）
            </p>
            <input
              type="text"
              value={market}
              onChange={e => setMarket(e.target.value)}
              placeholder="例: コメ兵"
              className="input max-w-md"
            />
          </section>

          {/* ② 税率 */}
          <section className="panel p-6">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[var(--accent)] text-xs font-bold tabular-nums">02</span>
              <h2 className="text-base font-semibold tracking-tight">税率</h2>
            </div>
            <p className="text-xs text-[var(--fg-muted)] mb-4">
              売上・手数料の計算に使う税率 (%) です。消費税率が変わったときに更新してください。
            </p>
            <div className="flex items-center gap-2 max-w-xs">
              <input
                type="number"
                value={taxRate}
                onChange={e => setTaxRate(e.target.value)}
                min={0}
                max={100}
                step="0.1"
                placeholder="10"
                className="input"
              />
              <span className="text-sm text-[var(--fg-muted)]">%</span>
            </div>
          </section>

          {/* ③ バイヤー名マッピング */}
          <section className="panel p-6">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[var(--accent)] text-xs font-bold tabular-nums">03</span>
              <h2 className="text-base font-semibold tracking-tight">バイヤー名マッピング</h2>
            </div>
            <p className="text-xs text-[var(--fg-muted)] mb-4">
              Kintoneから取得される「UU」「CC」などの<strong>バイヤーコード</strong>を、表示・Excel出力時に<strong>人名</strong>に変換します。
              例: <code className="text-[var(--accent)]">UU</code> → <code className="text-[var(--accent)]">坂巻</code>
            </p>

            {/* CSVインポート */}
            <div className="mb-5 p-4 bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h3 className="text-xs font-semibold text-[var(--fg)]">📥 CSVインポート</h3>
                <label className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)] cursor-pointer">
                  <input
                    type="radio"
                    checked={importMode === "merge"}
                    onChange={() => setImportMode("merge")}
                    className="accent-[var(--accent)]"
                  />
                  追記マージ
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)] cursor-pointer">
                  <input
                    type="radio"
                    checked={importMode === "replace"}
                    onChange={() => setImportMode("replace")}
                    className="accent-[var(--accent)]"
                  />
                  全置換
                </label>
              </div>
              <p className="text-[11px] text-[var(--fg-subtle)] mb-3">
                対応形式 (1行1ペア): <code>UU,坂巻</code> / <code>UU=坂巻</code> / <code>&quot;UU&quot;=&quot;坂巻&quot;</code> / タブ区切り / 全角カンマ。<code>#</code> 始まりの行はコメント。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="btn btn-secondary btn-sm cursor-pointer">
                  📁 ファイル選択
                  <input
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                <span className="text-[11px] text-[var(--fg-subtle)]">または下に貼り付け ↓</span>
              </div>
              <textarea
                value={csvText}
                onChange={e => setCsvText(e.target.value)}
                placeholder={`UU,坂巻\nCC,高橋\nNN,谷中\n# コメント行は無視されます`}
                rows={4}
                className="input mt-2 font-mono text-xs"
              />
              <button
                onClick={() => importCsv(csvText)}
                disabled={!csvText.trim()}
                className="btn btn-primary btn-sm mt-2"
              >
                貼り付けた内容を取り込む
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-subtle)] text-[var(--fg-muted)]">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-1/3 text-[11px] font-semibold uppercase tracking-wide">コード</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide">人名</th>
                    <th className="px-3 py-2.5 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {buyers.map(b => (
                    <tr key={b.id} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={b.code}
                          onChange={e => updateBuyer(b.id, { code: e.target.value })}
                          placeholder="UU"
                          className="input input-sm font-mono"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={b.name}
                          onChange={e => updateBuyer(b.id, { name: e.target.value })}
                          placeholder="坂巻"
                          className="input input-sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => removeBuyerRow(b.id)}
                          className="w-7 h-7 rounded-md text-[var(--fg-subtle)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg)] transition-colors"
                          title="この行を削除"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={addBuyerRow} className="btn btn-secondary btn-sm mt-3">
              ＋行追加
            </button>
          </section>

          {/* ④ 市場別Excel形式 */}
          <section className="panel p-6">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[var(--accent)] text-xs font-bold tabular-nums">04</span>
              <h2 className="text-base font-semibold tracking-tight">市場別Excel形式</h2>
            </div>
            <p className="text-xs text-[var(--fg-muted)] mb-4">
              市場名ごとにExcel出力の列構成を保存できます。出力時は<strong>①で設定中の市場名</strong>に対応する形式が使われます。
              形式が無い市場ではデフォルト12列形式で出力されます。
            </p>

            {/* 市場選択 */}
            <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-[var(--border)]">
              <label className="form-label mr-1">市場</label>
              <select
                value={editingMarket}
                onChange={e => setEditingMarket(e.target.value)}
                className="input input-sm max-w-[240px]"
              >
                <option value="">— 選択 —</option>
                {Array.from(new Set([
                  ...(market ? [market] : []),
                  ...Object.keys(marketFormats),
                ])).map(m => (
                  <option key={m} value={m}>{m}{m === market ? " (現在の市場)" : ""}</option>
                ))}
              </select>
              <button onClick={addNewMarket} className="btn btn-secondary btn-sm">
                ＋新しい市場
              </button>
              {editingMarket && (
                <button onClick={deleteMarketFormat} className="btn btn-danger btn-sm">
                  この市場ごと削除
                </button>
              )}
            </div>

            {!editingMarket && (
              <div className="p-6 text-center text-sm text-[var(--fg-subtle)] bg-[var(--bg-subtle)] rounded-xl border border-dashed border-[var(--border)]">
                編集する市場を選択するか、「＋新しい市場」で作成してください。
              </div>
            )}

            {editingMarket && (
              <>
                {/* 社内用 / 提出用 / 売上取込 タブ */}
                <div className="flex gap-1 mb-4 border-b border-[var(--border)]">
                  {(["internal", "submission", "sales_import"] as FormatType[]).map(t => {
                    const tpl = editingMarketFormat[formatTypeToKey(t)];
                    const cnt = tpl?.columns.length || 0;
                    const active = editingType === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setEditingType(t)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                          active
                            ? "border-[var(--accent)] text-[var(--accent)]"
                            : "border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]"
                        }`}
                      >
                        {FORMAT_TYPE_LABEL[t]}
                        <span className="ml-1.5 text-[10px] text-[var(--fg-subtle)]">({cnt}列)</span>
                      </button>
                    );
                  })}
                </div>

                {/* 名称 (全タイプ共通、任意) */}
                <div className="mb-4 flex items-center gap-2">
                  <label className="form-label mr-1">名称</label>
                  <input
                    type="text"
                    value={editingTemplate.name || ""}
                    onChange={e => setEditingTemplate({ name: e.target.value })}
                    placeholder={
                      editingType === "sales_import"
                        ? "例: コメ兵 月次売上"
                        : "例: コメ兵 あご表"
                    }
                    className="input input-sm max-w-sm"
                  />
                  {editingType === "sales_import" && (
                    <span className="text-[10px] text-[var(--fg-subtle)]">
                      売上入力タブのボタンに表示されます
                    </span>
                  )}
                </div>

                {/* テンプレート操作 (社内用/提出用: アップロード, 売上取込: 4列デフォルト) */}
                <div className="mb-4 p-4 bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl">
                  {editingType !== "sales_import" ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--fg)]">
                          📥 テンプレートExcelから読込
                        </span>
                        <label className="btn btn-primary btn-sm cursor-pointer">
                          {parsing ? "保存中…" : "📁 ファイル選択"}
                          <input
                            type="file"
                            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            onChange={handleTemplateUpload}
                            className="hidden"
                            disabled={parsing}
                          />
                        </label>
                        {editingTemplate.sourceFile && (
                          <>
                            <span className="badge badge-success">
                              ✓ 保存済み: <code className="ml-0.5">{editingTemplate.sourceFile}</code>
                            </span>
                            <button onClick={handleDeleteTemplate} className="btn btn-danger btn-xs">
                              テンプレ削除
                            </button>
                          </>
                        )}
                        <button onClick={loadDefaultColumns} className="btn btn-secondary btn-xs ml-auto">
                          デフォルト12列を読込
                        </button>
                      </div>
                      <p className="text-[11px] text-[var(--fg-subtle)] mt-2 leading-relaxed">
                        テンプレートExcelをアップすると、<strong className="text-[var(--fg-muted)]">ファイル本体がSupabaseに保存</strong>され、<strong className="text-[var(--fg-muted)]">提出用Excel出力時に書式・ヘッダーをそのまま使ってデータが追記</strong>されます。
                        列ヘッダーは自動マッピングされ、認識できなかった列は <code>(空欄)</code> になります。
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--fg)]">
                          📥 サンプルExcelから列構造を読込
                        </span>
                        <label className="btn btn-primary btn-sm cursor-pointer">
                          {parsing ? "解析中…" : "📁 ファイル選択"}
                          <input
                            type="file"
                            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            onChange={handleTemplateUpload}
                            className="hidden"
                            disabled={parsing}
                          />
                        </label>
                        {editingTemplate.sourceFile && (
                          <span className="badge badge-success">
                            ✓ 読込済み: <code className="ml-0.5">{editingTemplate.sourceFile}</code>
                          </span>
                        )}
                        <button onClick={loadSalesImportDefaults} className="btn btn-secondary btn-xs ml-auto">
                          デフォルト4列を読込
                        </button>
                      </div>
                      <p className="text-[11px] text-[var(--fg-subtle)] mt-2 leading-relaxed">
                        市場から受領したサンプルExcelをアップすると、<strong className="text-[var(--fg-muted)]">列ヘッダーが自動抽出</strong>され下のマッピング表に展開されます (ファイル本体は保存されません)。
                        列ごとに<strong className="text-[var(--fg-muted)]">データ種別</strong> (出品番号/商品番号/売り金額/手数料など) を必要に応じて調整してください。
                        売上入力タブから <strong>📥 売上取込</strong> を実行すると、この定義に沿って対応列を解析し、出品番号または商品番号で一致した行に売り金額・手数料を書き込みます。
                      </p>
                    </>
                  )}
                </div>

                <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--bg-subtle)] text-[var(--fg-muted)]">
                      <tr>
                        <th className="px-3 py-2.5 w-8 text-center text-[11px] font-semibold uppercase tracking-wide">#</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide">列ヘッダー</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide">データ</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide">固定値/幅</th>
                        <th className="px-3 py-2.5 w-20 text-center text-[11px] font-semibold uppercase tracking-wide">並び</th>
                        <th className="px-3 py-2.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editingColumns.map((col, idx) => (
                        <tr key={col.id} className="border-t border-[var(--border)]">
                          <td className="px-3 py-2 text-center text-[var(--fg-subtle)] tabular-nums">{idx + 1}</td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={col.header}
                              onChange={e => updateColumn(col.id, { header: e.target.value })}
                              placeholder="例: 箱番、枝番"
                              className="input input-sm"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={col.field}
                              onChange={e => updateColumn(col.id, { field: e.target.value as ColumnFieldType })}
                              className="input input-sm"
                            >
                              {COLUMN_FIELDS.map(f => (
                                <option key={f.value} value={f.value}>{f.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {col.field === "FIXED" && (
                                <input
                                  type="text"
                                  value={col.fixedValue}
                                  onChange={e => updateColumn(col.id, { fixedValue: e.target.value })}
                                  placeholder="固定値"
                                  className="input input-sm flex-1"
                                />
                              )}
                              <input
                                type="number"
                                value={col.width}
                                onChange={e => updateColumn(col.id, { width: e.target.value })}
                                placeholder="幅"
                                className="input input-sm w-16"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => moveColumn(col.id, -1)}
                              disabled={idx === 0}
                              className="w-6 h-6 rounded text-[var(--fg-muted)] hover:bg-[var(--bg-muted)] disabled:opacity-30 transition-colors"
                              title="上へ"
                            >▲</button>
                            <button
                              onClick={() => moveColumn(col.id, 1)}
                              disabled={idx === editingColumns.length - 1}
                              className="w-6 h-6 rounded text-[var(--fg-muted)] hover:bg-[var(--bg-muted)] disabled:opacity-30 transition-colors"
                              title="下へ"
                            >▼</button>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => removeColumn(col.id)}
                              className="w-7 h-7 rounded-md text-[var(--fg-subtle)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg)] transition-colors"
                            >✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={addColumn} className="btn btn-secondary btn-sm mt-3">
                  ＋列を追加
                </button>
              </>
            )}
          </section>
        </div>
      </main>

      {/* 保存ボタン (sticky footer) */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-[var(--bg)]/90 backdrop-blur-md border-t border-[var(--border)]">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? "保存中…" : "💾 設定を保存"}
          </button>
          {savedAt && (
            <span className="text-xs text-[var(--success)] inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
              {savedAt} に保存しました
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

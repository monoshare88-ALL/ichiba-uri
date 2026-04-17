"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAvailableMarkets, getMarketProfile } from "@/lib/marketProfiles";

interface BuyerEntry {
  id: string;
  code: string;
  name: string;
}

interface AppSettings {
  market?: string;
  buyerMap?: Record<string, string>;
  taxRate?: number;
}

const MARKETS = getAvailableMarkets();

export default function SettingsPage() {
  const [market, setMarket] = useState("");
  const [taxRate, setTaxRate] = useState<string>("10");
  const [buyers, setBuyers] = useState<BuyerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string>("");
  const [csvText, setCsvText] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");

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
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
   */
  const parseCsvText = (text: string): { code: string; name: string }[] => {
    const lines = text.split(/\r?\n/);
    const result: { code: string; name: string }[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;

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
      e.target.value = "";
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
          {/* ① 市場プロファイル */}
          <section className="panel p-6">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[var(--accent)] text-xs font-bold tabular-nums">01</span>
              <h2 className="text-base font-semibold tracking-tight">市場プロファイル</h2>
            </div>
            <p className="text-xs text-[var(--fg-muted)] mb-4">
              市場を選択すると、Excelインポート/エクスポートの列構成が自動で最適化されます。
            </p>
            <select
              value={market}
              onChange={e => setMarket(e.target.value)}
              className="input max-w-md"
            >
              <option value="">-- 選択してください --</option>
              {MARKETS.map(m => (
                <option key={m.id} value={m.name}>{m.name}</option>
              ))}
            </select>
            {market && (() => {
              const profile = getMarketProfile(market);
              if (!profile) return null;
              return (
                <div className="mt-4 p-4 bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl">
                  <p className="text-xs text-[var(--fg-muted)] mb-3">{profile.description}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                      <div className="text-[10px] font-semibold text-[var(--fg-muted)] uppercase tracking-wide mb-1">社内用</div>
                      <div className="text-sm font-medium">{profile.internalColumns.length}列</div>
                      <div className="text-[10px] text-[var(--fg-subtle)] mt-1">
                        {profile.internalColumns.filter(c => c.header).map(c => c.header).slice(0, 6).join(", ")}...
                      </div>
                    </div>
                    <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                      <div className="text-[10px] font-semibold text-[var(--fg-muted)] uppercase tracking-wide mb-1">提出用</div>
                      <div className="text-sm font-medium">{profile.submissionColumns.length}列</div>
                      <div className="text-[10px] text-[var(--fg-subtle)] mt-1">
                        {profile.submissionColumns.map(c => c.header).join(", ")}
                      </div>
                    </div>
                    <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                      <div className="text-[10px] font-semibold text-[var(--fg-muted)] uppercase tracking-wide mb-1">売上取込</div>
                      <div className="text-sm font-medium">{profile.salesImport.columns.length}列</div>
                      <div className="text-[10px] text-[var(--fg-subtle)] mt-1">
                        {profile.salesImport.columns.map(c => c.header).join(", ")}
                      </div>
                    </div>
                  </div>
                  {profile.import.skipSheetPatterns.length > 0 && (
                    <p className="text-[10px] text-[var(--fg-subtle)] mt-3">
                      インポート時にスキップするシート: {profile.import.skipSheetPatterns.map(p => `「${p}」`).join(", ")} を含むタブ
                    </p>
                  )}
                </div>
              );
            })()}
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
                <h3 className="text-xs font-semibold text-[var(--fg)]">CSVインポート</h3>
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
                  ファイル選択
                  <input
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                <span className="text-[11px] text-[var(--fg-subtle)]">または下に貼り付け</span>
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
            {saving ? "保存中…" : "設定を保存"}
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

"use client";

import React, { useState, useEffect, useMemo } from "react";

interface ProfitRow {
  date: string;
  source: string;
  brand: string;
  itemName: string;
  condition: string;
  buyer: string;
  itemNo: string;
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
}

interface AnalysisData {
  summary: {
    totalItems: number;
    totalLoss: number;
    totalReturned: number;
    totalPurchase: number;
    totalProfit: number;
    totalFee: number;
    totalCampaign: number;
    profitRate: number;
  };
  dateSummary: DateSummary[];
  brandSummary: GroupSummary[];
  buyerSummary: GroupSummary[];
  items: ProfitRow[];
}

const yen = (n: number) => {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("ja-JP");
  return n < 0 ? `-¥${formatted}` : `¥${formatted}`;
};

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n}%`;

const dateLabel = (d: string) => {
  const yy = d.slice(0, 2);
  const mm = d.slice(2, 4);
  const dd = d.slice(4, 6);
  return `20${yy}/${mm}/${dd}`;
};

type SortKey = "date" | "brand" | "itemName" | "itemNo" | "buyer" | "purchaseTax" | "saleTax" | "feeTax" | "campaignTax" | "profit";
type SortDir = "asc" | "desc";

export default function AnalysisPage() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [filterDate, setFilterDate] = useState<string>("");
  const [filterBrand, setFilterBrand] = useState<string>("");
  const [filterBuyer, setFilterBuyer] = useState<string>("");
  const [filterText, setFilterText] = useState<string>("");
  const [showLossOnly, setShowLossOnly] = useState(false);

  // sort
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // tab
  const [activeTab, setActiveTab] = useState<"summary" | "items">("summary");

  useEffect(() => {
    fetch("/api/analysis")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    let items = data.items;
    if (filterDate) items = items.filter((r) => r.date === filterDate);
    if (filterBrand) items = items.filter((r) => r.brand === filterBrand);
    if (filterBuyer) items = items.filter((r) => r.buyer === filterBuyer);
    if (filterText) {
      const q = filterText.toLowerCase();
      items = items.filter((r) => r.itemName.toLowerCase().includes(q) || r.brand.toLowerCase().includes(q) || r.itemNo.includes(q));
    }
    if (showLossOnly) items = items.filter((r) => r.profit < 0);

    items = [...items].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return items;
  }, [data, filterDate, filterBrand, filterBuyer, filterText, showLossOnly, sortKey, sortDir]);

  const filteredSummary = useMemo(() => {
    if (!filteredItems.length) return null;
    const totalPurchase = filteredItems.reduce((s, r) => s + r.purchaseTax, 0);
    const totalProfit = filteredItems.reduce((s, r) => s + r.profit, 0);
    return {
      count: filteredItems.length,
      lossCount: filteredItems.filter((r) => r.profit < 0).length,
      purchase: Math.round(totalPurchase),
      profit: Math.round(totalProfit),
      rate: totalPurchase > 0 ? Math.round((totalProfit / totalPurchase) * 1000) / 10 : 0,
    };
  }, [filteredItems]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "profit" || key === "saleTax" || key === "purchaseTax" || key === "feeTax" || key === "campaignTax" ? "desc" : "asc");
    }
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const uniqueDates = useMemo(() => data ? [...new Set(data.items.map((r) => r.date))].sort() : [], [data]);
  const uniqueBrands = useMemo(() => data ? [...new Set(data.items.map((r) => r.brand))].filter(Boolean).sort() : [], [data]);
  const uniqueBuyers = useMemo(() => data ? [...new Set(data.items.map((r) => r.buyer))].filter(Boolean).sort() : [], [data]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-bounce">📊</div>
          <p className="text-lg font-bold">分析中...</p>
          <p className="text-sm text-[var(--fg-muted)] mt-1">コメ兵の社内用Excelを読み取っています</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="panel p-8 max-w-md text-center">
          <p className="text-lg font-bold text-[var(--danger)]">エラー</p>
          <p className="text-sm mt-2">{error}</p>
          <a href="/" className="btn btn-sm btn-primary mt-4">戻る</a>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { summary, dateSummary, brandSummary, buyerSummary } = data;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--bg)]/90 backdrop-blur-md border-b border-[var(--border)]">
        <div className="max-w-[1920px] mx-auto px-4 md:px-6 h-14 flex items-center gap-4">
          <a
            href="/"
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
            A
          </a>
          <div className="flex flex-col leading-none">
            <h1 className="display text-[26px]">過去結果分析</h1>
            <div className="mt-2">
              <span className="ink-tag ink-tag-lime">コメ兵</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <a href="/" className="btn btn-ghost btn-sm">
              <span className="text-xs">← あご表作成</span>
            </a>
            <a href="/settings" className="btn btn-ghost btn-sm" title="設定">
              <span className="text-base leading-none">⚙</span>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-[1920px] mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard
            label="販売件数"
            value={`${summary.totalItems}件`}
            sub={`赤字 ${summary.totalLoss}件 / 返品 ${summary.totalReturned}件`}
            color="var(--ink-cyan)"
          />
          <SummaryCard
            label="仕入総額(税込)"
            value={yen(summary.totalPurchase)}
            sub={`手数料 ${yen(summary.totalFee)}`}
            color="var(--ink-purple)"
          />
          <SummaryCard
            label="利益総額"
            value={yen(summary.totalProfit)}
            sub={`キャンペーン ${yen(summary.totalCampaign)}`}
            color={summary.totalProfit >= 0 ? "var(--ink-lime)" : "var(--danger-soft)"}
          />
          <SummaryCard
            label="利益率"
            value={pct(summary.profitRate)}
            sub={`${summary.totalItems - summary.totalLoss}件黒字 / ${summary.totalLoss}件赤字`}
            color={summary.profitRate >= 0 ? "var(--ink-yellow)" : "var(--danger-soft)"}
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("summary")}
            className={`btn btn-sm ${activeTab === "summary" ? "btn-primary" : ""}`}
          >
            集計
          </button>
          <button
            onClick={() => setActiveTab("items")}
            className={`btn btn-sm ${activeTab === "items" ? "btn-primary" : ""}`}
          >
            商品一覧 ({data.items.length}件)
          </button>
        </div>

        {activeTab === "summary" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Date Summary */}
            <div className="panel p-4">
              <h3 className="text-lg mb-3">日付別</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">大会日</th>
                    <th className="text-right">販売</th>
                    <th className="text-right">赤字</th>
                    <th className="text-right">利益</th>
                    <th className="text-right">率</th>
                  </tr>
                </thead>
                <tbody>
                  {dateSummary.map((d) => (
                    <tr
                      key={d.date}
                      className="cursor-pointer"
                      onClick={() => { setFilterDate(d.date); setActiveTab("items"); }}
                    >
                      <td>{dateLabel(d.date)}</td>
                      <td className="text-right">{d.count}</td>
                      <td className="text-right">{d.lossCount}</td>
                      <td className={`text-right font-bold ${d.profit < 0 ? "text-[var(--danger)]" : ""}`}>
                        {yen(d.profit)}
                      </td>
                      <td className={`text-right ${d.profitRate < 0 ? "text-[var(--danger)]" : ""}`}>
                        {pct(d.profitRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--fg)]">
                    <td className="font-bold">合計</td>
                    <td className="text-right font-bold">{summary.totalItems}</td>
                    <td className="text-right font-bold">{summary.totalLoss}</td>
                    <td className={`text-right font-bold ${summary.totalProfit < 0 ? "text-[var(--danger)]" : ""}`}>
                      {yen(summary.totalProfit)}
                    </td>
                    <td className={`text-right font-bold ${summary.profitRate < 0 ? "text-[var(--danger)]" : ""}`}>
                      {pct(summary.profitRate)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Brand Summary */}
            <div className="panel p-4">
              <h3 className="text-lg mb-3">ブランド別</h3>
              <div className="max-h-[480px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left">ブランド</th>
                      <th className="text-right">件数</th>
                      <th className="text-right">利益</th>
                      <th className="text-right">率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandSummary.map((b) => (
                      <tr
                        key={b.name}
                        className="cursor-pointer"
                        onClick={() => { setFilterBrand(b.name); setActiveTab("items"); }}
                      >
                        <td className="max-w-[140px] truncate" title={b.name}>{b.name}</td>
                        <td className="text-right">
                          {b.count}
                          {b.lossCount > 0 && <span className="text-[var(--fg-muted)] text-[10px] ml-0.5">({b.lossCount})</span>}
                        </td>
                        <td className={`text-right font-bold ${b.profit < 0 ? "text-[var(--danger)]" : ""}`}>
                          {yen(b.profit)}
                        </td>
                        <td className={`text-right ${b.profitRate < 0 ? "text-[var(--danger)]" : ""}`}>
                          {pct(b.profitRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Buyer Summary */}
            <div className="panel p-4">
              <h3 className="text-lg mb-3">バイヤー別</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">バイヤー</th>
                    <th className="text-right">件数</th>
                    <th className="text-right">仕入</th>
                    <th className="text-right">利益</th>
                    <th className="text-right">率</th>
                  </tr>
                </thead>
                <tbody>
                  {buyerSummary.map((b) => (
                    <tr
                      key={b.name}
                      className="cursor-pointer"
                      onClick={() => { setFilterBuyer(b.name); setActiveTab("items"); }}
                    >
                      <td>{b.name}</td>
                      <td className="text-right">
                        {b.count}
                        {b.lossCount > 0 && <span className="text-[var(--fg-muted)] text-[10px] ml-0.5">({b.lossCount})</span>}
                      </td>
                      <td className="text-right">{yen(b.purchase)}</td>
                      <td className={`text-right font-bold ${b.profit < 0 ? "text-[var(--danger)]" : ""}`}>
                        {yen(b.profit)}
                      </td>
                      <td className={`text-right ${b.profitRate < 0 ? "text-[var(--danger)]" : ""}`}>
                        {pct(b.profitRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "items" && (
          <div className="space-y-3">
            {/* Filters */}
            <div className="panel p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="input input-sm max-w-[160px]"
                >
                  <option value="">全日付</option>
                  {uniqueDates.map((d) => (
                    <option key={d} value={d}>{dateLabel(d)}</option>
                  ))}
                </select>
                <select
                  value={filterBrand}
                  onChange={(e) => setFilterBrand(e.target.value)}
                  className="input input-sm max-w-[180px]"
                >
                  <option value="">全ブランド</option>
                  {uniqueBrands.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <select
                  value={filterBuyer}
                  onChange={(e) => setFilterBuyer(e.target.value)}
                  className="input input-sm max-w-[140px]"
                >
                  <option value="">全バイヤー</option>
                  {uniqueBuyers.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="商品名・番号で検索"
                  className="input input-sm max-w-[200px]"
                />
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showLossOnly}
                    onChange={(e) => setShowLossOnly(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-xs font-bold">赤字のみ</span>
                </label>
                {(filterDate || filterBrand || filterBuyer || filterText || showLossOnly) && (
                  <button
                    onClick={() => { setFilterDate(""); setFilterBrand(""); setFilterBuyer(""); setFilterText(""); setShowLossOnly(false); }}
                    className="btn btn-ghost btn-xs"
                  >
                    × クリア
                  </button>
                )}
              </div>
              {filteredSummary && (
                <div className="flex items-center gap-4 mt-2 text-xs">
                  <span className="badge">{filteredSummary.count}件</span>
                  <span>仕入 {yen(filteredSummary.purchase)}</span>
                  <span className={`font-bold ${filteredSummary.profit < 0 ? "text-[var(--danger)]" : ""}`}>
                    利益 {yen(filteredSummary.profit)} ({pct(filteredSummary.rate)})
                  </span>
                  {filteredSummary.lossCount > 0 && (
                    <span className="text-[var(--danger)]">赤字 {filteredSummary.lossCount}件</span>
                  )}
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr>
                    <Th label="日付" sortKey="date" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <Th label="商品番号" sortKey="itemNo" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <Th label="ブランド" sortKey="brand" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <Th label="商品名" sortKey="itemName" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <th className="text-left">状態</th>
                    <Th label="バイヤー" sortKey="buyer" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <Th label="仕入(税込)" sortKey="purchaseTax" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} align="right" />
                    <Th label="売り(税込)" sortKey="saleTax" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} align="right" />
                    <Th label="手数料(税込)" sortKey="feeTax" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} align="right" />
                    <Th label="CP(税込)" sortKey="campaignTax" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} align="right" />
                    <Th label="利益" sortKey="profit" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((r, i) => (
                    <tr key={`${r.date}-${r.itemNo}-${i}`} className={r.profit < 0 ? "bg-[var(--danger-soft)]/40" : ""}>
                      <td>{dateLabel(r.date)}</td>
                      <td className="font-mono text-[12px]">{r.itemNo}</td>
                      <td className="max-w-[120px] truncate" title={r.brand}>{r.brand}</td>
                      <td className="max-w-[240px] truncate" title={r.itemName}>{r.itemName}</td>
                      <td>{r.condition}</td>
                      <td>{r.buyer}</td>
                      <td className="text-right font-mono">{yen(r.purchaseTax)}</td>
                      <td className="text-right font-mono">{yen(r.saleTax)}</td>
                      <td className="text-right font-mono text-[var(--fg-muted)]">{yen(r.feeTax)}</td>
                      <td className="text-right font-mono text-[var(--fg-muted)]">{r.campaignTax !== 0 ? yen(r.campaignTax) : ""}</td>
                      <td className={`text-right font-mono font-bold ${r.profit < 0 ? "text-[var(--danger)]" : ""}`}>
                        {yen(r.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredItems.length === 0 && (
                <div className="text-center py-8 text-[var(--fg-muted)]">該当する商品がありません</div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ------- Sub-components -------

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="panel p-4" style={{ background: color }}>
      <p className="text-[11px] font-black italic uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-black mt-1" style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}>
        {value}
      </p>
      <p className="text-[11px] text-[var(--fg-muted)] mt-1">{sub}</p>
    </div>
  );
}

function Th({
  label,
  sortKey: key,
  current,
  dir,
  onClick,
  indicator,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  indicator: (k: SortKey) => string;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`text-${align} cursor-pointer select-none hover:bg-[var(--ink-purple-deep)]`}
      onClick={() => onClick(key)}
    >
      {label}{indicator(key)}
    </th>
  );
}

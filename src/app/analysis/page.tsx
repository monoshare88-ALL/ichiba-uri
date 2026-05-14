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
  listingId: string;
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
  returnFee: number;
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

interface AnalysisData {
  summary: {
    totalItems: number;
    totalLoss: number;
    totalReturned: number;
    totalPurchase: number;
    totalProfit: number;
    totalFee: number;
    totalCampaign: number;
    totalReturnFee: number;
    profitRate: number;
  };
  dateSummary: DateSummary[];
  brandSummary: GroupSummary[];
  buyerSummary: GroupSummary[];
  returnPeriodSummary: {
    period: string;
    buyers: { buyer: string; count: number; fee: number }[];
    totalCount: number;
    totalFee: number;
  }[];
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

type SortKey = "date" | "brand" | "itemName" | "itemNo" | "listingId" | "buyer" | "purchaseTax" | "saleTax" | "feeTax" | "campaignTax" | "profit";
type SortDir = "asc" | "desc";

/** 自然順ソート: A-1, A-2, ..., A-10, B-1, ... */
const naturalCompare = (a: string, b: string): number => {
  const re = /(\d+)|(\D+)/g;
  const pa = a.match(re) || [];
  const pb = b.match(re) || [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const sa = pa[i] || "";
    const sb = pb[i] || "";
    const na = parseInt(sa, 10);
    const nb = parseInt(sb, 10);
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else {
      const cmp = sa.localeCompare(sb);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
};

const DEFAULT_MARKETS = [
  { id: "komehyo", name: "コメ兵" },
  { id: "taba", name: "市場連盟" },
];

export default function AnalysisPage() {
  const [markets, setMarkets] = useState(DEFAULT_MARKETS);
  const [market, setMarket] = useState("all");
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 現在の半期IDを算出
  const currentPeriodId = useMemo(() => {
    const now = new Date();
    const yy = now.getFullYear() % 100;
    const mm = now.getMonth() + 1;
    if (mm >= 12 || mm <= 5) {
      const fy = mm === 12 ? yy : yy - 1;
      return `${fy}h1`;
    }
    return `${yy - 1}h2`;
  }, []);

  // period filter: "all" | "h1" (12-5月) | "h2" (6-11月) | specific like "25h1"
  const [filterPeriod, setFilterPeriod] = useState<string>(currentPeriodId);

  // filters
  const [filterDate, setFilterDate] = useState<string>("");
  const [filterBrand, setFilterBrand] = useState<string>("");
  const [filterBuyer, setFilterBuyer] = useState<string>("");
  const [filterText, setFilterText] = useState<string>("");
  const [filterListingId, setFilterListingId] = useState<string>("");
  const [filterItemNo, setFilterItemNo] = useState<string>("");
  const [filterCondition, setFilterCondition] = useState<string>("");
  const [showLossOnly, setShowLossOnly] = useState(false);

  // sort
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // tab
  const [activeTab, setActiveTab] = useState<"summary" | "items">("summary");
  const [summarySubTab, setSummarySubTab] = useState<"brand" | "buyer">("buyer");

  const loadMarket = (id: string) => {
    setMarket(id);
    setData(null);
    setLoading(true);
    setError(null);
    setFilterPeriod(currentPeriodId); setFilterDate(""); setFilterBrand(""); setFilterBuyer(""); setFilterText(""); setFilterListingId(""); setFilterItemNo(""); setFilterCondition(""); setShowLossOnly(false);
    fetch(`/api/analysis?market=${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // 市場一覧をAPIから取得
    fetch("/api/analysis?market=_list")
      .then(r => r.json())
      .then(d => {
        if (d.markets) {
          setMarkets([{ id: "all", name: "全市場" }, ...d.markets]);
        }
      })
      .catch(() => {});
    loadMarket("all");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // バイヤーのベース名を抽出: "再販・月崎" → "月崎", "月崎" → "月崎"
  const baseBuyerName = (b: string) => b.startsWith("再販・") ? b.slice(3) : b;

  // 半期判定: 12-5月 = h1, 6-11月 = h2
  // date形式: YYMMDD → mm = date.slice(2,4)
  const isH1Month = (mm: number) => mm >= 12 || mm <= 5;  // 12,1,2,3,4,5月
  const isH2Month = (mm: number) => mm >= 6 && mm <= 11;  // 6,7,8,9,10,11月

  // 半期ラベル: 12月開始なので "25年12月〜26年5月" → "25下期"のような表記
  // 期のID: "25h1" = 25年12月〜26年5月, "25h2" = 26年6月〜26年11月
  const getDatePeriodId = (dateStr: string) => {
    const yy = parseInt(dateStr.slice(0, 2), 10);
    const mm = parseInt(dateStr.slice(2, 4), 10);
    if (isH1Month(mm)) {
      // 12月は前年度扱い: 25年12月 → 25h1, 26年1月 → 25h1
      const fiscalYear = mm === 12 ? yy : yy - 1;
      return `${fiscalYear}h1`;
    } else {
      // 6-11月: 26年6月 → 25h2
      return `${yy - 1}h2`;
    }
  };

  const getPeriodLabel = (pid: string) => {
    const yy = parseInt(pid.slice(0, 2), 10);
    const half = pid.slice(2);
    if (half === "h1") {
      return `20${yy}年12月〜20${yy + 1}年5月`;
    } else {
      return `20${yy + 1}年6月〜20${yy + 1}年11月`;
    }
  };

  // データから存在する半期を算出
  const availablePeriods = useMemo(() => {
    if (!data) return [];
    const pids = new Set<string>();
    for (const r of data.items) {
      pids.add(getDatePeriodId(r.date));
    }
    return [...pids].sort();
  }, [data]);

  // 半期フィルタ適用済みデータ
  const periodFilteredItems = useMemo(() => {
    if (!data) return [];
    if (filterPeriod === "all") return data.items;
    return data.items.filter((r) => getDatePeriodId(r.date) === filterPeriod);
  }, [data, filterPeriod]);

  // 半期フィルタ後のサマリー（サマリーカードに使用）
  const periodSummary = useMemo(() => {
    const items = periodFilteredItems;
    if (!items.length) return null;
    const totalPurchase = items.reduce((s, r) => s + r.purchaseTax, 0);
    const totalProfit = items.reduce((s, r) => s + r.profit, 0);
    const totalFee = items.reduce((s, r) => s + r.feeTax, 0);
    const totalCampaign = items.reduce((s, r) => s + r.campaignTax, 0);
    const totalLoss = items.filter(r => r.profit < 0).length;
    const totalReturned = items.filter(r => r.isReturned).length;
    const totalReturnFee = items.reduce((s, r) => s + r.returnFee, 0);
    return {
      totalItems: items.length,
      totalLoss,
      totalReturned,
      totalPurchase: Math.round(totalPurchase),
      totalProfit: Math.round(totalProfit),
      totalFee: Math.round(totalFee),
      totalCampaign: Math.round(totalCampaign),
      totalReturnFee: Math.round(totalReturnFee),
      profitRate: totalPurchase > 0 ? Math.round((totalProfit / totalPurchase) * 1000) / 10 : 0,
    };
  }, [periodFilteredItems]);

  const hasAnyFilter = filterDate || filterBrand || filterBuyer || filterText || filterListingId || filterItemNo || filterCondition || showLossOnly;

  const filteredItems = useMemo(() => {
    let items = periodFilteredItems;
    if (filterDate) items = items.filter((r) => r.date === filterDate);
    if (filterBrand) items = items.filter((r) => r.brand === filterBrand);
    if (filterBuyer) {
      // 生名（再販・XX）で一致 → 完全一致、ベース名 → baseBuyerNameで一致
      if (filterBuyer.startsWith("再販")) {
        items = items.filter((r) => r.buyer === filterBuyer);
      } else {
        items = items.filter((r) => baseBuyerName(r.buyer) === filterBuyer);
      }
    }
    if (filterText) {
      const q = filterText.toLowerCase();
      items = items.filter((r) => r.itemName.toLowerCase().includes(q) || r.brand.toLowerCase().includes(q) || r.itemNo.includes(q) || r.listingId.includes(q));
    }
    if (filterListingId) {
      const q = filterListingId.toLowerCase();
      items = items.filter((r) => r.listingId.toLowerCase().includes(q));
    }
    if (filterItemNo) {
      const q = filterItemNo.toLowerCase();
      items = items.filter((r) => r.itemNo.toLowerCase().includes(q));
    }
    if (filterCondition) {
      const q = filterCondition.toLowerCase();
      items = items.filter((r) => r.condition.toLowerCase().includes(q));
    }
    if (showLossOnly) items = items.filter((r) => r.profit < 0);

    items = [...items].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        if (sortKey === "listingId") {
          return sortDir === "asc" ? naturalCompare(av, bv) : naturalCompare(bv, av);
        }
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return items;
  }, [periodFilteredItems, filterDate, filterBrand, filterBuyer, filterText, filterListingId, filterItemNo, filterCondition, showLossOnly, sortKey, sortDir]);

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

  const uniqueDates = useMemo(() => periodFilteredItems.length ? [...new Set(periodFilteredItems.map((r) => r.date))].sort() : [], [periodFilteredItems]);
  const uniqueBrands = useMemo(() => periodFilteredItems.length ? [...new Set(periodFilteredItems.map((r) => r.brand))].filter(Boolean).sort() : [], [periodFilteredItems]);
  // 集計用 (baseBuyerName でまとめ) — フィルタバー用
  const uniqueBuyers = useMemo(() => {
    if (!periodFilteredItems.length) return [];
    const bases = new Set<string>();
    for (const r of periodFilteredItems) {
      if (r.buyer) bases.add(baseBuyerName(r.buyer));
    }
    return [...bases].sort();
  }, [periodFilteredItems]);
  // 絞り込み用 (生バイヤー名 — 再販・XX と XX を分離) — テーブルフィルタ行用
  const uniqueBuyersRaw = useMemo(() => {
    if (!periodFilteredItems.length) return [];
    const raw = new Set<string>();
    for (const r of periodFilteredItems) {
      if (r.buyer) raw.add(r.buyer);
    }
    return [...raw].sort();
  }, [periodFilteredItems]);

  const marketName = markets.find((m) => m.id === market)?.name || market;

  // 市場切替 (ドロップダウン + よく使う市場のクイックボタン)
  const marketTabs = (
    <div className="flex gap-1 items-center">
      <select
        value={market}
        onChange={(e) => loadMarket(e.target.value)}
        disabled={loading}
        className="px-2 py-1 text-[18px] font-semibold border border-[#b0aab8] rounded-sm bg-white focus:outline-none focus:border-[#4a7dff]"
        style={{ minWidth: 120 }}
      >
        {markets.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </div>
  );

  // 半期フィルタ適用後の集計テーブル
  // 市場別集計
  const periodMarketSummary = useMemo<GroupSummary[]>(() => {
    const items = periodFilteredItems;
    const map = new Map<string, { count: number; lossCount: number; purchase: number; profit: number }>();
    for (const r of items) {
      const k = r.source || "(不明)";
      const e = map.get(k) || { count: 0, lossCount: 0, purchase: 0, profit: 0 };
      e.count++;
      if (r.profit < 0) e.lossCount++;
      e.purchase += r.purchaseTax;
      e.profit += r.profit;
      map.set(k, e);
    }
    return [...map.entries()].map(([name, v]) => ({
      name,
      count: v.count,
      lossCount: v.lossCount,
      purchase: Math.round(v.purchase),
      profit: Math.round(v.profit),
      profitRate: v.purchase > 0 ? Math.round((v.profit / v.purchase) * 1000) / 10 : 0,
    })).sort((a, b) => b.count - a.count);
  }, [periodFilteredItems]);

  const periodDateSummary = useMemo<DateSummary[]>(() => {
    const items = periodFilteredItems;
    const map = new Map<string, { count: number; lossCount: number; returnedCount: number; purchase: number; sale: number; profit: number }>();
    for (const r of items) {
      const e = map.get(r.date) || { count: 0, lossCount: 0, returnedCount: 0, purchase: 0, sale: 0, profit: 0 };
      e.count++;
      if (r.profit < 0) e.lossCount++;
      if (r.isReturned) e.returnedCount++;
      e.purchase += r.purchaseTax;
      e.sale += r.saleTax;
      e.profit += r.profit;
      map.set(r.date, e);
    }
    return [...map.entries()].map(([date, v]) => ({
      date,
      count: v.count,
      lossCount: v.lossCount,
      returnedCount: v.returnedCount,
      purchase: Math.round(v.purchase),
      sale: Math.round(v.sale),
      profit: Math.round(v.profit),
      profitRate: v.purchase > 0 ? Math.round((v.profit / v.purchase) * 1000) / 10 : 0,
    })).sort((a, b) => a.date.localeCompare(b.date));
  }, [periodFilteredItems]);

  const periodBrandSummary = useMemo<GroupSummary[]>(() => {
    const items = periodFilteredItems;
    const map = new Map<string, { count: number; lossCount: number; purchase: number; profit: number }>();
    for (const r of items) {
      const k = r.brand || "(なし)";
      const e = map.get(k) || { count: 0, lossCount: 0, purchase: 0, profit: 0 };
      e.count++;
      if (r.profit < 0) e.lossCount++;
      e.purchase += r.purchaseTax;
      e.profit += r.profit;
      map.set(k, e);
    }
    return [...map.entries()].map(([name, v]) => ({
      name,
      count: v.count,
      lossCount: v.lossCount,
      purchase: Math.round(v.purchase),
      profit: Math.round(v.profit),
      profitRate: v.purchase > 0 ? Math.round((v.profit / v.purchase) * 1000) / 10 : 0,
    })).sort((a, b) => b.profit - a.profit);
  }, [periodFilteredItems]);

  const periodBuyerSummary = useMemo<(GroupSummary & { resaleCount?: number })[]>(() => {
    const items = periodFilteredItems;
    const map = new Map<string, { count: number; lossCount: number; purchase: number; profit: number; returnCount: number; returnFee: number; resaleCount: number }>();
    for (const r of items) {
      const k = baseBuyerName(r.buyer || "(なし)");
      const e = map.get(k) || { count: 0, lossCount: 0, purchase: 0, profit: 0, returnCount: 0, returnFee: 0, resaleCount: 0 };
      e.count++;
      if (r.profit < 0) e.lossCount++;
      if (r.buyer?.startsWith("再販")) e.resaleCount++;
      e.purchase += r.purchaseTax;
      e.profit += r.profit;
      if (r.isReturned) { e.returnCount++; e.returnFee += r.returnFee; }
      map.set(k, e);
    }
    return [...map.entries()].map(([name, v]) => ({
      name,
      count: v.count,
      lossCount: v.lossCount,
      purchase: Math.round(v.purchase),
      profit: Math.round(v.profit),
      profitRate: v.purchase > 0 ? Math.round((v.profit / v.purchase) * 1000) / 10 : 0,
      returnCount: v.returnCount,
      returnFee: Math.round(v.returnFee),
      resaleCount: v.resaleCount,
    })).sort((a, b) => b.profit - a.profit);
  }, [periodFilteredItems]);

  if (loading) {
    return (
      <div className="min-h-screen">
        <AnalysisHeader marketName={marketName} marketTabs={marketTabs} />
        <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
          <div className="text-center">
            <div className="text-[54px] mb-4 animate-bounce">📊</div>
            <p className="text-[27px] font-bold">分析中...</p>
            <p className="text-[21px] text-[var(--fg-muted)] mt-1">{marketName}のExcelを読み取っています</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen">
        <AnalysisHeader marketName={marketName} marketTabs={marketTabs} />
        <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
          <div className="border border-[#b0aab8] rounded-sm bg-white p-8 max-w-md text-center">
            <p className="text-[27px] font-bold text-[var(--danger)]">エラー</p>
            <p className="text-[21px] mt-2">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { returnPeriodSummary } = data;
  const s = periodSummary || data.summary;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <AnalysisHeader marketName={marketName} marketTabs={marketTabs} />

      <main className="flex-1 flex flex-col overflow-hidden max-w-[1920px] w-full mx-auto px-3 md:px-4">
        {/* 上部固定エリア */}
        <div className="shrink-0 py-1.5 space-y-1.5">
          {/* 期間切替 */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[17px] font-semibold text-[var(--fg-muted)]">期間:</span>
            <button onClick={() => setFilterPeriod("all")}
              className={`excel-btn ${filterPeriod === "all" ? "excel-btn-primary" : ""}`}>
              全期間
            </button>
            {availablePeriods.map(pid => (
              <button key={pid} onClick={() => setFilterPeriod(pid)}
                className={`excel-btn ${filterPeriod === pid ? "excel-btn-primary" : ""}`}>
                {getPeriodLabel(pid)}
              </button>
            ))}
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <SummaryCard
              label="販売件数"
              value={`${s.totalItems}件`}
              sub={`赤字 ${s.totalLoss}件 / 引き ${s.totalReturned}件${s.totalReturnFee > 0 ? ` (手数料 ${yen(s.totalReturnFee)})` : ""}`}
              color="var(--ink-cyan)"
            />
            <SummaryCard
              label="仕入総額(税込)"
              value={yen(s.totalPurchase)}
              sub={`手数料 ${yen(s.totalFee)}`}
              color="var(--ink-purple)"
            />
            <SummaryCard
              label="利益総額"
              value={yen(s.totalProfit)}
              sub={`キャンペーン ${yen(s.totalCampaign)}`}
              color={s.totalProfit >= 0 ? "var(--ink-lime)" : "var(--danger-soft)"}
            />
            <SummaryCard
              label="利益率"
              value={pct(s.profitRate)}
              sub={`${s.totalItems - s.totalLoss}件黒字 / ${s.totalLoss}件赤字`}
              color={s.profitRate >= 0 ? "var(--ink-yellow)" : "var(--danger-soft)"}
            />
          </div>

          {/* 引き手数料 半期別・バイヤー別内訳 (コメ兵のみ) */}
          {returnPeriodSummary.length > 0 && (
            <ReturnFeePeriodPanel periods={returnPeriodSummary} summary={s} />
          )}

          {/* Tabs */}
          <div className="flex items-center gap-1.5">
            {marketTabs}
            <div className="h-5 w-px bg-[#d5d0dc] mx-0.5" />
            <button
              onClick={() => setActiveTab("summary")}
              className={`excel-btn ${activeTab === "summary" ? "excel-btn-primary" : ""}`}
            >
              集計
            </button>
            <button
              onClick={() => setActiveTab("items")}
              className={`excel-btn ${activeTab === "items" ? "excel-btn-primary" : ""}`}
            >
              商品一覧 ({data.items.length}件)
            </button>
          </div>
        </div>

        {activeTab === "summary" && (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3 overflow-hidden pb-2">
            {/* Market Summary (左・大きく) */}
            <div className="border border-[#b0aab8] rounded-sm p-2 bg-white flex flex-col overflow-hidden">
              <h3 className="text-[21px] mb-1 shrink-0">市場別</h3>
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-[21px] border-collapse border border-[#b0aab8]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[#e8e4f0]">
                      <th className="text-left border border-[#b0aab8] px-2 py-1">市場名</th>
                      <th className="text-right border border-[#b0aab8] px-2 py-1">件数</th>
                      <th className="text-right border border-[#b0aab8] px-2 py-1">赤字</th>
                      <th className="text-right border border-[#b0aab8] px-2 py-1">仕入</th>
                      <th className="text-right border border-[#b0aab8] px-2 py-1">利益</th>
                      <th className="text-right border border-[#b0aab8] px-2 py-1">率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodMarketSummary.map((m) => (
                      <tr
                        key={m.name}
                        className="cursor-pointer hover:bg-[#eef4ff]"
                        onClick={() => { setFilterText(m.name); setActiveTab("items"); }}
                      >
                        <td className="border border-[#d5d0dc] px-2 py-1">{m.name}</td>
                        <td className="text-right border border-[#d5d0dc] px-2 py-1">{m.count}</td>
                        <td className="text-right border border-[#d5d0dc] px-2 py-1">{m.lossCount}</td>
                        <td className="text-right border border-[#d5d0dc] px-2 py-1">{yen(m.purchase)}</td>
                        <td className={`text-right font-bold border border-[#d5d0dc] px-2 py-1 ${m.profit < 0 ? "text-[var(--danger)]" : ""}`}>
                          {yen(m.profit)}
                        </td>
                        <td className={`text-right border border-[#d5d0dc] px-2 py-1 ${m.profitRate < 0 ? "text-[var(--danger)]" : ""}`}>
                          {pct(m.profitRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#f0edf5]">
                      <td className="font-bold border border-[#b0aab8] px-2 py-1">合計</td>
                      <td className="text-right font-bold border border-[#b0aab8] px-2 py-1">{s.totalItems}</td>
                      <td className="text-right font-bold border border-[#b0aab8] px-2 py-1">{s.totalLoss}</td>
                      <td className="text-right font-bold border border-[#b0aab8] px-2 py-1">{yen(s.totalPurchase)}</td>
                      <td className={`text-right font-bold border border-[#b0aab8] px-2 py-1 ${s.totalProfit < 0 ? "text-[var(--danger)]" : ""}`}>
                        {yen(s.totalProfit)}
                      </td>
                      <td className={`text-right font-bold border border-[#b0aab8] px-2 py-1 ${s.profitRate < 0 ? "text-[var(--danger)]" : ""}`}>
                        {pct(s.profitRate)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Brand / Buyer 切替 (右) */}
            <div className="border border-[#b0aab8] rounded-sm p-2 bg-white flex flex-col overflow-hidden">
              <div className="flex items-end gap-0 mb-1 shrink-0">
                <button
                  onClick={() => setSummarySubTab("buyer")}
                  className={`px-4 py-1.5 text-[20px] font-semibold border border-[#b0aab8] rounded-t-md transition-colors ${
                    summarySubTab === "buyer"
                      ? "bg-white border-b-white -mb-px z-10 relative"
                      : "bg-[#e8e4f0] text-[var(--fg-muted)] hover:bg-[#f0edf5]"
                  }`}
                >
                  バイヤー別
                </button>
                <button
                  onClick={() => setSummarySubTab("brand")}
                  className={`px-4 py-1.5 text-[20px] font-semibold border border-[#b0aab8] rounded-t-md transition-colors ${
                    summarySubTab === "brand"
                      ? "bg-white border-b-white -mb-px z-10 relative"
                      : "bg-[#e8e4f0] text-[var(--fg-muted)] hover:bg-[#f0edf5]"
                  }`}
                >
                  ブランド別
                </button>
              </div>

              {summarySubTab === "brand" && (
                <div className="overflow-y-auto flex-1">
                  <table className="w-full text-[21px] border-collapse border border-[#b0aab8]">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#e8e4f0]">
                        <th className="text-left border border-[#b0aab8] px-2 py-1">ブランド</th>
                        <th className="text-right border border-[#b0aab8] px-2 py-1">件数</th>
                        <th className="text-right border border-[#b0aab8] px-2 py-1">利益</th>
                        <th className="text-right border border-[#b0aab8] px-2 py-1">率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodBrandSummary.map((b) => (
                        <tr
                          key={b.name}
                          className="cursor-pointer hover:bg-[#eef4ff]"
                          onClick={() => { setFilterBrand(b.name); setActiveTab("items"); }}
                        >
                          <td className="max-w-[180px] truncate border border-[#d5d0dc] px-2 py-1" title={b.name}>{b.name}</td>
                          <td className="text-right border border-[#d5d0dc] px-2 py-1">
                            {b.count}
                            {b.lossCount > 0 && <span className="text-[var(--fg-muted)] text-[15px] ml-0.5">({b.lossCount})</span>}
                          </td>
                          <td className={`text-right font-bold border border-[#d5d0dc] px-2 py-1 ${b.profit < 0 ? "text-[var(--danger)]" : ""}`}>
                            {yen(b.profit)}
                          </td>
                          <td className={`text-right border border-[#d5d0dc] px-2 py-1 ${b.profitRate < 0 ? "text-[var(--danger)]" : ""}`}>
                            {pct(b.profitRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {summarySubTab === "buyer" && (
                <div className="overflow-y-auto flex-1">
                  <table className="w-full text-[21px] border-collapse border border-[#b0aab8]">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#e8e4f0]">
                        <th className="text-left border border-[#b0aab8] px-2 py-1">バイヤー</th>
                        <th className="text-right border border-[#b0aab8] px-2 py-1">件数</th>
                        <th className="text-right border border-[#b0aab8] px-2 py-1">仕入</th>
                        <th className="text-right border border-[#b0aab8] px-2 py-1">利益</th>
                        <th className="text-right border border-[#b0aab8] px-2 py-1">率</th>
                        {s.totalReturnFee > 0 && (
                          <>
                            <th className="text-right border border-[#b0aab8] px-2 py-1">引き</th>
                            <th className="text-right border border-[#b0aab8] px-2 py-1">引き手数料</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {periodBuyerSummary.map((b) => (
                        <tr
                          key={b.name}
                          className="cursor-pointer hover:bg-[#eef4ff]"
                          onClick={() => { setFilterBuyer(b.name); setActiveTab("items"); }}
                        >
                          <td className="border border-[#d5d0dc] px-2 py-1">
                            {b.name}
                            {(b.resaleCount || 0) > 0 && (
                              <span className="text-[var(--fg-muted)] text-[15px] ml-1">再販{b.resaleCount}</span>
                            )}
                          </td>
                          <td className="text-right border border-[#d5d0dc] px-2 py-1">
                            {b.count}
                            {b.lossCount > 0 && <span className="text-[var(--fg-muted)] text-[15px] ml-0.5">({b.lossCount})</span>}
                          </td>
                          <td className="text-right border border-[#d5d0dc] px-2 py-1">{yen(b.purchase)}</td>
                          <td className={`text-right font-bold border border-[#d5d0dc] px-2 py-1 ${b.profit < 0 ? "text-[var(--danger)]" : ""}`}>
                            {yen(b.profit)}
                          </td>
                          <td className={`text-right border border-[#d5d0dc] px-2 py-1 ${b.profitRate < 0 ? "text-[var(--danger)]" : ""}`}>
                            {pct(b.profitRate)}
                          </td>
                          {s.totalReturnFee > 0 && (
                            <>
                              <td className="text-right text-[var(--fg-muted)] border border-[#d5d0dc] px-2 py-1">
                                {(b.returnCount || 0) > 0 ? `${b.returnCount}件` : ""}
                              </td>
                              <td className="text-right text-[var(--fg-muted)] border border-[#d5d0dc] px-2 py-1">
                                {(b.returnFee || 0) > 0 ? yen(b.returnFee || 0) : ""}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    {s.totalReturnFee > 0 && (
                      <tfoot>
                        <tr className="bg-[#f0edf5]">
                          <td className="font-bold border border-[#b0aab8] px-2 py-1">引き手数料合計</td>
                          <td colSpan={4} className="border border-[#b0aab8] px-2 py-1"></td>
                          <td className="text-right font-bold border border-[#b0aab8] px-2 py-1">
                            {periodBuyerSummary.reduce((x, b) => x + (b.returnCount || 0), 0)}件
                          </td>
                          <td className="text-right font-bold border border-[#b0aab8] px-2 py-1">
                            {yen(s.totalReturnFee)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "items" && (
          <div className="flex-1 flex flex-col overflow-hidden pb-2 gap-1.5">
            {/* Filters */}
            <div className="shrink-0 border border-[#b0aab8] rounded-sm p-1.5 bg-[#f8f6fa]">
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="px-2 py-1 text-[18px] border border-[#b0aab8] rounded-sm bg-white max-w-[160px] focus:outline-none focus:border-[#4a7dff]"
                >
                  <option value="">全日付</option>
                  {uniqueDates.map((d) => (
                    <option key={d} value={d}>{dateLabel(d)}</option>
                  ))}
                </select>
                <select
                  value={filterBrand}
                  onChange={(e) => setFilterBrand(e.target.value)}
                  className="px-2 py-1 text-[18px] border border-[#b0aab8] rounded-sm bg-white max-w-[180px] focus:outline-none focus:border-[#4a7dff]"
                >
                  <option value="">全ブランド</option>
                  {uniqueBrands.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <select
                  value={filterBuyer}
                  onChange={(e) => setFilterBuyer(e.target.value)}
                  className="px-2 py-1 text-[18px] border border-[#b0aab8] rounded-sm bg-white max-w-[140px] focus:outline-none focus:border-[#4a7dff]"
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
                  className="px-2 py-1 text-[18px] border border-[#b0aab8] rounded-sm bg-white max-w-[200px] focus:outline-none focus:border-[#4a7dff]"
                />
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showLossOnly}
                    onChange={(e) => setShowLossOnly(e.target.checked)}
                    className="w-4 h-4 accent-[#4a7dff]"
                  />
                  <span className="text-[17px] font-semibold">赤字のみ</span>
                </label>
                {hasAnyFilter && (
                  <button
                    onClick={() => { setFilterDate(""); setFilterBrand(""); setFilterBuyer(""); setFilterText(""); setFilterListingId(""); setFilterItemNo(""); setFilterCondition(""); setShowLossOnly(false); }}
                    className="excel-btn"
                  >
                    × クリア
                  </button>
                )}
              </div>
              {filteredSummary && (
                <div className="flex items-center gap-4 mt-2 text-[18px]">
                  <span className="px-2 py-0.5 bg-[#e8e8e8] border border-[#c0c0c0] rounded-sm text-[17px] font-semibold">{filteredSummary.count}件</span>
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
            <div className="flex-1 border border-[#b0aab8] rounded-sm bg-white overflow-auto">
              <table className="w-full text-[21px] whitespace-nowrap border-collapse border border-[#b0aab8]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#e8e4f0]">
                    <Th label="日付" sortKey="date" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <Th label="出品番号" sortKey="listingId" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <Th label="商品番号" sortKey="itemNo" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <Th label="ブランド" sortKey="brand" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <Th label="商品名" sortKey="itemName" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <th className="text-left border border-[#b0aab8] px-2 py-1">状態</th>
                    <Th label="バイヤー" sortKey="buyer" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} />
                    <Th label="仕入(税込)" sortKey="purchaseTax" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} align="right" />
                    <Th label="売り(税込)" sortKey="saleTax" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} align="right" />
                    <Th label="手数料(税込)" sortKey="feeTax" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} align="right" />
                    <Th label="CP(税込)" sortKey="campaignTax" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} align="right" />
                    <Th label="利益" sortKey="profit" current={sortKey} dir={sortDir} onClick={handleSort} indicator={sortIndicator} align="right" />
                  </tr>
                  {/* フィルタ行 */}
                  <tr className="bg-[#f8f6fa]">
                    <td className="border border-[#b0aab8] px-1 py-0.5">
                      <select value={filterDate} onChange={e => setFilterDate(e.target.value)}
                        className="w-full px-1 py-0.5 text-[15px] border border-[#d5d0dc] rounded-sm bg-white focus:outline-none focus:border-[#4a7dff]">
                        <option value="">全て</option>
                        {uniqueDates.map(d => <option key={d} value={d}>{dateLabel(d)}</option>)}
                      </select>
                    </td>
                    <td className="border border-[#b0aab8] px-1 py-0.5">
                      <input type="text" value={filterListingId} onChange={e => setFilterListingId(e.target.value)}
                        placeholder="絞込" className="w-full px-1 py-0.5 text-[15px] border border-[#d5d0dc] rounded-sm bg-white focus:outline-none focus:border-[#4a7dff]" />
                    </td>
                    <td className="border border-[#b0aab8] px-1 py-0.5">
                      <input type="text" value={filterItemNo} onChange={e => setFilterItemNo(e.target.value)}
                        placeholder="絞込" className="w-full px-1 py-0.5 text-[15px] border border-[#d5d0dc] rounded-sm bg-white focus:outline-none focus:border-[#4a7dff]" />
                    </td>
                    <td className="border border-[#b0aab8] px-1 py-0.5">
                      <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
                        className="w-full px-1 py-0.5 text-[15px] border border-[#d5d0dc] rounded-sm bg-white focus:outline-none focus:border-[#4a7dff]">
                        <option value="">全て</option>
                        {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                    <td className="border border-[#b0aab8] px-1 py-0.5">
                      <input type="text" value={filterText} onChange={e => setFilterText(e.target.value)}
                        placeholder="絞込" className="w-full px-1 py-0.5 text-[15px] border border-[#d5d0dc] rounded-sm bg-white focus:outline-none focus:border-[#4a7dff]" />
                    </td>
                    <td className="border border-[#b0aab8] px-1 py-0.5">
                      <input type="text" value={filterCondition} onChange={e => setFilterCondition(e.target.value)}
                        placeholder="絞込" className="w-full px-1 py-0.5 text-[15px] border border-[#d5d0dc] rounded-sm bg-white focus:outline-none focus:border-[#4a7dff]" />
                    </td>
                    <td className="border border-[#b0aab8] px-1 py-0.5">
                      <select value={filterBuyer} onChange={e => setFilterBuyer(e.target.value)}
                        className="w-full px-1 py-0.5 text-[15px] border border-[#d5d0dc] rounded-sm bg-white focus:outline-none focus:border-[#4a7dff]">
                        <option value="">全て</option>
                        {uniqueBuyersRaw.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                    <td className="border border-[#b0aab8] px-1 py-0.5" />
                    <td className="border border-[#b0aab8] px-1 py-0.5" />
                    <td className="border border-[#b0aab8] px-1 py-0.5" />
                    <td className="border border-[#b0aab8] px-1 py-0.5" />
                    <td className="border border-[#b0aab8] px-1 py-0.5">
                      <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
                        <input type="checkbox" checked={showLossOnly} onChange={e => setShowLossOnly(e.target.checked)}
                          className="w-4 h-4 accent-[#4a7dff]" />
                        <span className="text-[15px]">赤字</span>
                      </label>
                    </td>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((r, i) => (
                    <tr
                      key={`${r.date}-${r.itemNo}-${i}`}
                      className={`hover:bg-[#eef4ff] ${r.isReturned ? "bg-[var(--bg-muted)]/60" : r.profit < 0 ? "bg-[var(--danger-soft)]/40" : ""}`}
                    >
                      <td className="border border-[#d5d0dc] px-2 py-1">{dateLabel(r.date)}</td>
                      <td className="font-mono text-[18px] border border-[#d5d0dc] px-2 py-1">{r.listingId}</td>
                      <td className="font-mono text-[18px] border border-[#d5d0dc] px-2 py-1">{r.itemNo}</td>
                      <td className="max-w-[120px] truncate border border-[#d5d0dc] px-2 py-1" title={r.brand}>{r.brand}</td>
                      <td className="max-w-[240px] truncate border border-[#d5d0dc] px-2 py-1" title={r.itemName}>{r.itemName}</td>
                      <td className="border border-[#d5d0dc] px-2 py-1">{r.condition}</td>
                      <td className="border border-[#d5d0dc] px-2 py-1">{r.buyer}</td>
                      <td className="text-right font-mono border border-[#d5d0dc] px-2 py-1">{yen(r.purchaseTax)}</td>
                      {r.isReturned ? (
                        <>
                          <td className="text-center text-[var(--fg-muted)] font-bold border border-[#d5d0dc] px-2 py-1" colSpan={3}>引き</td>
                          <td className="text-right font-mono text-[var(--fg-muted)] border border-[#d5d0dc] px-2 py-1">
                            {r.returnFee > 0 ? `-${yen(r.returnFee)}` : ""}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="text-right font-mono border border-[#d5d0dc] px-2 py-1">{yen(r.saleTax)}</td>
                          <td className="text-right font-mono text-[var(--fg-muted)] border border-[#d5d0dc] px-2 py-1">{yen(r.feeTax)}</td>
                          <td className="text-right font-mono text-[var(--fg-muted)] border border-[#d5d0dc] px-2 py-1">{r.campaignTax !== 0 ? yen(r.campaignTax) : ""}</td>
                          <td className={`text-right font-mono font-bold border border-[#d5d0dc] px-2 py-1 ${r.profit < 0 ? "text-[var(--danger)]" : ""}`}>
                            {yen(r.profit)}
                          </td>
                        </>
                      )}
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
    <div className="border border-[#b0aab8] rounded-sm px-3 py-1.5" style={{ background: color }}>
      <p className="text-[15px] font-bold text-[var(--fg-muted)]">{label}</p>
      <p className="text-[30px] font-black tabular-nums leading-tight" style={{ fontStyle: "normal" }}>
        {value}
      </p>
      <p className="text-[14px] text-[var(--fg-muted)]">{sub}</p>
    </div>
  );
}

function ReturnFeePeriodPanel({
  periods,
  summary,
}: {
  periods: AnalysisData["returnPeriodSummary"];
  summary: AnalysisData["summary"];
}) {
  const [selected, setSelected] = useState("");
  const current = selected ? periods.find((p) => p.period === selected) : null;

  return (
    <div className="border border-[#b0aab8] rounded-sm p-3 bg-white">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[18px] font-bold">
          引き手数料 合計 {yen(summary.totalReturnFee)}（{summary.totalReturned}件 × ¥500）
        </span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="px-2 py-1 text-[18px] border border-[#b0aab8] rounded-sm bg-white max-w-[220px] focus:outline-none focus:border-[#4a7dff]"
        >
          <option value="">— 半期を選択 —</option>
          {periods.map((p) => (
            <option key={p.period} value={p.period}>
              {p.period}（{p.totalCount}件 {yen(p.totalFee)}）
            </option>
          ))}
        </select>
      </div>
      {current && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[18px]">
          {current.buyers.map((b) => (
            <span key={b.buyer} className="text-[var(--fg-muted)]">
              {b.buyer}: {b.count}件 {yen(b.fee)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisHeader({ marketName, marketTabs }: { marketName: string; marketTabs: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#b0aab8] bg-[#f0edf5]">
      <div className="max-w-[1920px] mx-auto px-3 md:px-4 h-10 flex items-center gap-3">
        <a
          href="/"
          className="w-6 h-6 flex items-center justify-center text-[21px] font-bold bg-[#4a7d4a] text-white rounded-sm"
        >
          A
        </a>
        <h1 className="text-[21px] font-bold tracking-tight" style={{ fontStyle: "normal" }}>
          過去結果分析
        </h1>
        <span className="px-2 py-0.5 bg-[#e0eaff] border border-[#b0c4de] rounded-sm text-[17px] font-semibold">
          {marketName}
        </span>

        <div className="hidden md:flex items-center">{marketTabs}</div>

        <div className="ml-auto flex items-center gap-1.5">
          <a href="/" className="excel-btn">
            ← あご表作成
          </a>
          <a href="/settings" className="excel-btn" title="設定">
            ⚙ 設定
          </a>
        </div>
      </div>
    </header>
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
      className={`text-${align} cursor-pointer select-none hover:bg-[#d8d4e0] border border-[#b0aab8] px-2 py-1`}
      onClick={() => onClick(key)}
    >
      {label}{indicator(key)}
    </th>
  );
}

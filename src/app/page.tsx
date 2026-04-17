"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import BarcodeScanner from "@/components/BarcodeScanner";
import { getS3ImageUrl } from "@/lib/s3ImageUrl";
import { resolveColumnValue, DEFAULT_FORMAT_COLUMNS, getMarketPreset, type ResolverRow } from "@/lib/columnFields";
import type { ColumnDef, MarketFormat, FormatType } from "@/app/api/settings/route";

const fetchImages = async (itemNumber: string): Promise<{ mainImage: string | null; frontImage: string | null; urls: string[] }> => {
  try {
    const res = await fetch(`/api/images?itemNumber=${encodeURIComponent(itemNumber)}`);
    if (!res.ok) return { mainImage: null, frontImage: null, urls: [] };
    const data = await res.json();
    return {
      mainImage: data.mainImage || null,
      frontImage: data.frontImage || null,
      urls: data.urls || [],
    };
  } catch {
    return { mainImage: null, frontImage: null, urls: [] };
  }
};

interface KintoneData {
  itemNumber: string;
  brand: string;
  bagName: string;
  title: string;
  buyerCode: string;
  buyerName: string;
  purchasePrice: string;
  salePrice: string;
  cataReserve: string;
  maxPrice: string;
  desiredPrice: string;
  lotNo: string;
  boxNoInternal: string;
  boxNoMarket: string;
  accessories: string;
  conditionText: string;
  category: string;
  date: string;
  market: string;
}

interface RowData {
  id: string;
  itemNumber: string;
  listingNumber: string;  // 出品番号 (マーケットの出品ID)
  brand: string;
  itemName: string;       // バッグ名
  accessories: string;
  condition: string;
  reservePrice: string;   // Cataリザーブ / マックス金額
  buyer: string;          // バイヤー (コード or 名前)
  purchasePrice: string;  // 仕入価格
  salePrice: string;      // 販売価格
  saleAmount: string;     // 売り金額 (実際に売れた金額)
  fee: string;            // 手数料
  campaign: string;       // キャンペーンキャッシュバック
  lotNo: string;
  boxNo: string;
  imageUrl: string;       // 代表画像 (x.jpg)
  frontImageUrl: string;  // 正面画像 (写真0.jpg)
  imageUrls: string[];
  geminiTitle: string;
  kintoneTitle: string;
  soldOut: boolean;       // 売切フラグ
  tkb: boolean;           // TKBフラグ
  broken: boolean;        // 壊れフラグ
  copy: boolean;          // コピーフラグ
  priceLocked: boolean;   // 指値ロック (一括操作の対象外にする)
  status: "empty" | "loading" | "ok" | "error";
  errorMsg?: string;
}

const emptyRow = (): RowData => ({
  id: crypto.randomUUID(),
  itemNumber: "",
  listingNumber: "",
  brand: "",
  itemName: "",
  accessories: "",
  condition: "",
  reservePrice: "",
  buyer: "",
  purchasePrice: "",
  salePrice: "",
  saleAmount: "",
  fee: "",
  campaign: "",
  lotNo: "",
  boxNo: "",
  imageUrl: "",
  frontImageUrl: "",
  imageUrls: [],
  geminiTitle: "",
  kintoneTitle: "",
  soldOut: false,
  tkb: false,
  broken: false,
  copy: false,
  priceLocked: false,
  status: "empty",
});

interface SheetMeta {
  id: string;
  name: string;
  updated_at: string;
}

interface AppSettings {
  market: string;
  buyerMap: Record<string, string>;
  marketFormats: Record<string, MarketFormat>;
  taxRate: number;
}

interface HistoryResult {
  id: string;
  sheet_id: string;
  item_number: string | null;
  brand: string | null;
  item_name: string | null;
  reserve_price: string | null;
  buyer: string | null;
  purchase_price: string | null;
  sale_price: string | null;
  condition: string | null;
  sold_out: boolean;
  updated_at: string;
  ago_sheets: { id: string; name: string; updated_at: string } | null;
}

// DBスキーマ ↔ UI形式変換
const dbToRow = (r: Record<string, unknown>): RowData => ({
  id: crypto.randomUUID(),
  itemNumber: (r.item_number as string) || "",
  listingNumber: (r.listing_number as string) || "",
  brand: (r.brand as string) || "",
  itemName: (r.item_name as string) || "",
  accessories: (r.accessories as string) || "",
  condition: (r.condition as string) || "",
  reservePrice: (r.reserve_price as string) || "",
  buyer: (r.buyer as string) || "",
  purchasePrice: (r.purchase_price as string) || "",
  salePrice: (r.sale_price as string) || "",
  saleAmount: (r.sale_amount as string) || "",
  fee: (r.fee as string) || "",
  campaign: (r.campaign as string) || "",
  lotNo: (r.lot_no as string) || "",
  boxNo: (r.box_no as string) || "",
  imageUrl: (r.image_url as string) || "",
  frontImageUrl: (r.front_image_url as string) || "",
  imageUrls: [],
  geminiTitle: (r.gemini_title as string) || "",
  kintoneTitle: (r.kintone_title as string) || "",
  soldOut: !!r.sold_out,
  tkb: !!r.tkb,
  broken: !!r.broken,
  copy: !!r.copy,
  priceLocked: !!(r.reserve_price as string)?.trim(), // DBから読込時は指値の有無で判定
  status: r.item_number ? "ok" : "empty",
});

const rowToDb = (r: RowData) => ({
  item_number: r.itemNumber || null,
  listing_number: r.listingNumber || null,
  brand: r.brand || null,
  item_name: r.itemName || null,
  accessories: r.accessories || null,
  condition: r.condition || null,
  reserve_price: r.reservePrice || null,
  buyer: r.buyer || null,
  purchase_price: r.purchasePrice || null,
  sale_price: r.salePrice || null,
  sale_amount: r.saleAmount || null,
  fee: r.fee || null,
  campaign: r.campaign || null,
  lot_no: r.lotNo || null,
  box_no: r.boxNo || null,
  image_url: r.imageUrl || null,
  front_image_url: r.frontImageUrl || null,
  kintone_title: r.kintoneTitle || null,
  gemini_title: r.geminiTitle || null,
  sold_out: r.soldOut,
  tkb: r.tkb,
  broken: r.broken,
  copy: r.copy,
});

export default function Home() {
  const [rows, setRows] = useState<RowData[]>([emptyRow()]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [multiplier, setMultiplier] = useState("1.5");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStartBox, setBulkStartBox] = useState("");
  const [bulkStartNo, setBulkStartNo] = useState("1");
  const [bulkNumberingMode, setBulkNumberingMode] = useState<"box10" | "serial">("box10");
  const [fileName, setFileName] = useState("あご表");
  const [savedAt, setSavedAt] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [sheetList, setSheetList] = useState<SheetMeta[]>([]);
  const [saving, setSaving] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyResults, setHistoryResults] = useState<HistoryResult[]>([]);
  const [settings, setSettings] = useState<AppSettings>({ market: "", buyerMap: {}, marketFormats: {}, taxRate: 10 });
  const [activeTab, setActiveTab] = useState<"listing" | "sales">("listing");
  const inputRef = useRef<HTMLInputElement>(null);

  const ACTIVE_SHEET_KEY = "ichiba-uri-active-sheet-id";

  // シート一覧を取得
  const loadSheetList = async () => {
    try {
      const res = await fetch("/api/sheets");
      if (!res.ok) return;
      const data = await res.json();
      setSheetList(data.sheets || []);
    } catch (e) {
      console.error("loadSheetList error:", e);
    }
  };

  // 指定IDのシートを読み込み
  const loadSheet = async (id: string) => {
    try {
      const res = await fetch(`/api/sheets/${id}`);
      if (!res.ok) {
        // シートが存在しない (削除済み等) → activeをクリア
        localStorage.removeItem(ACTIVE_SHEET_KEY);
        setSheetId(null);
        return;
      }
      const data = await res.json();
      setSheetId(data.sheet.id);
      setFileName(data.sheet.name);
      setSavedAt(new Date(data.sheet.updated_at).toLocaleString("ja-JP"));
      const loadedRows: RowData[] = (data.rows || []).map(dbToRow);
      setRows(loadedRows.length > 0 ? loadedRows : [emptyRow()]);
      localStorage.setItem(ACTIVE_SHEET_KEY, id);
    } catch (e) {
      console.error("loadSheet error:", e);
    }
  };

  // 新規シート作成
  const createNewSheet = async (name?: string) => {
    const sheetName = name || `あご表_${new Date().toLocaleDateString("ja-JP")}`;
    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sheetName }),
      });
      if (!res.ok) {
        alert("シート作成失敗");
        return;
      }
      const data = await res.json();
      setSheetId(data.sheet.id);
      setFileName(data.sheet.name);
      setRows([emptyRow()]);
      setSavedAt("");
      localStorage.setItem(ACTIVE_SHEET_KEY, data.sheet.id);
      await loadSheetList();
    } catch (e) {
      console.error("createNewSheet error:", e);
    }
  };

  // 設定を取得
  const loadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSettings({
        market: data.settings?.market || "",
        buyerMap: data.settings?.buyerMap || {},
        marketFormats: data.settings?.marketFormats || {},
        taxRate: data.settings?.taxRate ?? 10,
      });
    } catch (e) {
      console.error("loadSettings error:", e);
    }
  };

  // 起動時: 設定 + シート一覧取得 → 前回開いていたシートを復元
  useEffect(() => {
    (async () => {
      await Promise.all([loadSettings(), loadSheetList()]);
      const lastId = localStorage.getItem(ACTIVE_SHEET_KEY);
      if (lastId) {
        await loadSheet(lastId);
      }
      setHydrated(true);
      inputRef.current?.focus();
    })();
  }, []);

  // ページ復帰時 (タブ切替/設定画面から戻る) に設定を再読込
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") loadSettings();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // バイヤーコード → 人名変換
  const resolveBuyer = (code: string): string => {
    if (!code) return "";
    return settings.buyerMap[code] || code;
  };

  // 自動保存 (3秒デバウンス、シートが存在する場合のみ)
  useEffect(() => {
    if (!hydrated || !sheetId) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      try {
        const dbRows = rows
          .filter(r => r.itemNumber || r.brand || r.itemName)
          .map(rowToDb);
        const res = await fetch(`/api/sheets/${sheetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: fileName, rows: dbRows }),
        });
        if (res.ok) {
          const now = new Date().toLocaleString("ja-JP");
          setSavedAt(now);
          // シート一覧の updated_at も更新
          setSheetList(prev =>
            prev.map(s => (s.id === sheetId ? { ...s, name: fileName, updated_at: new Date().toISOString() } : s))
          );
        }
      } catch (e) {
        console.error("Auto-save error:", e);
      } finally {
        setSaving(false);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [rows, fileName, sheetId, hydrated]);

  const updateRow = useCallback((id: string, patch: Partial<RowData>) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const merged = { ...r, ...patch };
      // 指値が変更された場合、空欄→値ありで自動ロック、値あり→空欄で自動アンロック
      if (patch.reservePrice !== undefined && patch.priceLocked === undefined) {
        const hadValue = !!r.reservePrice?.trim();
        const hasValue = !!patch.reservePrice?.trim();
        if (!hadValue && hasValue) merged.priceLocked = true;
        else if (hadValue && !hasValue) merged.priceLocked = false;
      }
      return merged;
    }));
  }, []);

  const fetchKintoneData = async (itemNumber: string): Promise<KintoneData | null> => {
    try {
      const res = await fetch(`/api/kintone?itemNumber=${encodeURIComponent(itemNumber)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.records?.[0] || null;
    } catch {
      return null;
    }
  };

  const analyzeImage = async (imageUrl: string, itemNumber?: string) => {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, itemNumber }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.data;
    } catch {
      return null;
    }
  };

  const processItemNumber = async (rowId: string, itemNumber: string) => {
    if (!itemNumber || !/^\d+$/.test(itemNumber)) {
      updateRow(rowId, { status: "error", errorMsg: "数字のみ入力してください" });
      return;
    }

    updateRow(rowId, { itemNumber, status: "loading" });

    // 並列でKintone・画像取得
    const [kintoneData, imagesData] = await Promise.all([
      fetchKintoneData(itemNumber),
      fetchImages(itemNumber),
    ]);

    const imageUrl = imagesData.mainImage || getS3ImageUrl(itemNumber, "x");
    const frontImageUrl = imagesData.frontImage || getS3ImageUrl(itemNumber, "0");

    // 正面画像優先でGemini解析（なければ代表画像）
    const analyzeTarget = imagesData.frontImage || imagesData.mainImage;
    const geminiData = analyzeTarget ? await analyzeImage(analyzeTarget, itemNumber) : null;

    const patch: Partial<RowData> = {
      imageUrl,
      frontImageUrl,
      imageUrls: imagesData.urls,
      status: "ok",
    };

    if (!imagesData.mainImage && !imagesData.frontImage) {
      patch.errorMsg = "S3画像なし";
    }

    // Kintoneを主データソースとして使う
    if (kintoneData) {
      patch.brand = kintoneData.brand || "";
      patch.itemName = kintoneData.bagName || "";
      patch.accessories = kintoneData.accessories || "";
      patch.condition = kintoneData.conditionText || "";
      patch.reservePrice = kintoneData.cataReserve || kintoneData.maxPrice || "";
      // バイヤーは設定のマッピングで人名変換
      const rawBuyer = kintoneData.buyerName || kintoneData.buyerCode || "";
      patch.buyer = resolveBuyer(rawBuyer);
      patch.purchasePrice = kintoneData.purchasePrice || "";
      patch.salePrice = kintoneData.salePrice || "";
      patch.lotNo = kintoneData.lotNo || "";
      patch.boxNo = kintoneData.boxNoInternal || kintoneData.boxNoMarket || "";
      patch.kintoneTitle = kintoneData.title || "";
    } else {
      patch.errorMsg = (patch.errorMsg ? patch.errorMsg + " / " : "") + "Kintoneデータなし";
    }

    if (geminiData) {
      patch.geminiTitle = geminiData.title ||
        `${geminiData.brand || ""} ${geminiData.name || ""}`.trim();
      if (!patch.brand && geminiData.brand) patch.brand = geminiData.brand;
      if (!patch.itemName && geminiData.name) patch.itemName = geminiData.name;
    }

    updateRow(rowId, patch);

    // 次の空行を作成・フォーカス
    setTimeout(() => {
      setRows(prev => {
        const last = prev[prev.length - 1];
        if (last.status !== "empty") {
          return [...prev, emptyRow()];
        }
        return prev;
      });
      inputRef.current?.focus();
    }, 200);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const itemNumber = manualInput.trim();
    if (!itemNumber) return;

    const targetRow = rows.find(r => r.status === "empty") || rows[rows.length - 1];
    processItemNumber(targetRow.id, itemNumber);
    setManualInput("");
  };

  const handleBarcodeDetected = (code: string) => {
    setScannerOpen(false);
    const targetRow = activeRowId
      ? rows.find(r => r.id === activeRowId)
      : rows.find(r => r.status === "empty") || rows[rows.length - 1];
    if (targetRow) {
      processItemNumber(targetRow.id, code);
    }
  };

  const addRow = () => setRows(prev => [...prev, emptyRow()]);
  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));

  // 手動保存 (Supabase)
  const saveNow = async () => {
    if (!sheetId) {
      // シート未作成 → 新規作成
      await createNewSheet(fileName);
      return;
    }
    setSaving(true);
    try {
      const dbRows = rows.filter(r => r.itemNumber || r.brand || r.itemName).map(rowToDb);
      const res = await fetch(`/api/sheets/${sheetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fileName, rows: dbRows }),
      });
      if (res.ok) {
        const now = new Date().toLocaleString("ja-JP");
        setSavedAt(now);
        alert(`保存しました\n${now}`);
        await loadSheetList();
      } else {
        const err = await res.json();
        alert(`保存失敗: ${err.error}`);
      }
    } finally {
      setSaving(false);
    }
  };

  // 現在のシートを削除
  const deleteSheet = async () => {
    if (!sheetId) return;
    if (!confirm(`「${fileName}」を完全削除しますか？`)) return;
    const res = await fetch(`/api/sheets/${sheetId}`, { method: "DELETE" });
    if (res.ok) {
      localStorage.removeItem(ACTIVE_SHEET_KEY);
      setSheetId(null);
      setRows([emptyRow()]);
      setFileName("あご表");
      setSavedAt("");
      await loadSheetList();
    }
  };

  // 全クリア (現在の入力をリセット、シートは保持)
  const clearAll = () => {
    if (!confirm("現在のシートの内容をクリアしますか？")) return;
    setRows([emptyRow()]);
  };

  // 過去Excel取込
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(`「${file.name}」から新規シートを作成して取込みますか？\n商品番号・ブランド・バッグ名等が自動マッピングされます。`)) {
      e.target.value = "";
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    try {
      setSaving(true);
      const res = await fetch("/api/sheets/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        alert(`取込失敗: ${data.error}`);
        return;
      }
      alert(
        `取込完了\n` +
          `取込: ${data.importedRows} 行\n` +
          `(データ行: ${data.totalRawRows ?? "?"} 行 / スキップ: ${data.skippedRows ?? 0} 行)\n` +
          `検出列: ${(data.detectedColumns || []).join(", ")}`
      );
      await loadSheetList();
      await loadSheet(data.sheet.id);
    } catch (err) {
      alert(`取込エラー: ${err}`);
    } finally {
      setSaving(false);
      e.target.value = "";
    }
  };

  // 売上取込 (売り金額・手数料をExcelから読込んで既存行に反映)
  const handleSalesImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(`「${file.name}」から売り金額・手数料を読込んで既存行に反映しますか？\n一致判定: 出品番号 または 商品番号`)) {
      e.target.value = "";
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    if (settings.market) fd.append("market", settings.market);
    try {
      setSaving(true);
      const res = await fetch("/api/sales/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        alert(`取込失敗: ${data.error || "不明なエラー"}`);
        return;
      }

      // rows state にマージ
      type Result = { listingNumber: string; itemNumber: string; saleAmount: string; fee: string; campaign: string };
      const results: Result[] = data.results || [];
      let matched = 0;
      let updated = 0;
      const unmatched: Result[] = [];

      setRows(prev =>
        prev.map(r => {
          if (!r.itemNumber && !r.listingNumber) return r;
          const m = results.find(x => {
            if (x.listingNumber && r.listingNumber && x.listingNumber === r.listingNumber) return true;
            if (x.itemNumber && r.itemNumber && x.itemNumber === r.itemNumber) return true;
            return false;
          });
          if (!m) return r;
          matched++;
          const patch: Partial<RowData> = {};
          if (m.saleAmount && m.saleAmount !== r.saleAmount) patch.saleAmount = m.saleAmount;
          if (m.fee && m.fee !== r.fee) patch.fee = m.fee;
          if (m.campaign && m.campaign !== r.campaign) patch.campaign = m.campaign;
          if (Object.keys(patch).length > 0) updated++;
          return { ...r, ...patch };
        })
      );

      // 未マッチの行をカウント (results側から見て)
      for (const x of results) {
        const existsInRows = rows.some(
          r =>
            (x.listingNumber && r.listingNumber === x.listingNumber) ||
            (x.itemNumber && r.itemNumber === x.itemNumber)
        );
        if (!existsInRows) unmatched.push(x);
      }

      alert(
        `売上取込完了\n` +
          `ファイルから抽出: ${results.length} 行\n` +
          `マッチ: ${matched} 行 / 更新: ${updated} 行\n` +
          `未マッチ: ${unmatched.length} 行\n` +
          `形式: ${data.mode === "profile" ? `プロファイル (${data.profileName || settings.market || "-"})` : "自動検出"}`
      );
    } catch (err) {
      alert(`取込エラー: ${err}`);
    } finally {
      setSaving(false);
      e.target.value = "";
    }
  };

  // 履歴検索
  const searchHistory = async (q?: string) => {
    const query = (q ?? historyQuery).trim();
    if (!query) {
      alert("商品番号を入力してください");
      return;
    }
    setHistoryLoading(true);
    setHistoryOpen(true);
    try {
      const res = await fetch(`/api/search?itemNumber=${encodeURIComponent(query)}`);
      const data = await res.json();
      setHistoryResults(data.results || []);
    } catch (e) {
      console.error(e);
      setHistoryResults([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  /**
   * 指値を仕入価格 × 倍率で一括計算 (1000円単位四捨五入)
   * 対象: priceLocked が false かつ 仕入価格ありの行
   */
  const applyMultiplier = () => {
    const m = parseFloat(multiplier);
    if (!m || m <= 0) {
      alert("倍率を正しく入力してください");
      return;
    }
    // 先に対象件数をカウント (Strict Mode の二重実行を避けるため closure に頼らない)
    const eligible = rows.filter(r => !r.priceLocked && parseFloat(r.purchasePrice) > 0);
    if (eligible.length === 0) {
      alert("対象行がありません (未ロックかつ仕入価格ありの行が0件)");
      return;
    }
    setRows(prev => prev.map(r => {
      if (r.priceLocked) return r;
      const purchase = parseFloat(r.purchasePrice);
      if (!purchase || purchase <= 0) return r;
      const rounded = Math.round((purchase * m) / 1000) * 1000;
      return { ...r, reservePrice: String(rounded), priceLocked: true };
    }));
  };

  /**
   * 指値を一括設定
   * 対象: 商品番号があり、priceLocked が false の行
   */
  const applyBulkPrice = () => {
    const p = bulkPrice.trim();
    if (!p) {
      alert("指値を入力してください");
      return;
    }
    const eligible = rows.filter(r => r.itemNumber && !r.priceLocked);
    if (eligible.length === 0) {
      alert("対象行がありません (未ロック行が0件)");
      return;
    }
    setRows(prev => prev.map(r => {
      if (!r.itemNumber) return r;
      if (r.priceLocked) return r;
      return { ...r, reservePrice: p, priceLocked: true };
    }));
  };

  /**
   * 箱番をインクリメント
   * - 英字のみ: A→B→…→Z→AA→AB→…→ZZ→AAA (スプレッドシート列形式)
   * - 末尾数字あり: A01→A02, BOX5→BOX6 (ゼロ埋め保持)
   * - それ以外: 末尾に "1" を付加
   */
  const incrementBoxNo = (box: string): string => {
    if (!box) return "";

    // 英字のみ (大文字小文字は保持)
    if (/^[A-Za-z]+$/.test(box)) {
      const isLower = box === box.toLowerCase();
      const upper = box.toUpperCase().split("");
      let i = upper.length - 1;
      while (i >= 0) {
        if (upper[i] < "Z") {
          upper[i] = String.fromCharCode(upper[i].charCodeAt(0) + 1);
          const result = upper.join("");
          return isLower ? result.toLowerCase() : result;
        }
        upper[i] = "A";
        i--;
      }
      const result = "A" + upper.join("");
      return isLower ? result.toLowerCase() : result;
    }

    // 末尾数字あり
    const m = box.match(/^(.*?)(\d+)$/);
    if (m) {
      const prefix = m[1];
      const num = parseInt(m[2], 10) + 1;
      const pad = m[2].length;
      return prefix + String(num).padStart(pad, "0");
    }

    return box + "1";
  };

  /**
   * 箱番・出品番号の一括付与
   * - mode="box10": 箱番から順に、箱ごとに出品番号1〜10 を付与(10件ごとに箱番++)
   * - mode="serial": 開始番号から通し番号で出品番号を付与 (箱番は設定あれば全行に適用)
   * - 開始箱番が空の場合は自動的に serial モードとして動作 (箱番は変更しない)
   */
  const applyBulkNumbering = () => {
    const startBox = bulkStartBox.trim();
    const startNo = parseInt(bulkStartNo || "1", 10);
    if (!Number.isFinite(startNo) || startNo < 1) {
      alert("開始出品番号は1以上の整数で入力してください");
      return;
    }
    const effectiveMode: "box10" | "serial" = !startBox ? "serial" : bulkNumberingMode;

    const eligibleCount = rows.filter(r => r.itemNumber).length;
    if (eligibleCount === 0) {
      alert("対象行がありません (商品番号ありの行が0件)");
      return;
    }

    const modeLabel =
      effectiveMode === "box10"
        ? `箱番「${startBox}」から箱ごとに 1〜10 の出品番号`
        : `出品番号 ${startNo} から通しで付与${startBox ? ` (箱番「${startBox}」)` : ""}`;
    if (!confirm(`${eligibleCount} 行に以下で一括付与しますか？\n\n${modeLabel}`)) return;

    setRows(prev => {
      let currentBox = startBox;
      let perBoxCounter = 1;         // box10 モード用: 1→10
      let serialCounter = startNo;   // serial モード用
      return prev.map(r => {
        if (!r.itemNumber) return r;
        if (effectiveMode === "serial") {
          const patch: Partial<RowData> = { listingNumber: String(serialCounter) };
          if (startBox) patch.boxNo = startBox;
          serialCounter++;
          return { ...r, ...patch };
        }
        // box10 モード
        const next: RowData = {
          ...r,
          boxNo: currentBox,
          listingNumber: String(perBoxCounter),
        };
        perBoxCounter++;
        if (perBoxCounter > 10) {
          currentBox = incrementBoxNo(currentBox);
          perBoxCounter = 1;
        }
        return next;
      });
    });
  };

  /**
   * バッグ名コピー時のクリーンアップ:
   *   - "NO TARIFF" を除去 (大小文字・スペース揺れも考慮)
   *   - 末尾の6〜7桁SKUを除去
   *   - 連続スペース・前後空白を整形
   */
  const cleanTitleForBagName = (title: string): string => {
    if (!title) return "";
    let s = title;
    // NO TARIFF を除去 (NO TARIFF, no tariff, NO_TARIFF, NO-TARIFF など)
    s = s.replace(/\bNO[\s_-]*TARIFF\b/gi, "");
    // 末尾の6〜7桁SKUを除去 (前後の区切り文字も)
    s = s.replace(/[\s\-_,#]*\b\d{6,7}\b\s*$/g, "");
    // 連続スペース整形 + trim
    s = s.replace(/\s+/g, " ").trim();
    // 末尾の不要記号を除去
    s = s.replace(/[\s\-_,#:|]+$/g, "");
    return s;
  };

  const exportExcel = async (formatType: FormatType) => {
    const ExcelJS = (await import("exceljs")).default;
    const safeName = (fileName || "あご表").trim() || "あご表";
    const typeSuffix = formatType === "internal" ? "社内用" : "提出用";

    // 市場別形式から該当タイプを取得 (カスタム → プリセット → デフォルト)
    const customFormat = settings.market ? settings.marketFormats[settings.market] : undefined;
    const formatKey = formatType === "sales_import" ? "salesImport" : formatType;
    const tplColumns = customFormat?.[formatKey]?.columns;
    const preset = settings.market ? getMarketPreset(settings.market) : undefined;
    const presetColumns = formatType === "internal" || formatType === "submission" ? preset?.[formatType] : undefined;
    const columns: ColumnDef[] =
      tplColumns && tplColumns.length > 0
        ? tplColumns
        : presetColumns && presetColumns.length > 0
          ? presetColumns
          : DEFAULT_FORMAT_COLUMNS;

    // 保存済みテンプレートExcelを取得 (あれば書込ベースに使う)
    let templateBuffer: ArrayBuffer | null = null;
    let templateHeaderRow = 1;
    if (settings.market) {
      try {
        const res = await fetch(
          `/api/format/template?market=${encodeURIComponent(settings.market)}&formatType=${formatType}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.template?.data_base64) {
            const bin = atob(data.template.data_base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            templateBuffer = bytes.buffer;
            templateHeaderRow = data.template.header_row || 1;
          }
        }
      } catch (e) {
        console.warn("Template fetch failed, fallback to fresh workbook:", e);
      }
    }

    const wb = new ExcelJS.Workbook();
    let ws: import("exceljs").Worksheet;
    let startRow: number;

    if (templateBuffer) {
      // ① テンプレートを開く (書式・ヘッダー保持)
      await wb.xlsx.load(templateBuffer);
      ws = wb.worksheets[0];
      // ヘッダー行の直下から書込 (2行目から)
      startRow = templateHeaderRow + 1;
    } else {
      // ② テンプレ無し: 新規ワークブックにヘッダー込で書く
      const sheetTitle = `${safeName}_${typeSuffix}`
        .replace(/[*?:\\/[\]]/g, "_")
        .slice(0, 31);
      ws = wb.addWorksheet(sheetTitle);
      ws.addRow(columns.map(c => c.header));
      ws.getRow(1).font = { bold: true };
      startRow = 2;
      columns.forEach((c, i) => {
        const w = c.width || 15;
        ws.getColumn(i + 1).width = w;
      });
    }

    const ctx = {
      market: settings.market,
      resolveBuyer,
      taxRate: settings.taxRate,
    };

    const dataRows = rows.filter(r => r.itemNumber);
    dataRows.forEach((r, rowOffset) => {
      const resolverRow: ResolverRow = {
        itemNumber: r.itemNumber,
        listingNumber: r.listingNumber,
        brand: r.brand,
        itemName: r.itemName,
        accessories: r.accessories,
        condition: r.condition,
        reservePrice: r.reservePrice,
        buyer: r.buyer,
        purchasePrice: r.purchasePrice,
        salePrice: r.salePrice,
        saleAmount: r.saleAmount,
        fee: r.fee,
        campaign: r.campaign,
        lotNo: r.lotNo,
        boxNo: r.boxNo,
        // タイトル fallback (Gemini→Kintone→ロットNo)
        kintoneTitle: r.kintoneTitle?.trim() || (!r.geminiTitle?.trim() ? r.lotNo : ""),
        geminiTitle: r.geminiTitle,
        soldOut: r.soldOut,
        tkb: r.tkb,
        broken: r.broken,
        copy: r.copy,
      };

      const targetRowNum = startRow + rowOffset;
      const targetRow = ws.getRow(targetRowNum);

      columns.forEach((c, i) => {
        // テンプレートの値を維持: セルを一切触らない (formulaや既存値そのまま)
        if (c.field === "KEEP_TEMPLATE") return;

        const value = resolveColumnValue(c.field, c.fixedValue, resolverRow, ctx);
        const cell = targetRow.getCell(i + 1);
        if (value === "") {
          cell.value = null;
        } else if (
          (c.field === "RESERVE_PRICE" ||
            c.field === "PURCHASE_PRICE" ||
            c.field === "SALE_PRICE" ||
            c.field === "SALE_AMOUNT" ||
            c.field === "FEE" ||
            c.field === "PURCHASE_PRICE_TAX_INCL" ||
            c.field === "SALE_AMOUNT_TAX_INCL" ||
            c.field === "FEE_TAX_INCL" ||
            c.field === "GROSS_PROFIT") &&
          /^-?\d+(\.\d+)?$/.test(value)
        ) {
          cell.value = Number(value);
        } else {
          cell.value = value;
        }

        // 売切時に状態列を赤字
        if (r.soldOut && (c.field === "CONDITION_WITH_FLAGS" || c.field === "SOLD_OUT_FLAG")) {
          cell.font = { ...(cell.font || {}), color: { argb: "FFFF0000" }, bold: true };
        }
      });

      targetRow.commit();
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeFileName = `${safeName}_${typeSuffix}_${new Date().toISOString().slice(0, 10)}`
      .replace(/[\\/:*?"<>|]/g, "_");
    a.download = `${safeFileName}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* ===================== App Bar ===================== */}
      <header className="sticky top-0 z-30 bg-[var(--bg)]/90 backdrop-blur-md border-b border-[var(--border)]">
        <div className="max-w-[1920px] mx-auto px-4 md:px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 flex items-center justify-center text-[28px] font-black italic"
              style={{
                background: "var(--ink-pink)",
                border: "3px solid var(--fg)",
                borderRadius: "18px",
                boxShadow: "0 5px 0 var(--fg), inset 0 2px 0 rgba(255,255,255,0.6)",
                color: "var(--fg)",
                lineHeight: 1,
                fontFamily: "var(--font-display)",
              }}
            >
              A
            </div>
            <div className="flex flex-col leading-none">
              <h1 className="display text-[26px]">
                あご表作成
              </h1>
              <div className="mt-2">
                <span className="ink-tag ink-tag-lime">v0.1</span>
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-1 text-[11px] text-[var(--fg-subtle)]">
            {settings.market && (
              <span className="badge badge-accent">市場: {settings.market}</span>
            )}
            {Object.keys(settings.buyerMap).length > 0 && (
              <span className="badge">バイヤー {Object.keys(settings.buyerMap).length}</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {/* 履歴検索 */}
            <div className="hidden md:flex items-center gap-1.5 pr-2 mr-1 border-r border-[var(--border)]">
              <input
                type="text"
                value={historyQuery}
                onChange={e => setHistoryQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") searchHistory(); }}
                placeholder="🔍 商品番号で履歴検索"
                className="input input-sm w-48"
                inputMode="numeric"
              />
              <button onClick={() => searchHistory()} className="btn btn-secondary btn-sm">
                検索
              </button>
            </div>
            <a href="/settings" className="btn btn-ghost btn-sm" title="設定">
              <span className="text-base leading-none">⚙</span>
              <span className="hidden sm:inline text-xs">設定</span>
            </a>
          </div>
        </div>

        {/* ===================== Toolbar ===================== */}
        <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-3 border-t border-[var(--border)] bg-[var(--bg-subtle)]">
          <div className="flex flex-wrap items-center gap-2">
            {/* シート選択 */}
            <div className="flex items-center gap-1.5">
              <label className="form-label mr-1">シート</label>
              <select
                value={sheetId || ""}
                onChange={e => { const v = e.target.value; if (v) loadSheet(v); }}
                className="input input-sm max-w-[220px]"
              >
                <option value="">— 選択 —</option>
                {sheetList.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({new Date(s.updated_at).toLocaleDateString("ja-JP")})
                  </option>
                ))}
              </select>
              <button onClick={() => createNewSheet()} className="btn btn-secondary btn-sm" title="新規シート作成">
                ＋新規
              </button>
              <label className="btn btn-secondary btn-sm cursor-pointer" title="過去のExcel(.xlsx)を取込んで新規シートとして登録">
                📂 取込
                <input
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </label>
            </div>

            <div className="h-6 w-px bg-[var(--border)] mx-1" />

            {/* ファイル名 */}
            <div className="flex items-center gap-1.5 flex-1 min-w-[220px] max-w-[360px]">
              <label className="form-label">名称</label>
              <input
                type="text"
                value={fileName}
                onChange={e => setFileName(e.target.value)}
                placeholder="例: コメ260506あご表"
                className="input input-sm flex-1"
              />
              <span className="text-[10px] text-[var(--fg-subtle)]">.xlsx</span>
            </div>

            <div className="h-6 w-px bg-[var(--border)] mx-1" />

            <button onClick={saveNow} disabled={saving} className="btn btn-primary btn-sm">
              {saving ? "保存中…" : "保存"}
            </button>
            <button onClick={clearAll} className="btn btn-secondary btn-sm">
              行クリア
            </button>
            {sheetId && (
              <button onClick={deleteSheet} className="btn btn-danger btn-sm" title="このシートを削除">
                削除
              </button>
            )}

            {/* 保存ステータス */}
            <div className="ml-auto flex items-center gap-2 text-[11px] text-[var(--fg-subtle)]">
              {!sheetId ? (
                <span className="inline-flex items-center gap-1 text-[var(--warning)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" />
                  シート未選択
                </span>
              ) : savedAt ? (
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
                  {saving ? "保存中…" : `保存: ${savedAt}`}
                </span>
              ) : (
                <span>自動保存中</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ===================== Main ===================== */}
      <main className="max-w-[1920px] mx-auto px-4 md:px-6 py-5 space-y-4">
        {/* タブ切替 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("listing")}
            className={activeTab === "listing" ? "btn btn-primary" : "btn"}
          >
            出品
          </button>
          <button
            onClick={() => setActiveTab("sales")}
            className={activeTab === "sales" ? "btn btn-primary" : "btn"}
          >
            売上入力
          </button>
          <span className="ml-2 text-[11px] text-[var(--fg-subtle)]">
            {activeTab === "listing"
              ? "商品情報の出品登録"
              : `売上・手数料の入力 (${rows.filter(r => r.itemNumber).length} 件)`}
          </span>
        </div>

        {activeTab === "listing" && (
        <>
        {/* 入力エリア */}
        <section className="panel p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <form onSubmit={handleManualSubmit} className="flex gap-2 flex-1 min-w-[320px]">
              <input
                ref={inputRef}
                type="text"
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                placeholder="商品番号を入力 (例: 36511050)"
                className="input flex-1"
                inputMode="numeric"
              />
              <button type="submit" className="btn btn-primary">追加</button>
            </form>
            <button onClick={() => setScannerOpen(true)} className="btn btn-secondary">
              📷 バーコード
            </button>
            <button onClick={addRow} className="btn btn-secondary">＋行追加</button>
            <div className="h-8 w-px bg-[var(--border)] mx-1" />
            <button onClick={() => exportExcel("internal")} className="btn btn-secondary" title="社内用形式でExcel出力">
              📊 社内用
            </button>
            <button onClick={() => exportExcel("submission")} className="btn btn-primary" title="提出用 (あご表) 形式でExcel出力">
              📤 提出用
            </button>
          </div>

          {/* 箱番・出品番号 一括付与 */}
          <div className="flex flex-wrap gap-3 items-center pt-3 border-t border-[var(--border)]">
            <div className="flex items-center gap-1.5">
              <span className="form-label">箱番・出品番号一括</span>
              <span className="text-[10px] text-[var(--fg-subtle)]">商品番号ありの全行に付与</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--fg-muted)]">開始箱番</span>
              <input
                type="text"
                value={bulkStartBox}
                onChange={e => setBulkStartBox(e.target.value)}
                placeholder="例: A01"
                className="input input-sm w-24"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--fg-muted)]">モード</span>
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="radio"
                  checked={bulkNumberingMode === "box10"}
                  onChange={() => setBulkNumberingMode("box10")}
                  className="accent-[var(--accent)]"
                />
                箱ごと(1-10)
              </label>
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="radio"
                  checked={bulkNumberingMode === "serial"}
                  onChange={() => setBulkNumberingMode("serial")}
                  className="accent-[var(--accent)]"
                />
                通し番号
              </label>
            </div>

            {(bulkNumberingMode === "serial" || !bulkStartBox.trim()) && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--fg-muted)]">開始</span>
                <input
                  type="number"
                  min={1}
                  value={bulkStartNo}
                  onChange={e => setBulkStartNo(e.target.value)}
                  className="input input-sm w-16"
                />
              </div>
            )}

            <button onClick={applyBulkNumbering} className="btn btn-secondary btn-sm">
              一括付与
            </button>

            {!bulkStartBox.trim() && bulkNumberingMode === "box10" && (
              <span className="text-[10px] text-[var(--warning)]">
                ※ 開始箱番が未入力のため通し番号モードで実行されます
              </span>
            )}
          </div>

          {/* 指値一括操作 */}
          <div className="flex flex-wrap gap-4 items-center pt-3 border-t border-[var(--border)]">
            <div className="flex items-center gap-1.5">
              <span className="form-label">指値一括</span>
              <span className="text-[10px] text-[var(--fg-subtle)]">🔒未チェック行のみ</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--fg-muted)]">仕入価格 ×</span>
              <input
                type="number"
                step="0.1"
                value={multiplier}
                onChange={e => setMultiplier(e.target.value)}
                className="input input-sm w-16"
              />
              <span className="text-xs text-[var(--fg-muted)]">倍 (千円単位)</span>
              <button onClick={applyMultiplier} className="btn btn-secondary btn-sm">
                計算
              </button>
            </div>

            <div className="h-5 w-px bg-[var(--border)]" />

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--fg-muted)]">一律</span>
              <input
                type="number"
                value={bulkPrice}
                onChange={e => setBulkPrice(e.target.value)}
                placeholder="50000"
                className="input input-sm w-24"
              />
              <span className="text-xs text-[var(--fg-muted)]">円</span>
              <button onClick={applyBulkPrice} className="btn btn-secondary btn-sm">
                設定
              </button>
            </div>
          </div>
        </section>
        </>
        )}

        {/* ===================== 履歴検索モーダル ===================== */}
        {historyOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-16 overflow-y-auto">
            <div className="panel max-w-5xl w-full p-5 shadow-xl">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-semibold tracking-tight">
                  履歴検索
                  <span className="ml-2 text-sm font-normal text-[var(--fg-muted)]">
                    商品番号「{historyQuery}」
                    {!historyLoading && <span className="ml-1.5 text-[var(--fg-subtle)]">({historyResults.length} 件)</span>}
                  </span>
                </h2>
                <button onClick={() => setHistoryOpen(false)} className="btn btn-ghost btn-sm">
                  閉じる
                </button>
              </div>
              {historyLoading ? (
                <div className="text-[var(--fg-muted)] py-8 text-center text-sm">読込中…</div>
              ) : historyResults.length === 0 ? (
                <div className="text-[var(--fg-muted)] py-8 text-center text-sm">該当データなし</div>
              ) : (
                <div className="overflow-x-auto max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--bg-subtle)] sticky top-0 z-10">
                      <tr className="text-[var(--fg-muted)]">
                        <th className="px-3 py-2 text-left font-semibold">シート</th>
                        <th className="px-3 py-2 text-left font-semibold">日付</th>
                        <th className="px-3 py-2 text-left font-semibold">ブランド</th>
                        <th className="px-3 py-2 text-left font-semibold">バッグ名</th>
                        <th className="px-3 py-2 text-left font-semibold">指値</th>
                        <th className="px-3 py-2 text-left font-semibold">仕入</th>
                        <th className="px-3 py-2 text-left font-semibold">販売</th>
                        <th className="px-3 py-2 text-left font-semibold">バイヤー</th>
                        <th className="px-3 py-2 text-left font-semibold">状態</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyResults.map(r => (
                        <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[var(--surface-hover)]">
                          <td className="px-3 py-2">
                            <button
                              onClick={() => {
                                if (r.ago_sheets?.id) { loadSheet(r.ago_sheets.id); setHistoryOpen(false); }
                              }}
                              className="text-[var(--accent)] hover:underline"
                            >
                              {r.ago_sheets?.name || "(削除済)"}
                            </button>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-[var(--fg-muted)]">
                            {r.ago_sheets?.updated_at ? new Date(r.ago_sheets.updated_at).toLocaleDateString("ja-JP") : "-"}
                          </td>
                          <td className="px-3 py-2">{r.brand || "-"}</td>
                          <td className="px-3 py-2 max-w-[220px]">{r.item_name || "-"}</td>
                          <td className="px-3 py-2 tabular-nums">{r.reserve_price || "-"}</td>
                          <td className="px-3 py-2 tabular-nums">{r.purchase_price || "-"}</td>
                          <td className="px-3 py-2 tabular-nums">{r.sale_price || "-"}</td>
                          <td className="px-3 py-2">{r.buyer || "-"}</td>
                          <td className={`px-3 py-2 ${r.sold_out ? "text-[var(--danger)] font-semibold" : ""}`}>
                            {r.sold_out ? "売切 " : ""}{r.condition || ""}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => {
                                if (r.ago_sheets?.id) { loadSheet(r.ago_sheets.id); setHistoryOpen(false); }
                              }}
                              className="btn btn-secondary btn-xs"
                            >
                              開く
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-[var(--fg-subtle)] mt-3">
                ※ 過去のあご表シートに同じ商品番号がある場合、同一商品の過去の売価・指値・状態を確認できます。
              </p>
            </div>
          </div>
        )}

        {/* ===================== バーコードスキャナー ===================== */}
        {scannerOpen && (
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="panel max-w-2xl w-full p-5 shadow-xl">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-semibold tracking-tight">バーコード読取</h2>
                <button onClick={() => setScannerOpen(false)} className="btn btn-ghost btn-sm">
                  閉じる
                </button>
              </div>
              <BarcodeScanner onDetected={handleBarcodeDetected} />
            </div>
          </div>
        )}

        {activeTab === "listing" && (
        <>
        {/* ===================== テーブル ===================== */}
        <section className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-subtle)] border-b border-[var(--border)]">
                <tr className="text-[var(--fg-muted)]">
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">箱番</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">出品番号</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">代表</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">正面</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">商品番号</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">ロット</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">ブランド</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">バッグ名</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">付属品</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">状態</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">
                    指値 <span className="text-[9px] font-normal normal-case" title="🔒 = 一括操作対象外">🔒</span>
                  </th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">バイヤー</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">仕入</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">販売</th>
                  <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">AIタイトル</th>
                  <th className="px-2 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors">
                    <td className="px-3 py-2 align-top">
                      <textarea rows={1} value={row.boxNo}
                        onChange={e => updateRow(row.id, { boxNo: e.target.value })}
                        className="input input-sm w-20 resize-y leading-snug" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="text"
                        value={row.listingNumber}
                        onChange={e => updateRow(row.id, { listingNumber: e.target.value })}
                        className="input input-sm w-24 tabular-nums"
                        placeholder="出品ID"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      {row.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a href={row.imageUrl} target="_blank" rel="noopener noreferrer">
                          <img
                            src={row.imageUrl}
                            alt={`${row.itemNumber} 代表`}
                            className="w-20 h-20 object-cover rounded-lg border border-[var(--border)]"
                            onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                          />
                        </a>
                      ) : (
                        <div className="w-20 h-20 bg-[var(--bg-muted)] rounded-lg flex items-center justify-center text-[10px] text-[var(--fg-subtle)]">
                          no image
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {row.frontImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a href={row.frontImageUrl} target="_blank" rel="noopener noreferrer">
                          <img
                            src={row.frontImageUrl}
                            alt={`${row.itemNumber} 正面`}
                            className="w-20 h-20 object-cover rounded-lg border border-[var(--border)]"
                            onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                          />
                        </a>
                      ) : (
                        <div className="w-20 h-20 bg-[var(--bg-muted)] rounded-lg flex items-center justify-center text-[10px] text-[var(--fg-subtle)]">
                          no image
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="text"
                        value={row.itemNumber}
                        onChange={e => updateRow(row.id, { itemNumber: e.target.value })}
                        onBlur={e => {
                          if (e.target.value && row.status === "empty") {
                            processItemNumber(row.id, e.target.value);
                          }
                        }}
                        className="input input-sm w-24 tabular-nums"
                      />
                      {row.status === "loading" && <div className="mt-1 text-[10px] text-[var(--accent)]">読込中…</div>}
                      {row.status === "error" && <div className="mt-1 text-[10px] text-[var(--fg-muted)]">{row.errorMsg}</div>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <textarea rows={2} value={row.lotNo}
                        onChange={e => updateRow(row.id, { lotNo: e.target.value })}
                        className="input input-sm w-32 resize-y leading-snug" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <textarea rows={1} value={row.brand}
                        onChange={e => updateRow(row.id, { brand: e.target.value })}
                        className="input input-sm w-28 resize-y leading-snug" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <textarea rows={2} value={row.itemName}
                        onChange={e => updateRow(row.id, { itemName: e.target.value })}
                        className="input input-sm w-56 resize-y leading-snug" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <textarea rows={2} value={row.accessories}
                        onChange={e => updateRow(row.id, { accessories: e.target.value })}
                        className="input input-sm w-40 resize-y leading-snug" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      {(row.soldOut || row.tkb || row.broken || row.copy) && (
                        <div className="mb-1.5 flex flex-wrap gap-1">
                          {row.soldOut && <span className="badge badge-danger">売切</span>}
                          {row.tkb && <span className="badge badge-warning">TKB</span>}
                          {row.broken && <span className="badge badge-warning">壊れ</span>}
                          {row.copy && <span className="badge badge-accent">コピー</span>}
                        </div>
                      )}
                      <textarea rows={2} value={row.condition}
                        onChange={e => updateRow(row.id, { condition: e.target.value })}
                        className="input input-sm w-32 resize-y leading-snug" />
                      <div className="mt-1.5 grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => updateRow(row.id, { soldOut: !row.soldOut })}
                          className={`px-1.5 py-0.5 text-[10px] rounded-md font-medium transition-colors ${
                            row.soldOut
                              ? "bg-[var(--danger)] text-white"
                              : "bg-[var(--bg-muted)] text-[var(--fg-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                          }`}
                          title="売切フラグ"
                        >
                          {row.soldOut ? "✓売切" : "売切"}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateRow(row.id, { tkb: !row.tkb })}
                          className={`px-1.5 py-0.5 text-[10px] rounded-md font-medium transition-colors ${
                            row.tkb
                              ? "bg-[var(--warning)] text-white"
                              : "bg-[var(--bg-muted)] text-[var(--fg-muted)] hover:bg-[var(--warning-soft)] hover:text-[var(--warning)]"
                          }`}
                          title="TKBフラグ"
                        >
                          {row.tkb ? "✓TKB" : "TKB"}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateRow(row.id, { broken: !row.broken })}
                          className={`px-1.5 py-0.5 text-[10px] rounded-md font-medium transition-colors ${
                            row.broken
                              ? "bg-[var(--warning)] text-white"
                              : "bg-[var(--bg-muted)] text-[var(--fg-muted)] hover:bg-[var(--warning-soft)] hover:text-[var(--warning)]"
                          }`}
                          title="壊れフラグ"
                        >
                          {row.broken ? "✓壊れ" : "壊れ"}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateRow(row.id, { copy: !row.copy })}
                          className={`px-1.5 py-0.5 text-[10px] rounded-md font-medium transition-colors ${
                            row.copy
                              ? "bg-[var(--accent)] text-white"
                              : "bg-[var(--bg-muted)] text-[var(--fg-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                          }`}
                          title="コピーフラグ"
                        >
                          {row.copy ? "✓コピー" : "コピー"}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center gap-1.5">
                        <input type="text" value={row.reservePrice}
                          onChange={e => updateRow(row.id, { reservePrice: e.target.value })}
                          className={`input input-sm w-20 tabular-nums ${
                            row.priceLocked ? "!border-[var(--warning)] !bg-[var(--warning-soft)]" : ""
                          }`} />
                        <input
                          type="checkbox"
                          checked={row.priceLocked}
                          onChange={e => updateRow(row.id, { priceLocked: e.target.checked })}
                          title="🔒 一括操作の対象外にする"
                          className="w-4 h-4 cursor-pointer accent-[var(--warning)]"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="text" value={row.buyer}
                        onChange={e => updateRow(row.id, { buyer: e.target.value })}
                        className="input input-sm w-20" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="text" value={row.purchasePrice}
                        onChange={e => updateRow(row.id, { purchasePrice: e.target.value })}
                        className="input input-sm w-20 tabular-nums" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="text" value={row.salePrice}
                        onChange={e => updateRow(row.id, { salePrice: e.target.value })}
                        className="input input-sm w-20 tabular-nums" />
                    </td>
                    <td className="px-3 py-2 text-xs align-top" style={{ minWidth: 260, maxWidth: 360 }}>
                      {row.geminiTitle && (
                        <div className="mb-1.5 flex items-start gap-1.5">
                          <span className="badge badge-success shrink-0">G</span>
                          <div className="break-words whitespace-pre-wrap leading-snug flex-1">{row.geminiTitle}</div>
                          <button
                            type="button"
                            onClick={() => updateRow(row.id, { itemName: cleanTitleForBagName(row.geminiTitle) })}
                            title={`バッグ名にコピー (整形後: ${cleanTitleForBagName(row.geminiTitle)})`}
                            className="btn btn-secondary btn-xs shrink-0"
                          >
                            →名
                          </button>
                        </div>
                      )}
                      {row.kintoneTitle && (
                        <div className="flex items-start gap-1.5">
                          <span className="badge badge-warning shrink-0">K</span>
                          <div className="break-words whitespace-pre-wrap leading-snug flex-1 text-[var(--fg-muted)]">{row.kintoneTitle}</div>
                          <button
                            type="button"
                            onClick={() => updateRow(row.id, { itemName: cleanTitleForBagName(row.kintoneTitle) })}
                            title={`バッグ名にコピー (整形後: ${cleanTitleForBagName(row.kintoneTitle)})`}
                            className="btn btn-secondary btn-xs shrink-0"
                          >
                            →名
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top">
                      {rows.length > 1 && (
                        <button
                          onClick={() => removeRow(row.id)}
                          className="w-7 h-7 rounded-md text-[var(--fg-subtle)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg)] transition-colors"
                          title="行を削除"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex items-center justify-between text-[11px] text-[var(--fg-subtle)] px-1">
          <span>合計 <span className="font-semibold text-[var(--fg-muted)]">{rows.filter(r => r.itemNumber).length}</span> 件</span>
          <span>Supabase同期・3秒ごと自動保存</span>
        </div>
        </>
        )}

        {/* ===================== 売上入力タブ ===================== */}
        {activeTab === "sales" && (
        <>
          {/* 売上取込ツールバー */}
          <section className="panel p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="btn btn-primary cursor-pointer">
                📥 売上取込
                {settings.market && (
                  <span className="ml-1 text-[10px] opacity-80">({settings.market})</span>
                )}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={handleSalesImportFile}
                  className="hidden"
                />
              </label>
              <span className="text-[11px] text-[var(--fg-muted)] leading-snug">
                市場から受領したExcel/CSVの<strong>売り金額・手数料</strong>を、
                出品番号または商品番号で一致する行に反映します。
                {settings.market ? (
                  <span className="text-[var(--fg-subtle)]">
                    {" "}プロファイル: <strong>{settings.market}</strong>
                  </span>
                ) : (
                  <span className="text-[var(--fg-subtle)]">
                    {" "}(市場未設定 — 自動検出で取込みます)
                  </span>
                )}
              </span>
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-subtle)] border-b border-[var(--border)]">
                  <tr className="text-[var(--fg-muted)]">
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">代表</th>
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">正面</th>
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">商品番号</th>
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">タイトル</th>
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">状態</th>
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">指値</th>
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">バイヤー</th>
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">売り金額</th>
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">手数料</th>
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">キャンペーン</th>
                    <th className="px-3 py-3 text-left font-semibold text-[11px] uppercase tracking-wide">不落札手数料</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.filter(r => r.itemNumber).length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-6 py-16 text-center text-[var(--fg-muted)] text-sm">
                        出品タブで商品を登録すると、ここに売上入力欄が表示されます。
                      </td>
                    </tr>
                  )}
                  {(() => {
                    const salesRows = rows.filter(r => r.itemNumber);
                    const totalSaleAmount = salesRows.reduce((sum, r) => sum + (parseFloat(r.saleAmount) || 0), 0);
                    const totalFee = salesRows.reduce((sum, r) => sum + (parseFloat(r.fee) || 0), 0);
                    const totalCampaign = salesRows.reduce((sum, r) => sum + (parseFloat(r.campaign) || 0), 0);
                    const getUnsoldFee = (r: RowData) => (r.saleAmount === "0" || r.saleAmount === "") ? 500 : 0;
                    const totalUnsoldFee = salesRows.reduce((sum, r) => sum + getUnsoldFee(r), 0);
                    return salesRows.map((row, _idx, arr) => {
                    const titleText =
                      row.geminiTitle?.trim() ||
                      row.kintoneTitle?.trim() ||
                      row.itemName ||
                      "-";
                    const isLast = row === arr[arr.length - 1];
                    return (<React.Fragment key={row.id}>
                      <tr className="border-t border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors">
                        <td className="px-3 py-2 align-top">
                          {row.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <a href={row.imageUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={row.imageUrl}
                                alt={`${row.itemNumber} 代表`}
                                className="w-20 h-20 object-cover rounded-lg border border-[var(--border)]"
                                onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                              />
                            </a>
                          ) : (
                            <div className="w-20 h-20 bg-[var(--bg-muted)] rounded-lg flex items-center justify-center text-[10px] text-[var(--fg-subtle)]">
                              no image
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {row.frontImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <a href={row.frontImageUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={row.frontImageUrl}
                                alt={`${row.itemNumber} 正面`}
                                className="w-20 h-20 object-cover rounded-lg border border-[var(--border)]"
                                onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                              />
                            </a>
                          ) : (
                            <div className="w-20 h-20 bg-[var(--bg-muted)] rounded-lg flex items-center justify-center text-[10px] text-[var(--fg-subtle)]">
                              no image
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top font-bold text-[13px] tabular-nums whitespace-nowrap">
                          {row.itemNumber}
                          {row.listingNumber && (
                            <div className="text-[10px] font-normal text-[var(--fg-muted)]">
                              出品: {row.listingNumber}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-[12px]" style={{ minWidth: 240, maxWidth: 340 }}>
                          <div className="font-semibold">{row.brand || "-"}</div>
                          <div className="text-[11px] text-[var(--fg-muted)] break-words leading-snug whitespace-pre-wrap">
                            {titleText}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-[11px]" style={{ minWidth: 140, maxWidth: 200 }}>
                          {(row.soldOut || row.tkb || row.broken || row.copy) && (
                            <div className="mb-1 flex flex-wrap gap-1">
                              {row.soldOut && <span className="badge badge-danger">売切</span>}
                              {row.tkb && <span className="badge badge-warning">TKB</span>}
                              {row.broken && <span className="badge badge-warning">壊れ</span>}
                              {row.copy && <span className="badge badge-accent">コピー</span>}
                            </div>
                          )}
                          <div className="text-[var(--fg-muted)] break-words whitespace-pre-wrap leading-snug">
                            {row.condition || "-"}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top tabular-nums font-semibold">
                          {row.reservePrice || "-"}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {row.buyer || "-"}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="text"
                            value={row.saleAmount}
                            onChange={e => updateRow(row.id, { saleAmount: e.target.value })}
                            placeholder="実売上"
                            className="input input-sm w-28 tabular-nums"
                            inputMode="numeric"
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="text"
                            value={row.fee}
                            onChange={e => updateRow(row.id, { fee: e.target.value })}
                            placeholder="手数料"
                            className="input input-sm w-24 tabular-nums"
                            inputMode="numeric"
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="text"
                            value={row.campaign}
                            onChange={e => updateRow(row.id, { campaign: e.target.value })}
                            placeholder="CB"
                            className="input input-sm w-24 tabular-nums"
                            inputMode="numeric"
                          />
                        </td>
                        <td className="px-3 py-2 align-top tabular-nums text-sm">
                          {getUnsoldFee(row) > 0 ? (
                            <span className="font-semibold text-[var(--danger)]">{getUnsoldFee(row).toLocaleString()}</span>
                          ) : (
                            <span className="text-[var(--fg-subtle)]">-</span>
                          )}
                        </td>
                      </tr>
                      {isLast && (
                        <tr key="totals" className="border-t-2 border-[var(--fg)] bg-[var(--bg-subtle)]">
                          <td colSpan={7} className="px-3 py-3 text-right font-bold text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                            合計
                          </td>
                          <td className="px-3 py-3 font-bold tabular-nums text-sm">
                            {totalSaleAmount ? totalSaleAmount.toLocaleString() : "-"}
                          </td>
                          <td className="px-3 py-3 font-bold tabular-nums text-sm">
                            {totalFee ? totalFee.toLocaleString() : "-"}
                          </td>
                          <td className="px-3 py-3 font-bold tabular-nums text-sm">
                            {totalCampaign ? totalCampaign.toLocaleString() : "-"}
                          </td>
                          <td className="px-3 py-3 font-bold tabular-nums text-sm">
                            {totalUnsoldFee ? <span className="text-[var(--danger)]">{totalUnsoldFee.toLocaleString()}</span> : "-"}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>);
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </section>
        </>
        )}
      </main>
    </div>
  );
}

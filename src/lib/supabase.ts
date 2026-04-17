import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
});

// 型定義
export interface AgoSheet {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface AgoRowDB {
  id: string;
  sheet_id: string;
  position: number;
  item_number: string | null;
  brand: string | null;
  item_name: string | null;
  accessories: string | null;
  condition: string | null;
  reserve_price: string | null;
  buyer: string | null;
  purchase_price: string | null;
  sale_price: string | null;
  lot_no: string | null;
  box_no: string | null;
  image_url: string | null;
  front_image_url: string | null;
  kintone_title: string | null;
  gemini_title: string | null;
  sold_out: boolean;
  tkb: boolean;
  broken: boolean;
  copy: boolean;
  created_at: string;
  updated_at: string;
}

export interface GeminiCache {
  item_number: string;
  image_url: string | null;
  category: string | null;
  brand: string | null;
  name: string | null;
  title: string | null;
  material: string | null;
  hardware: string | null;
  condition: string | null;
  confidence: string | null;
  raw_text: string | null;
  created_at: string;
  updated_at: string;
}

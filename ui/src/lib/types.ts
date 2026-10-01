// Mirrors the Rust types in src-tauri/src/quote.rs and state.rs.

export type Session = "pre" | "regular" | "post" | "closed";
export type ChartMode = "line" | "candles";

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Period {
  start: number;
  end: number;
}

export interface Meta {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  prev_close: number | null;
  gmtoffset: number;
  periods: { pre: Period; regular: Period; post: Period } | null;
}

export interface Chart {
  meta: Meta;
  range: string;
  interval: string;
  candles: Candle[];
}

export interface Extended {
  label: string;
  price: number;
  change: number;
  change_pct: number;
  t: number;
}

export interface Quote {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  open: number | null;
  day_high: number | null;
  day_low: number | null;
  high_52w: number | null;
  low_52w: number | null;
  volume: number | null;
  session: Session;
  extended: Extended | null;
  market_time: number;
}

export interface QuoteState {
  quote: Quote | null;
  error: string | null;
  updated_at: number;
}

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  kind: string;
}

export interface Init {
  symbol: string;
  range: string;
  chart_mode: ChartMode;
  hotkey: string;
  default_hotkey: string;
  quote: QuoteState;
}

export const RANGES: { id: string; label: string }[] = [
  { id: "1d", label: "1D" },
  { id: "5d", label: "5D" },
  { id: "1mo", label: "1M" },
  { id: "6mo", label: "6M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1Y" },
  { id: "5y", label: "5Y" },
  { id: "max", label: "Max" },
];

// Mirrors the Rust types in src-tauri/src/quote.rs, analyst.rs and state.rs.

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

export interface Ratings {
  strong_buy: number;
  buy: number;
  hold: number;
  sell: number;
  strong_sell: number;
}

export interface Consensus {
  symbol: string;
  /** Yahoo's key: strong_buy, buy, hold, underperform or sell. */
  rating: string | null;
  /** Mean recommendation, 1 (strong buy) to 5 (strong sell). */
  score: number | null;
  analysts: number | null;
  /** 12-month price targets, in the trading currency. */
  target_mean: number | null;
  target_median: number | null;
  target_high: number | null;
  target_low: number | null;
  ratings: Ratings | null;
}

export interface Init {
  symbol: string;
  range: string;
  chart_mode: ChartMode;
  hotkey: string;
  default_hotkey: string;
  /** Why the hotkey is not registered (taken at startup), if it is not. */
  hotkey_error: string | null;
  quote: QuoteState;
  chart: Chart | null;
  logo: string | null;
  /** False when the logo has not been fetched yet. */
  logo_known: boolean;
  analyst: Consensus | null;
  /** False when the analyst consensus has not been fetched yet. */
  analyst_known: boolean;
}

declare global {
  interface Window {
    /** Injected by the backend before the page loads (window.rs). */
    __TICKR_INIT__?: Init | null;
  }
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

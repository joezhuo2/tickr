// Mirrors the Rust types in src-tauri/src/quote.rs, analyst.rs, news.rs and state.rs.

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
  /** Starred symbols, in the user's order. */
  watchlist: string[];
}

/** A headline from news.rs. */
export interface Article {
  title: string;
  publisher: string;
  link: string;
  /** Unix seconds. */
  published: number;
}

/** One watchlist card; quote is null when the fetch failed. */
export interface WatchQuote {
  symbol: string;
  quote: Quote | null;
  error: string | null;
}

// Technical analysis, mirroring src-tauri/src/analysis.

export type Direction = "bullish" | "bearish" | "neutral";
export type Bias = "strong_bearish" | "bearish" | "neutral" | "bullish" | "strong_bullish";

export interface Line {
  key: string;
  label: string;
  period: number;
  /** Aligned with Series.t. */
  values: (number | null)[];
  /** First index with a full window; earlier values are warm-up estimates. */
  full_from: number;
}

export interface Signal {
  label: string;
  direction: Direction;
  limited: boolean;
}

export interface Reading {
  key: string;
  label: string;
  value: number | null;
  needed: number;
  limited: boolean;
}

export interface Component {
  key: string;
  label: string;
  weight: number;
  /** -1..1. */
  value: number;
}

export interface Target {
  price: number;
  raw: number;
  fib: string | null;
}

export interface FibLevel {
  ratio: number;
  price: number;
  kind: "retracement" | "extension";
  label: string;
}

export interface FibPoint {
  i: number;
  t: number;
  price: number;
}

export interface Swing {
  from: FibPoint;
  to: FibPoint;
  up: boolean;
  confirmed: boolean;
  levels: FibLevel[];
}

export interface Pattern {
  kind: string;
  name: string;
  direction: Direction;
  start: number;
  end: number;
  /** Time of the pattern's last candle. */
  t: number;
  trend: "up" | "down" | "flat";
  /** The prior trend supports the reversal; only these count toward the score. */
  context_ok: boolean;
  strength: number;
  limited: boolean;
}

export interface Analysis {
  symbol: string;
  range: string;
  interval: string;
  currency: string;
  /** Time of the last candle analyzed. */
  as_of: number;
  bars: number;
  limited: boolean;
  full_warmup: number;
  close: number;
  /** -100 (strong bearish) to +100 (strong bullish). */
  score: number;
  bias: Bias;
  /** 0..100. */
  confidence: number;
  confidence_label: "low" | "medium" | "high";
  components: Component[];
  signals: Signal[];
  readings: Reading[];
  targets: {
    horizon: number;
    atr_move: number;
    sigma_move: number | null;
    upside: Target;
    downside: Target;
    invalidation: Target | null;
  };
  fib: Swing | null;
  patterns: Pattern[];
  series: { t: number[]; mas: Line[]; rsi: Line };
}

/** Which analysis layers the chart draws. */
export interface Overlays {
  mas: boolean;
  fib: boolean;
  targets: boolean;
  patterns: boolean;
  rsi: boolean;
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

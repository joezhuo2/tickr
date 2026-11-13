// Mirrors the Rust types in src-tauri/src/quote.rs, analyst.rs, news.rs and state.rs.

export type Session = "pre" | "regular" | "post" | "closed";
export type RefreshMode = "balanced" | "low_power";
export type Theme = "system" | "light" | "dark";
export type TextSize = 100 | 110 | 125 | 150;
export type Palette = "standard" | "accessible";
export type ChartMode = "line" | "area" | "baseline" | "candles" | "hollow" | "bars" | "heikin" | "renko" | "range" | "linebreak" | "kagi" | "pointfigure";
export type ChartScale = "linear" | "log" | "percent";
export type ChartTimeZone = "exchange" | "local";
export type SplitOrientation = "side" | "stacked";
export interface ChartLayout {
  split: boolean;
  orientation: SplitOrientation;
  sync_range: boolean;
  symbol: string;
  range: string;
  interval: string;
}
export type WatchlistSortKey = "change" | "price" | "volume";
export type WatchlistSortDir = "desc" | "asc";
export type WatchlistView = "cards" | "heatmap" | "table";
export interface WatchlistColumns {
  score: boolean;
  rsi: boolean;
  earnings: boolean;
  iv_rank: boolean;
}
export interface WatchlistSort {
  key: WatchlistSortKey;
  dir: WatchlistSortDir;
}
export type ScreenOp = "above" | "below" | "between" | "is" | "any";
export interface ScreenRule {
  kind: string;
  op: ScreenOp;
  value: number;
  value2?: number | null;
  values?: string[];
}
export interface SavedScreen {
  name: string;
  rules: ScreenRule[];
}
export interface ScreenRow {
  symbol: string;
  price: number | null;
  change_pct: number | null;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  perf_1w: number | null;
  perf_1m: number | null;
  perf_3m: number | null;
  perf_6m: number | null;
  perf_ytd: number | null;
  perf_1y: number | null;
  volume: number | null;
  rel_volume: number | null;
  from_high_52w: number | null;
  from_low_52w: number | null;
  atr_pct: number | null;
  macd_hist: number | null;
  gap_pct: number | null;
  score: number | null;
  bias: Bias | null;
  error: string | null;
}
export interface ScreenFundamentals {
  symbol: string;
  market_cap: number | null;
  pe: number | null;
  eps: number | null;
  dividend_yield: number | null;
  revenue_growth: number | null;
  profit_margin: number | null;
  beta: number | null;
  sector: string | null;
  error: string | null;
}
export type ScreenItem = ScreenRow & Partial<Omit<ScreenFundamentals, "symbol" | "error">>;
export interface IvRank {
  symbol: string;
  iv: number | null;
  rank: number | null;
  error: string | null;
}

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
  market_time?: number;
  gmtoffset: number;
  timezone?: string;
  periods: { pre: Period; regular: Period; post: Period } | null;
}

export interface Chart {
  source: string;
  meta: Meta;
  range: string;
  interval: string;
  extended?: boolean;
  candles: Candle[];
  dividends: { t: number; amount: number }[];
  splits: { t: number; ratio: string }[];
  last_bar_time?: number | null;
  delay_secs?: number | null;
}

export interface Extended {
  label: string;
  price: number;
  change: number;
  change_pct: number;
  t: number;
}

export interface Quote {
  source: string;
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
  delay_secs?: number | null;
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
  quote_type: string;
  currency: string;
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

export interface DrawingPoint { t: number; price: number }
export interface Drawing { id: number; kind: "hline" | "trend" | "text" | "pen" | "rect" | "ray" | "fib" | "position" | "avwap" | "vline" | "hray" | "arrow" | "prange" | "drange" | "channel" | "fibext" | "pitchfork" | "vprofile" | "note"; points: DrawingPoint[]; text: string; color?: string; width?: number; dashed?: boolean; locked?: boolean; created?: number; edited?: number }

export interface Init {
  theme: Theme;
  text_size: TextSize;
  palette: Palette;
  drawings: Record<string, Drawing[]>;
  data_provider: DataProvider;
  symbol: string;
  range: string;
  interval: string;
  chart_mode: ChartMode;
  refresh_mode: RefreshMode;
  background_chart_alerts: boolean;
  chart_scale: ChartScale;
  chart_extended_hours: boolean;
  chart_shade_sessions: boolean;
  chart_time_zone: ChartTimeZone;
  chart_layout: ChartLayout;
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
  groups: Group[];
  watchlist_sort: WatchlistSort;
  watchlist_view: WatchlistView;
  watchlist_columns: WatchlistColumns;
  screens: SavedScreen[];
  screen_columns: string[];
  event_filter: EventFilter;
  keybinds: Keybinds;
  dots: Dots;
  indicators: IndicatorConfig;
  indicator_presets: IndicatorPreset[];
  alerts: PriceAlert[];
  recent_symbols: string[];
  recent_intervals?: string[];
}

export interface PriceAlert {
  id: number;
  symbol: string;
  direction: "above" | "below";
  level: number;
  enabled: boolean;
  triggered_at: number | null;
  triggered_price: number | null;
  kind: AlertKind;
  reference: number | null;
  recurring: boolean;
  cooldown_mins: number;
  regular_only: boolean;
}

export type AlertKind = "price" | "day_percent" | "armed_percent" | "trail_percent" | "trail_amount";

/** A named subset of the watchlist, shown as a tab. */
export interface Group {
  name: string;
  symbols: string[];
}

/** In-window shortcuts from settings.rs: one key each, "" when unbound. */
export interface Keybinds {
  chart_mode: string;
  chart_scale: string;
  chart_interval: string;
  draw_level: string;
  draw_trend: string;
  draw_text: string;
  draw_ruler: string;
  draw_pen: string;
  draw_rect: string;
  draw_ray: string;
  draw_fib: string;
  draw_position: string;
  draw_avwap: string;
  draw_note: string;
  chart_split: string;
  new_window: string;
  chart_replay: string;
  practice: string;
  refresh: string;
  range: string;
  technicals: string;
  analysts: string;
  earnings: string;
  watchlist: string;
  search: string;
  settings: string;
  toggle_watchlist: string;
  side_panel: string;
  alerts: string;
  market: string;
  news: string;
  analyze: string;
  options: string;
  paper: string;
  backtest: string;
  toggle_opening_range: string;
  toggle_levels: string;
  toggle_volume_ma: string;
  toggle_volume_profile: string;
  options_side: string;
  options_expiry: string;
  add_watchlist: string;
  events: string;
  next_group: string;
  previous_symbol: string;
}

export interface Impact {
  name: string;
  kind: "stock" | "sector";
  score: number;
  confidence: number;
  confidence_label: "low" | "medium" | "high";
  reasoning: string;
}

/** A scheduled economic release from Yahoo's calendar. */
export interface MarketEvent {
  id: string;
  name: string;
  country: string;
  /** Release time, Unix seconds. */
  at: number;
  /** What the figure covers, like "Oct" or "Q3". */
  period: string | null;
  actual: string | null;
  expected: string | null;
  prior: string | null;
  /** The prior figure as first reported, when it was revised since. */
  revised: string | null;
}

export interface EventsReport {
  /** Unix seconds. */
  fetched: number;
  start: string;
  total: number;
  events: MarketEvent[];
}

export type EventImportance = "all" | "medium" | "high";

export interface EventFilter {
  countries: string[];
  importance: EventImportance;
}

export interface WatchDates {
  symbol: string;
  earnings: { date: string; estimated: boolean; eps_estimate: number | null } | null;
  ex_dividend: string | null;
  error: string | null;
}

/** AI read of one event, run when it is opened. */
export interface EventAnalysis {
  model: string;
  generated: number;
  tone: "positive" | "negative" | "neutral";
  summary: string;
  impacts: Impact[];
}

/** Which event dots the chart draws. */
export interface Dots {
  earnings: boolean;
  news: boolean;
  analysts: boolean;
}

export interface AiTestResult {
  model: string;
  ok: boolean;
  ms: number;
  error: string | null;
}

/** AI settings: the news toggle from settings.json plus the .env.local credentials and models. */
export interface AiConfig {
  enabled: boolean;
  base_url: string;
  /** The master model, used where a feature's own model is blank. */
  model: string;
  news_model: string;
  events_model: string;
  api_key: string;
  has_key: boolean;
}

/** Tone of a headline, from sentiment.rs. */
export type Sentiment = "positive" | "negative" | "neutral";

/** A headline from news.rs. */
export interface Article {
  title: string;
  publisher: string;
  link: string;
  /** Unix seconds. */
  published: number;
  sentiment: Sentiment;
  ai_model?: string | null;
  ai_at?: number | null;
}

export interface FeedArticle extends Article {
  symbols: string[];
}

export interface EarningsReport {
  quarter: string;
  reported: number;
  eps_actual: number | null;
  eps_estimate: number | null;
  surprise_pct: number | null;
  revenue: number | null;
}

export interface Earnings {
  symbol: string;
  currency: string | null;
  upcoming: {
    date: number;
    estimated: boolean;
    eps_estimate: number | null;
    eps_low: number | null;
    eps_high: number | null;
    revenue_estimate: number | null;
  } | null;
  history: EarningsReport[];
}

export interface FinancialPeriod {
  date: string;
  revenue: number | null;
  net_income: number | null;
  gross_profit: number | null;
  operating_income: number | null;
  free_cash_flow: number | null;
}

export interface Financials {
  symbol: string;
  currency: string | null;
  annual: FinancialPeriod[];
  quarterly: FinancialPeriod[];
}

export interface Mover {
  symbol: string;
  name: string;
  price: number | null;
  change_pct: number | null;
  volume: number | null;
  open: number | null;
  prev_close: number | null;
  high_52w: number | null;
  low_52w: number | null;
}

export interface HeatQuote {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change_pct: number;
  market_cap: number;
}

export interface Market {
  indices: Mover[];
  macros: Mover[];
  sectors: Mover[];
  gainers: Mover[];
  losers: Mover[];
  actives: Mover[];
}

export interface OptionContract {
  symbol: string;
  strike: number;
  last: number | null;
  bid: number | null;
  ask: number | null;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
  open_interest: number | null;
  iv: number | null;
  last_trade: number | null;
  itm: boolean;
}

export interface Options {
  price: number | null;
  expirations: number[];
  expiry: number | null;
  calls: OptionContract[];
  puts: OptionContract[];
}

export interface StatSection {
  title: string;
  rows: [string, string][];
}

export interface RatingChange {
  date: number;
  firm: string;
  action: "init" | "up" | "down";
  from: string | null;
  to: string;
  target: number | null;
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
  color: string;
  visible: boolean;
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
  series: { t: number[]; mas: Line[]; rsi: Line; macd: Line[]; bollinger: Line[]; vwap: Line; vwap_bands: Line[]; opening_range: Line[]; levels: Line[]; volume_ma: Line };
}

/** Which analysis layers the chart draws. */
export interface Overlays {
  mas: boolean;
  bollinger: boolean;
  vwap: boolean;
  opening_range: boolean;
  levels: boolean;
  volume_ma: boolean;
  volume_profile: boolean;
  fib: boolean;
  targets: boolean;
  patterns: boolean;
  chart_patterns: boolean;
  rsi: boolean;
  macd: boolean;
}

declare global {
  interface Window {
    /** Injected by the backend before the page loads (window.rs). */
    __TICKR_INIT__?: Init | null;
    __TICKR_CHART__?: string;
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

export function intervalsFor(range: string): readonly string[] {
  switch (range) {
    case "1d":
    case "5d":
      return ["1m", "5m", "15m", "30m", "60m"];
    case "1mo":
      return ["5m", "15m", "30m", "60m", "1d"];
    case "6mo":
    case "ytd":
    case "1y":
      return ["60m", "1d", "1wk"];
    case "5y":
    case "max":
      return ["1d", "1wk", "1mo"];
    default:
      return [];
  }
}

export const NATIVE_INTERVALS: readonly string[] = ["1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"];
export const PRESET_INTERVALS: readonly string[] = ["2m", "3m", "10m", "45m", "2h", "3h", "4h", "2d", "3d"];

export type IntervalUnit = "m" | "h" | "d" | "wk" | "mo";
export interface IntervalSpec {
  count: number;
  unit: IntervalUnit;
  seconds: number;
  bases: readonly string[];
}

const UNIT_SECONDS: Record<IntervalUnit, number> = { m: 60, h: 3600, d: 86_400, wk: 604_800, mo: 2_592_000 };
const UNIT_MAX: Record<IntervalUnit, number> = { m: 1440, h: 24, d: 30, wk: 8, mo: 12 };
const UNIT_NAMES: Record<IntervalUnit, string> = { m: "Minutes", h: "Hours", d: "Days", wk: "Weeks", mo: "Months" };
const UNIT_ALIASES = new Map<string, IntervalUnit>([["m", "m"], ["min", "m"], ["h", "h"], ["hr", "h"], ["d", "d"], ["w", "wk"], ["wk", "wk"], ["mo", "mo"]]);
const ONE: Record<IntervalUnit, string> = { m: "1m", h: "60m", d: "1d", wk: "1wk", mo: "1mo" };
const HOUR_BASES = ["30m", "60m"];
const YEAR_RANGES = ["ytd", "1y", "5y", "max"];

function basesFor(interval: string, count: number, unit: IntervalUnit): readonly string[] {
  if (NATIVE_INTERVALS.includes(interval)) return [interval];
  if (unit === "h" || (unit === "m" && count % 60 === 0)) return HOUR_BASES;
  if (unit === "m") return [30, 15, 5, 1].filter((b) => count % b === 0).map((b) => `${b}m`);
  return [`1${unit}`];
}

export function intervalSpec(interval: string): IntervalSpec | null {
  const m = /^([1-9]\d*)(m|h|d|wk|mo)$/.exec(interval);
  if (!m) return null;
  const count = Number(m[1]);
  const unit = m[2] as IntervalUnit;
  if (count > UNIT_MAX[unit]) return null;
  return { count, unit, seconds: count * UNIT_SECONDS[unit], bases: basesFor(interval, count, unit) };
}

export function isCustom(interval: string): boolean {
  return intervalSpec(interval) !== null && !NATIVE_INTERVALS.includes(interval);
}

export function baseFor(interval: string, range: string): string | null {
  const spec = intervalSpec(interval);
  if (!spec || (spec.unit === "d" && spec.count > 1 && !YEAR_RANGES.includes(range))) return null;
  return spec.bases.find((b) => intervalsFor(range).includes(b)) ?? null;
}

export function pickerIntervals(extra: readonly string[] = []): string[] {
  const all = new Set([...NATIVE_INTERVALS, ...PRESET_INTERVALS, ...extra.filter((i) => intervalSpec(i))]);
  return [...all].sort((a, b) => intervalSpec(a)!.seconds - intervalSpec(b)!.seconds);
}

export function nextInterval(range: string, interval: string, extra: readonly string[] = []): string {
  const intervals = ["auto", ...pickerIntervals(extra).filter((i) => baseFor(i, range))];
  return intervals[(intervals.indexOf(interval) + 1) % intervals.length];
}

export function validInterval(range: string, interval: string): string {
  return baseFor(interval, range) ? interval : "auto";
}

const LABELS: Record<string, string> = { "60m": "1h", "1d": "1D", "1wk": "1W", "1mo": "1M" };
const UNIT_LABELS: Record<IntervalUnit, string> = { m: "m", h: "h", d: "D", wk: "W", mo: "M" };

export function intervalLabel(interval: string): string {
  const spec = intervalSpec(interval);
  if (!spec) return interval;
  return LABELS[interval] ?? `${spec.count}${UNIT_LABELS[spec.unit]}`;
}

function minutes(n: number): string {
  return n % 60 ? `${n}m` : `${n / 60}h`;
}

export function intervalHint(interval: string): string | null {
  const spec = intervalSpec(interval);
  if (!spec || !isCustom(interval)) return null;
  if (spec.bases === HOUR_BASES) return "Built from 30m bars, or 60m bars on 6M, YTD and 1Y.";
  if (spec.unit === "d") return "Built from daily bars, counted from each year's first trading day; shown on YTD, 1Y, 5Y and Max.";
  if (spec.unit === "wk") return "Built from weekly bars, counted from Monday 5 January 1970.";
  if (spec.unit === "mo") return "Built from monthly bars, counted from January.";
  if (spec.bases[0] !== "1m") return `Built from ${spec.bases[0]} bars.`;
  const lo = Math.floor(spec.count / 5) * 5;
  const near = [lo ? minutes(lo) : null, minutes(lo + 5)].filter(Boolean).join(" or ");
  return `Built from 1m bars, so history is short: Yahoo serves 1m bars for about the last 30 days. ${near} reach further back.`;
}

export type ParsedInterval = { interval: string; hint: string | null } | { error: string };

export function parseInterval(text: string): ParsedInterval {
  const m = /^(\d+)\s*([a-z]+)$/.exec(text.trim().toLowerCase());
  let unit = m ? UNIT_ALIASES.get(m[2]) : undefined;
  if (!m || !unit) return { error: "Type a number and a unit, such as 45m, 4h, 2D, 3W or 2mo." };
  let count = Number(m[1]);
  if (!(count >= 1 && count <= UNIT_MAX[unit])) return { error: `${UNIT_NAMES[unit]} go from 1 to ${UNIT_MAX[unit]}.` };
  if (unit === "m" && count % 60 === 0) {
    count /= 60;
    unit = "h";
  }
  const interval = count === 1 ? ONE[unit] : `${count}${unit}`;
  return { interval, hint: intervalHint(interval) };
}

export interface IndicatorStyle { color: string; visible: boolean }
export interface LengthIndicator extends IndicatorStyle { length: number }
export interface IndicatorConfig {
  sma: LengthIndicator[];
  ema: LengthIndicator[];
  bollinger: LengthIndicator & { k: number };
  vwap: IndicatorStyle;
  vwap_bands: number;
  volume_profile: boolean;
  opening_range: IndicatorStyle & { minutes: number; extension: number };
  levels: IndicatorStyle;
  volume_ma: LengthIndicator;
  rsi: LengthIndicator;
  macd: IndicatorStyle & { fast: number; slow: number; signal: number; signal_color: string };
  fib: boolean;
  targets: boolean;
  patterns: boolean;
  keep_analysis: boolean;
  chart_patterns: boolean;
  chart_patterns_off: string[];
}
export interface IndicatorPreset { name: string; config: IndicatorConfig }

export interface ServiceStatus {
  id: "quote" | "news" | "ai";
  label: string;
  state: "ok" | "error" | "unknown" | "off";
  last_ok: number;
  last_error: string | null;
  last_error_at: number;
}

export interface ConnectionsReport {
  services: ServiceStatus[];
  app_version: string;
  os: string;
  provider: "yahoo" | "alpaca";
  stream: string;
  log_dir: string;
}

export interface StreamStatus { kind: "off" | "connecting" | "live" | "retrying" | "error"; message?: string }
export interface DataProvider { provider: "yahoo" | "alpaca"; feed: "iex" | "sip"; has_keys: boolean; stream: StreamStatus }

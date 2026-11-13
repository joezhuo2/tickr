import * as Paper from "./paper";
import type { ReplayState } from "./replay";
import type { Candle, Chart, Drawing, Group } from "./types";

export const CONTEXT = 60;
export const AFTER = 50;
export const KEEP_BEFORE = 300;
export const HORIZON = 120;
export const ATR_PERIOD = 14;
export const VOLATILE_SHARE = 1 / 3;
export const VOLATILE_FRACTION = 0.25;
export const MAX_TRIES = 5;
export const PERIOD_RANGE = "period";
const DAY = 86_400;

export type Rng = () => number;
export type Decision = "long" | "short" | "skip";
export type Direction = Paper.Direction;
export type Bar = Paper.Bar;

export const INTERVALS = ["60m", "1d", "1wk"] as const;
export type Interval = (typeof INTERVALS)[number];
export const INTERVAL_LABELS: Record<Interval, string> = { "60m": "1 hour", "1d": "1 day", "1wk": "1 week" };

export const RANGES = [
  { id: "3mo", label: "Last 3 months", days: 91 },
  { id: "1y", label: "Last year", days: 365 },
  { id: "2y", label: "Last 2 years", days: 730 },
  { id: "5y", label: "Last 5 years", days: 1826 },
] as const;
export type Range = (typeof RANGES)[number]["id"];

const RANGES_FOR: Record<Interval, readonly Range[]> = { "60m": ["3mo", "1y"], "1d": ["3mo", "1y", "2y", "5y"], "1wk": ["2y", "5y"] };
const PAD_DAYS: Record<Interval, number> = { "60m": 30, "1d": 150, "1wk": 600 };
const DISPLAY_RANGE: Record<Interval, string> = { "60m": "1y", "1d": "1y", "1wk": "5y" };

export interface Setup {
  scope: string;
  interval: Interval;
  range: Range;
}

export const DEFAULT_SETUP: Setup = { scope: "watchlist", interval: "1d", range: "1y" };

export function isInterval(value: unknown): value is Interval {
  return INTERVALS.includes(value as Interval);
}

export function rangesFor(interval: Interval): readonly Range[] {
  return RANGES_FOR[interval];
}

export function displayRange(interval: Interval): string {
  return DISPLAY_RANGE[interval];
}

export function scopes(groups: readonly Group[]): { id: string; label: string }[] {
  return [{ id: "watchlist", label: "All starred" }, ...groups.map((g) => ({ id: `group:${g.name}`, label: g.name }))];
}

export function validSetup(s: Setup, groups: readonly Group[]): Setup {
  const interval = isInterval(s.interval) ? s.interval : DEFAULT_SETUP.interval;
  const ranges = rangesFor(interval);
  const range = ranges.includes(s.range) ? s.range : ranges[ranges.length - 1];
  const scope = scopes(groups).some((x) => x.id === s.scope) ? s.scope : "watchlist";
  return { scope, interval, range };
}

export function scopeSymbols(scope: string, watchlist: readonly string[], groups: readonly Group[]): string[] {
  const list = scope === "watchlist" ? watchlist : (groups.find((g) => `group:${g.name}` === scope)?.symbols ?? []);
  return [...new Set(list.filter(Boolean))];
}

export function fetchWindow(setup: Setup, now: number): { start: number; end: number; from: number } {
  const days = RANGES.find((r) => r.id === setup.range)?.days ?? 365;
  const from = now - days * DAY;
  return { start: from - PAD_DAYS[setup.interval] * DAY, end: now, from };
}

export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(rng() * n)));
}

export function atrPct(bars: readonly Bar[], i: number, period = ATR_PERIOD): number | null {
  if (!Number.isInteger(i) || i < period || i >= bars.length) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) {
    const b = bars[k];
    const prev = bars[k - 1].c;
    sum += Math.max(b.h - b.l, Math.abs(b.h - prev), Math.abs(b.l - prev));
  }
  const c = bars[i].c;
  const pct = (sum / period / c) * 100;
  return c > 0 && Number.isFinite(pct) ? pct : null;
}

export function candidates(bars: readonly Bar[], from: number, context = CONTEXT, after = AFTER): number[] {
  const out: number[] = [];
  for (let i = Math.max(0, context); i + after < bars.length; i++) if (bars[i].t >= from) out.push(i);
  return out;
}

export interface Candidate {
  index: number;
  atr: number | null;
  volatile: boolean;
}

export function classify(bars: readonly Bar[], indices: readonly number[], fraction = VOLATILE_FRACTION): Candidate[] {
  const scored = indices.map((index) => ({ index, atr: atrPct(bars, index) }));
  const ranked = scored.filter((c): c is { index: number; atr: number } => c.atr != null).sort((a, b) => b.atr - a.atr || a.index - b.index);
  const floor = ranked.length ? ranked[ranked.length - 1].atr : 0;
  const hot = new Set(ranked.slice(0, Math.round(ranked.length * fraction)).filter((c) => c.atr > floor).map((c) => c.index));
  return scored.map((c) => ({ ...c, volatile: hot.has(c.index) }));
}

export function pickStart(bars: readonly Bar[], from: number, rng: Rng, share = VOLATILE_SHARE): Candidate | null {
  const list = classify(bars, candidates(bars, from));
  if (!list.length) return null;
  const hot = list.filter((c) => c.volatile);
  const calm = list.filter((c) => !c.volatile);
  const pool = !hot.length ? calm : !calm.length ? hot : rng() < share ? hot : calm;
  return pool[randomInt(rng, pool.length)];
}

export function exerciseBars<T>(bars: readonly T[], index: number, before = KEEP_BEFORE, horizon = HORIZON): { bars: T[]; start: number } {
  const from = Math.max(0, index - before);
  return { bars: bars.slice(from, Math.min(bars.length, index + horizon + 1)), start: index - from };
}

export interface Trade {
  decision: Decision;
  decided: number;
  exit: number | null;
  cancelled: boolean;
}

export type Status = "skipped" | "pending" | "open" | "closed" | "unfilled";

export interface Result {
  decision: Decision;
  status: Status;
  entry: number | null;
  entry_price: number | null;
  exit: number | null;
  exit_price: number | null;
  return_pct: number;
  bars_held: number;
}

export interface Exercise {
  setup: Setup;
  symbol: string;
  name: string;
  start: number;
  volatile: boolean;
  trade: Trade | null;
  ended: boolean;
}

export function directionOf(decision: Decision): Direction | null {
  return decision === "long" || decision === "short" ? decision : null;
}

export function decide(decision: Decision, cursor: number): Trade {
  return { decision, decided: cursor, exit: null, cancelled: false };
}

export function entryIndex(t: Trade): number {
  return t.decided + 1;
}

export function fillPrice(t: Trade, bars: readonly Bar[]): number | null {
  const direction = directionOf(t.decision);
  const i = entryIndex(t);
  if (!direction || t.decided < 0 || i >= bars.length) return null;
  const order: Paper.Order = { id: 0, symbol: "", side: direction === "long" ? "buy" : "sell", qty: 1, kind: "market", price: null, created: bars[t.decided].t };
  if (!(bars[i].t > order.created)) return null;
  const price = Paper.triggerPrice(order, bars[i], Paper.DEFAULT_COSTS);
  return price != null && price > 0 && Number.isFinite(price) ? price : null;
}

export function canClose(t: Trade, cursor: number): boolean {
  return directionOf(t.decision) != null && !t.cancelled && t.exit == null && cursor >= entryIndex(t);
}

export function close(t: Trade, cursor: number): Trade {
  return canClose(t, cursor) ? { ...t, exit: cursor } : t;
}

export function finish(t: Trade, cursor: number): Trade {
  if (!directionOf(t.decision) || t.cancelled || t.exit != null) return t;
  return cursor >= entryIndex(t) ? { ...t, exit: cursor } : { ...t, cancelled: true };
}

export function percentReturn(direction: Direction, entry: number, exit: number): number {
  return direction === "long" ? (exit / entry - 1) * 100 : (1 - exit / entry) * 100;
}

export function evaluate(t: Trade, bars: readonly Bar[], cursor: number): Result {
  const base = { decision: t.decision, entry: null, entry_price: null, exit: null, exit_price: null, return_pct: 0, bars_held: 0 };
  const direction = directionOf(t.decision);
  if (!direction) return { ...base, status: "skipped" };
  if (t.cancelled) return { ...base, status: "unfilled" };
  const entry = entryIndex(t);
  const price = fillPrice(t, bars);
  if (cursor < entry || price == null) return { ...base, status: "pending" };
  const last = Math.min(cursor, bars.length - 1);
  const closed = t.exit != null && t.exit >= entry && t.exit <= last;
  const exit = closed ? t.exit! : last;
  const exitPrice = bars[exit].c;
  return {
    ...base,
    status: closed ? "closed" : "open",
    entry,
    entry_price: price,
    exit: closed ? exit : null,
    exit_price: exitPrice,
    return_pct: percentReturn(direction, price, exitPrice),
    bars_held: exit - entry + 1,
  };
}

export function marketMove(bars: readonly Bar[], from: number, to: number): number | null {
  if (from < 0 || to >= bars.length || to <= from || !(bars[from].c > 0)) return null;
  return (bars[to].c / bars[from].c - 1) * 100;
}

export interface Summary {
  result: Result;
  skip_pct: number;
  market_pct: number | null;
  market_from: number;
  market_to: number;
}

export function summarize(t: Trade, bars: readonly Bar[]): Summary {
  const end = bars.length - 1;
  return { result: evaluate(t, bars, end), skip_pct: 0, market_pct: marketMove(bars, t.decided, end), market_from: t.decided, market_to: end };
}

export function markers(r: Result | null, bars: readonly Bar[]): { t: number; side: Paper.Side; price: number }[] {
  if (!r || r.entry == null || r.entry_price == null || r.entry >= bars.length) return [];
  const long = r.decision === "long";
  const out: { t: number; side: Paper.Side; price: number }[] = [{ t: bars[r.entry].t, side: long ? "buy" : "sell", price: r.entry_price }];
  if (r.status === "closed" && r.exit != null && r.exit_price != null) out.push({ t: bars[r.exit].t, side: long ? "sell" : "buy", price: r.exit_price });
  return out;
}

export interface SavedRun {
  id: number;
  saved: number;
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  timezone: string;
  gmtoffset: number;
  interval: Interval;
  range: Range;
  start: number;
  volatile: boolean;
  trade: Trade;
  return_pct: number;
  market_pct: number | null;
  candles: Candle[];
  drawings: Drawing[];
  note: string;
  tags: string[];
}

export function savedRun(ex: Exercise, base: Chart, drawings: Drawing[], now: number): SavedRun | null {
  if (!ex.ended || !ex.trade || !base.candles.length) return null;
  const s = summarize(ex.trade, base.candles);
  const m = base.meta;
  return {
    id: 0,
    saved: now,
    symbol: m.symbol || ex.symbol,
    name: ex.name,
    exchange: m.exchange,
    currency: m.currency,
    timezone: m.timezone ?? "",
    gmtoffset: m.gmtoffset,
    interval: ex.setup.interval,
    range: ex.setup.range,
    start: ex.start,
    volatile: ex.volatile,
    trade: ex.trade,
    return_pct: s.result.return_pct,
    market_pct: s.market_pct,
    candles: base.candles,
    drawings,
    note: "",
    tags: [],
  };
}

export function reopen(run: SavedRun): { exercise: Exercise; base: Chart; state: ReplayState } {
  const bars = run.candles;
  const last = bars[bars.length - 1];
  return {
    exercise: { setup: { ...DEFAULT_SETUP, interval: run.interval, range: run.range }, symbol: run.symbol, name: run.name, start: run.start, volatile: run.volatile, trade: run.trade, ended: true },
    base: {
      source: "practice",
      meta: { symbol: run.symbol, name: run.name, exchange: run.exchange, currency: run.currency, price: last.c, prev_close: null, market_time: last.t, gmtoffset: run.gmtoffset, timezone: run.timezone || undefined, periods: null },
      range: displayRange(run.interval),
      interval: run.interval,
      candles: bars,
      dividends: [],
      splits: [],
      last_bar_time: last.t,
    },
    state: { total: bars.length, start: run.start, cursor: bars.length - 1, playing: false, speed: 1, elapsed: 0 },
  };
}

export function sortRuns(runs: unknown): SavedRun[] {
  return Array.isArray(runs) ? [...(runs as SavedRun[])].sort((a, b) => b.saved - a.saved || b.id - a.id) : [];
}

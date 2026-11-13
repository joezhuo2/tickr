import { isIntraday } from "./session";
import { RANGES, baseFor, type Candle } from "./types";

export const MAX_CANDLES = 20_000;

const DAY = 86_400;
const STEP_LIMIT: Record<string, number> = { "1m": 7 * DAY, "5m": 55 * DAY, "15m": 55 * DAY, "30m": 55 * DAY, "60m": 700 * DAY };
const NOMINAL_DAYS: Record<string, number> = { "1d": 1, "5d": 5, "1mo": 31, "6mo": 183, ytd: 366, "1y": 366, "5y": 1830 };

export function rangeFor(range: string, interval: string): string {
  if (interval === "auto" || baseFor(interval, range)) return range;
  const at = RANGES.findIndex((r) => r.id === range);
  let best = range;
  let gap = Infinity;
  RANGES.forEach((r, i) => {
    if (baseFor(interval, r.id) && Math.abs(i - at) < gap) {
      best = r.id;
      gap = Math.abs(i - at);
    }
  });
  return best;
}

export function olderWindow(interval: string, first: number, last: number): { start: number; end: number } | null {
  if (!(first > 1)) return null;
  const span = Math.min(Math.max(last - first, 5 * DAY), STEP_LIMIT[interval] ?? 20 * 365 * DAY);
  return { start: Math.max(1, Math.floor(first - span)), end: first };
}

export function mergeOlder(older: readonly Candle[], candles: Candle[]): Candle[] {
  const first = candles[0]?.t;
  if (first == null) return candles;
  const add = older.filter((c) => c.t < first);
  return add.length ? [...add, ...candles] : candles;
}

export type GotoResult = "reached" | "exhausted" | "cancelled";

export async function loadUntil(
  target: number,
  first: () => number | null,
  step: () => Promise<boolean>,
  alive: () => boolean,
): Promise<GotoResult> {
  while (alive()) {
    const at = first();
    if (at == null) return "exhausted";
    if (at <= target) return "reached";
    if (!(await step())) return alive() ? "exhausted" : "cancelled";
  }
  return "cancelled";
}

export function ownCandles(candles: Candle[], from: number | undefined): Candle[] {
  return from == null ? candles : candles.filter((c) => c.t >= from);
}

export function withSeries<T extends { series: unknown }>(own: T, full: T): T {
  return { ...own, series: full.series };
}

export function axisRange(range: string, interval: string, seconds: number): string {
  const days = seconds / DAY;
  if (days <= (NOMINAL_DAYS[range] ?? Infinity) * 1.5) return range;
  if (days <= 1.5) return "1d";
  if (days <= 8) return "5d";
  if (isIntraday(interval)) return "1y";
  return days <= 400 ? "1mo" : "max";
}

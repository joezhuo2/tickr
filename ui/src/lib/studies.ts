import type { Candle } from "./types";

export type Series = (number | null)[];

export const STUDIES = [
  { id: "stoch", label: "Stochastic" },
  { id: "ichimoku", label: "Ichimoku" },
  { id: "supertrend", label: "Supertrend" },
  { id: "obv", label: "OBV" },
  { id: "pivots", label: "Pivot points" },
] as const;

export type StudyId = (typeof STUDIES)[number]["id"];

function average(values: Series, n: number): Series {
  return values.map((_, i) => {
    if (i < n - 1) return null;
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) {
      const v = values[k];
      if (v == null) return null;
      sum += v;
    }
    return sum / n;
  });
}

function extremes(candles: readonly Candle[], i: number, n: number): [number, number] | null {
  if (i < n - 1) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = i - n + 1; k <= i; k++) {
    hi = Math.max(hi, candles[k].h);
    lo = Math.min(lo, candles[k].l);
  }
  return [hi, lo];
}

export function stochastic(candles: readonly Candle[], length = 14, smooth = 3, signal = 3): { k: Series; d: Series } {
  const raw: Series = candles.map((c, i) => {
    const x = extremes(candles, i, length);
    if (!x) return null;
    return x[0] === x[1] ? 50 : ((c.c - x[1]) / (x[0] - x[1])) * 100;
  });
  const k = average(raw, smooth);
  return { k, d: average(k, signal) };
}

export function ichimoku(candles: readonly Candle[], fast = 9, base = 26, slow = 52) {
  const mid = (n: number): Series => candles.map((_, i) => {
    const x = extremes(candles, i, n);
    return x ? (x[0] + x[1]) / 2 : null;
  });
  const tenkan = mid(fast);
  const kijun = mid(base);
  const slowMid = mid(slow);
  const ahead = (i: number, f: (k: number) => number | null) => (i >= base ? f(i - base) : null);
  return {
    tenkan,
    kijun,
    spanA: candles.map((_, i) => ahead(i, (k) => (tenkan[k] != null && kijun[k] != null ? (tenkan[k]! + kijun[k]!) / 2 : null))),
    spanB: candles.map((_, i) => ahead(i, (k) => slowMid[k])),
    chikou: candles.map((_, i) => candles[i + base]?.c ?? null),
  };
}

export function supertrend(candles: readonly Candle[], length = 10, multiplier = 3): { value: Series; up: boolean[] } {
  const value: Series = [];
  const up: boolean[] = [];
  let atr = 0;
  let upper = 0;
  let lower = 0;
  candles.forEach((c, i) => {
    const pc = i ? candles[i - 1].c : c.c;
    const tr = Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
    atr = i < length ? (atr * i + tr) / (i + 1) : (atr * (length - 1) + tr) / length;
    if (i < length - 1) { value.push(null); up.push(true); return; }
    const mid = (c.h + c.l) / 2;
    const ub = mid + multiplier * atr;
    const lb = mid - multiplier * atr;
    const first = i === length - 1;
    upper = first || ub < upper || pc > upper ? ub : upper;
    lower = first || lb > lower || pc < lower ? lb : lower;
    const rising = first ? c.c >= mid : up[i - 1] ? c.c >= lower : c.c > upper;
    up.push(rising);
    value.push(rising ? lower : upper);
  });
  return { value, up };
}

export function obv(candles: readonly Candle[]): number[] {
  let total = 0;
  return candles.map((c, i) => {
    if (i) total += c.c > candles[i - 1].c ? c.v : c.c < candles[i - 1].c ? -c.v : 0;
    return total;
  });
}

export interface Pivot { p: number; r1: number; r2: number; s1: number; s2: number }

export function pivots(candles: readonly Candle[], period: (t: number) => number): (Pivot | null)[] {
  let current: Pivot | null = null;
  let key: number | null = null;
  let h = -Infinity;
  let l = Infinity;
  let close = 0;
  return candles.map((c) => {
    const k = period(c.t);
    if (key != null && k !== key) {
      const p = (h + l + close) / 3;
      current = { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + (h - l), s2: p - (h - l) };
      h = -Infinity;
      l = Infinity;
    }
    key = k;
    h = Math.max(h, c.h);
    l = Math.min(l, c.l);
    close = c.c;
    return current;
  });
}

export function pivotPeriod(interval: string, gmtoffset: number): (t: number) => number {
  if (/\dm$|h$/.test(interval)) return (t) => Math.floor((t + gmtoffset) / 86400);
  const date = (t: number) => new Date((t + gmtoffset) * 1000);
  if (interval === "1d") return (t) => date(t).getUTCFullYear() * 12 + date(t).getUTCMonth();
  return (t) => date(t).getUTCFullYear();
}

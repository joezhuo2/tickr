import { isIntraday } from "./session";
import type { PivotType } from "./studySettings";
import { intervalSpec, type Candle } from "./types";

export type Series = (number | null)[];

export const STUDIES = [
  { id: "stoch", label: "Stochastic" },
  { id: "ichimoku", label: "Ichimoku" },
  { id: "supertrend", label: "Supertrend" },
  { id: "obv", label: "OBV" },
  { id: "pivots", label: "Pivot points" },
  { id: "svp", label: "Session volume profile" },
  { id: "keltner", label: "Keltner channels" },
  { id: "donchian", label: "Donchian channels" },
  { id: "psar", label: "Parabolic SAR" },
  { id: "cci", label: "CCI" },
  { id: "willr", label: "Williams %R" },
  { id: "mfi", label: "MFI" },
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

export function ichimoku(candles: readonly Candle[], fast = 9, base = 26, slow = 52, shift = base) {
  const mid = (n: number): Series => candles.map((_, i) => {
    const x = extremes(candles, i, n);
    return x ? (x[0] + x[1]) / 2 : null;
  });
  const tenkan = mid(fast);
  const kijun = mid(base);
  const slowMid = mid(slow);
  const ahead = (f: (k: number) => number | null) => Array.from({ length: candles.length + shift }, (_, i) => (i >= shift ? f(i - shift) : null));
  return {
    tenkan,
    kijun,
    spanA: ahead((k) => (tenkan[k] != null && kijun[k] != null ? (tenkan[k]! + kijun[k]!) / 2 : null)),
    spanB: ahead((k) => slowMid[k]),
    chikou: candles.map((_, i) => candles[i + shift]?.c ?? null),
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

function ema(values: Series, n: number): Series {
  const k = 2 / (n + 1);
  let prev: number | null = null;
  return values.map((x, i) => {
    if (x == null || i < n - 1) return null;
    prev = prev == null ? average(values.slice(0, i + 1), n)[i] : prev + k * (x - prev);
    return prev;
  });
}

function trueRange(candles: readonly Candle[]): number[] {
  return candles.map((c, i) => (i ? Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c)) : c.h - c.l));
}

function atr(candles: readonly Candle[], n: number): Series {
  const tr = trueRange(candles);
  let prev = 0;
  return tr.map((x, i) => {
    if (i < n - 1) return null;
    prev = i === n - 1 ? tr.slice(0, n).reduce((a, b) => a + b, 0) / n : (prev * (n - 1) + x) / n;
    return prev;
  });
}

export function keltner(candles: readonly Candle[], emaLength = 20, atrLength = 10, multiplier = 2): { upper: Series; mid: Series; lower: Series } {
  const mid = ema(candles.map((c) => c.c), emaLength);
  const range = atr(candles, atrLength);
  const band = (sign: number): Series => mid.map((m, i) => (m == null || range[i] == null ? null : m + sign * multiplier * range[i]!));
  return { upper: band(1), mid, lower: band(-1) };
}

export function donchian(candles: readonly Candle[], length = 20): { upper: Series; mid: Series; lower: Series } {
  const x = candles.map((_, i) => extremes(candles, i, length));
  return { upper: x.map((e) => e && e[0]), mid: x.map((e) => e && (e[0] + e[1]) / 2), lower: x.map((e) => e && e[1]) };
}

export function cci(candles: readonly Candle[], length = 20): Series {
  const tp = candles.map((c) => (c.h + c.l + c.c) / 3);
  return tp.map((x, i) => {
    if (i < length - 1) return null;
    const win = tp.slice(i - length + 1, i + 1);
    const mean = win.reduce((a, b) => a + b, 0) / length;
    const dev = win.reduce((a, b) => a + Math.abs(b - mean), 0) / length;
    return dev === 0 ? 0 : (x - mean) / (0.015 * dev);
  });
}

export function williamsR(candles: readonly Candle[], length = 14): Series {
  return candles.map((c, i) => {
    const x = extremes(candles, i, length);
    if (!x) return null;
    return x[0] === x[1] ? -50 : ((x[0] - c.c) / (x[0] - x[1])) * -100;
  });
}

export function mfi(candles: readonly Candle[], length = 14): Series {
  const tp = candles.map((c) => (c.h + c.l + c.c) / 3);
  return candles.map((_, i) => {
    if (i < length) return null;
    let pos = 0;
    let neg = 0;
    for (let k = i - length + 1; k <= i; k++) {
      const flow = tp[k] * candles[k].v;
      if (tp[k] > tp[k - 1]) pos += flow;
      else if (tp[k] < tp[k - 1]) neg += flow;
    }
    if (pos === 0 && neg === 0) return 50;
    return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  });
}

export function parabolicSar(candles: readonly Candle[], step = 0.02, max = 0.2): { value: Series; up: boolean[] } {
  const value: Series = [];
  const up: boolean[] = [];
  let rising = true;
  let sar = 0;
  let ep = 0;
  let af = step;
  candles.forEach((c, i) => {
    if (i === 0) { value.push(null); up.push(true); return; }
    const p = candles[i - 1];
    if (i === 1) {
      rising = c.c >= p.c;
      sar = rising ? p.l : p.h;
      ep = rising ? c.h : c.l;
    } else {
      sar += af * (ep - sar);
      if (rising) {
        sar = Math.min(sar, p.l, candles[i - 2].l);
        if (c.l < sar) { rising = false; sar = ep; ep = c.l; af = step; }
        else if (c.h > ep) { ep = c.h; af = Math.min(af + step, max); }
      } else {
        sar = Math.max(sar, p.h, candles[i - 2].h);
        if (c.h > sar) { rising = true; sar = ep; ep = c.h; af = step; }
        else if (c.l < ep) { ep = c.l; af = Math.min(af + step, max); }
      }
    }
    value.push(sar);
    up.push(rising);
  });
  return { value, up };
}

export interface Pivot { p: number; r1: number; r2: number; s1: number; s2: number }

function pivotLevels(type: PivotType, h: number, l: number, close: number): Pivot {
  const range = h - l;
  if (type === "fibonacci") {
    const p = (h + l + close) / 3;
    return { p, r1: p + 0.382 * range, r2: p + 0.618 * range, s1: p - 0.382 * range, s2: p - 0.618 * range };
  }
  if (type === "camarilla") {
    return { p: (h + l + close) / 3, r1: close + (range * 1.1) / 12, r2: close + (range * 1.1) / 6, s1: close - (range * 1.1) / 12, s2: close - (range * 1.1) / 6 };
  }
  if (type === "woodie") {
    const p = (h + l + 2 * close) / 4;
    return { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + range, s2: p - range };
  }
  const p = (h + l + close) / 3;
  return { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + range, s2: p - range };
}

export function pivots(candles: readonly Candle[], period: (t: number) => number, type: PivotType = "classic"): (Pivot | null)[] {
  let current: Pivot | null = null;
  let key: number | null = null;
  let h = -Infinity;
  let l = Infinity;
  let close = 0;
  return candles.map((c) => {
    const k = period(c.t);
    if (key != null && k !== key) {
      current = pivotLevels(type, h, l, close);
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
  if (isIntraday(interval)) return (t) => Math.floor((t + gmtoffset) / 86400);
  const date = (t: number) => new Date((t + gmtoffset) * 1000);
  if (intervalSpec(interval)?.unit === "d") return (t) => date(t).getUTCFullYear() * 12 + date(t).getUTCMonth();
  return (t) => date(t).getUTCFullYear();
}

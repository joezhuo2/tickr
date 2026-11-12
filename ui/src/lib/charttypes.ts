import type { Candle, ChartMode } from "./types";

export const CHART_MODES: { id: ChartMode; label: string }[] = [
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "baseline", label: "Baseline" },
  { id: "candles", label: "Candles" },
  { id: "hollow", label: "Hollow" },
  { id: "bars", label: "Bars" },
  { id: "heikin", label: "Heikin Ashi" },
  { id: "renko", label: "Renko" },
];

export function nextMode(mode: ChartMode): ChartMode {
  const i = CHART_MODES.findIndex((m) => m.id === mode);
  return CHART_MODES[(i + 1) % CHART_MODES.length].id;
}

export function isOhlc(mode: ChartMode): boolean {
  return mode !== "line" && mode !== "area" && mode !== "baseline";
}

export function heikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const k of candles) {
    const prev = out[out.length - 1];
    const c = (k.o + k.h + k.l + k.c) / 4;
    const o = prev ? (prev.o + prev.c) / 2 : (k.o + k.c) / 2;
    out.push({ ...k, o, c, h: Math.max(k.h, o, c), l: Math.min(k.l, o, c) });
  }
  return out;
}

export function brickSize(candles: readonly Candle[], length = 14): number {
  const n = candles.length;
  if (n === 0) return 0;
  let sum = 0;
  let count = 0;
  for (let i = Math.max(1, n - length); i < n; i++) {
    const k = candles[i];
    const pc = candles[i - 1].c;
    sum += Math.max(k.h - k.l, Math.abs(k.h - pc), Math.abs(k.l - pc));
    count++;
  }
  const atr = count ? sum / count : 0;
  return atr > 0 ? atr : Math.abs(candles[n - 1].c) * 0.01;
}

export const RENKO_MAX = 5000;

export function renko(candles: readonly Candle[], size = brickSize(candles)): Candle[] {
  const out: Candle[] = [];
  if (!candles.length || !(size > 0)) return out;
  let top = candles[0].c;
  let bottom = top;
  let v = 0;
  for (const k of candles) {
    v += k.v;
    while (k.c >= top + size || k.c <= bottom - size) {
      const up = k.c >= top + size;
      const o = up ? top : bottom;
      const c = up ? top + size : bottom - size;
      out.push({ ...k, o, c, h: Math.max(o, c), l: Math.min(o, c), v });
      v = 0;
      if (up) { bottom = top; top = c; } else { top = bottom; bottom = c; }
      if (out.length >= RENKO_MAX) return out;
    }
  }
  return out;
}

export function displayCandles(candles: Candle[], mode: ChartMode): Candle[] {
  return mode === "heikin" ? heikinAshi(candles) : mode === "renko" ? renko(candles) : candles;
}

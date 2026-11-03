import { niceTicks, num } from "./format";
import type { ChartScale } from "./types";

export function forward(price: number, lo: number, hi: number, scale: ChartScale): number {
  if (hi === lo) return 0.5;
  if (scale === "log" && price <= 0) return -1;
  return scale === "log"
    ? (Math.log10(price) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))
    : (price - lo) / (hi - lo);
}

export function inverse(position: number, lo: number, hi: number, scale: ChartScale): number {
  return scale === "log"
    ? 10 ** (Math.log10(lo) + position * (Math.log10(hi) - Math.log10(lo)))
    : lo + position * (hi - lo);
}

export function percent(price: number, base: number): number {
  return (price - base) / Math.abs(base) * 100;
}

export function scaleLabel(price: number, scale: ChartScale, base: number): string {
  if (scale !== "percent") return num(price);
  const value = percent(price, base);
  return Math.abs(value) < 0.05 ? "0%" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function scaleTicks(lo: number, hi: number, scale: ChartScale, base: number, count = 4): number[] {
  if (scale === "percent") {
    return niceTicks(percent(lo, base), percent(hi, base), count).map((v) => base + v / 100 * Math.abs(base));
  }
  if (scale !== "log") return niceTicks(lo, hi, count);
  const span = Math.log10(hi) - Math.log10(lo);
  if (span < 0.3) return niceTicks(lo, hi, count);
  const stride = Math.max(1, Math.ceil(span / count));
  const multiples = span > count ? [1] : span > count / 2 ? [1, 5] : [1, 2, 5];
  const ticks: number[] = [];
  for (let exponent = Math.floor(Math.log10(lo)); exponent <= Math.ceil(Math.log10(hi)); exponent += stride) {
    for (const multiple of multiples) {
      const value = multiple * 10 ** exponent;
      if (value >= lo && value <= hi) ticks.push(value);
    }
  }
  return ticks;
}

export function fitScale(candles: number[], values: number[], requested: ChartScale, base: number) {
  const scale = requested === "log" && !candles.some((v) => v > 0 && Number.isFinite(v))
    || requested === "percent" && (!Number.isFinite(base) || base === 0) ? "linear" : requested;
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of [...candles, ...values]) {
    if (!Number.isFinite(value) || (scale === "log" && value <= 0)) continue;
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (scale === "log") {
    if (!(hi > lo)) { hi *= 1.01; lo /= 1.01; }
    const lower = inverse(-0.06, lo, hi, scale);
    hi = inverse(1.06, lo, hi, scale);
    lo = lower;
  } else {
    if (!(hi > lo)) { hi = lo + 1; lo -= 1; }
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
  }
  return { lo, hi, scale };
}

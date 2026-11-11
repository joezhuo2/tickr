import type { Candle, IndicatorConfig, Overlays } from "./types";

export function overlayVisibility(c: IndicatorConfig): Overlays {
  return {
    mas: [...c.sma, ...c.ema].some((l) => l.visible),
    bollinger: c.bollinger.visible, vwap: c.vwap.visible, opening_range: c.opening_range.visible, levels: c.levels.visible, volume_ma: c.volume_ma.visible, rsi: c.rsi.visible, macd: c.macd.visible,
    fib: c.fib, targets: c.targets, patterns: c.patterns, volume_profile: c.volume_profile,
  };
}

export function toggleOverlay(c: IndicatorConfig, key: keyof Overlays, visible: boolean): IndicatorConfig {
  if (key === "mas") return { ...c, sma: c.sma.map((l) => ({ ...l, visible })), ema: c.ema.map((l) => ({ ...l, visible })) };
  if (key === "fib" || key === "targets" || key === "patterns" || key === "volume_profile") return { ...c, [key]: visible };
  return { ...c, [key]: { ...c[key], visible } };
}

export function shouldAnalyze(shown: boolean, keep: boolean): boolean {
  return shown || keep;
}

/** Volume by price over candles i0..i1: each candle's volume is spread evenly over the bins its range touches. */
export function volumeProfile(candles: readonly Candle[], i0: number, i1: number, bins = 24): { lo: number; step: number; volumes: number[] } | null {
  const shown = candles.slice(Math.max(0, i0), i1 + 1);
  if (!shown.length) return null;
  const lo = Math.min(...shown.map((c) => c.l));
  const hi = Math.max(...shown.map((c) => c.h));
  if (!(hi > lo)) return null;
  const step = (hi - lo) / bins;
  const volumes = Array<number>(bins).fill(0);
  const bin = (p: number) => Math.min(bins - 1, Math.max(0, Math.floor((p - lo) / step)));
  for (const c of shown) {
    const [a, b] = [bin(c.l), bin(c.h)];
    for (let k = a; k <= b; k++) volumes[k] += c.v / (b - a + 1);
  }
  return { lo, step, volumes };
}

export const PANEL_MIN = 92;

export function clampPanel(height: number, total: number): number {
  return Math.round(Math.max(PANEL_MIN, Math.min(height, total * 0.85)));
}

export function paneLayout(height: number, rsi: boolean, macd: boolean) {
  const count = Number(rsi) + Number(macd);
  const priceH = height * (count === 2 ? 0.42 : count === 1 ? 0.6 : 0.8);
  const volTop = height * (count === 2 ? 0.44 : count === 1 ? 0.62 : 0.84);
  const volH = height * (count ? 0.12 : 0.16);
  const paneH = height * (count === 2 ? 0.19 : 0.22);
  const first = height * (count === 2 ? 0.6 : 0.78);
  return { priceH, volTop, volH, rsiTop: first, rsiH: paneH, macdTop: first + (rsi ? paneH + height * 0.02 : 0), macdH: paneH };
}

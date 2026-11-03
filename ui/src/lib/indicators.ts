import type { IndicatorConfig, Overlays } from "./types";

export function overlayVisibility(c: IndicatorConfig): Overlays {
  return {
    mas: [...c.sma, ...c.ema].some((l) => l.visible),
    bollinger: c.bollinger.visible, vwap: c.vwap.visible, rsi: c.rsi.visible, macd: c.macd.visible,
    fib: c.fib, targets: c.targets, patterns: c.patterns,
  };
}

export function toggleOverlay(c: IndicatorConfig, key: keyof Overlays, visible: boolean): IndicatorConfig {
  if (key === "mas") return { ...c, sma: c.sma.map((l) => ({ ...l, visible })), ema: c.ema.map((l) => ({ ...l, visible })) };
  if (key === "fib" || key === "targets" || key === "patterns") return { ...c, [key]: visible };
  return { ...c, [key]: { ...c[key], visible } };
}

export function shouldAnalyze(shown: boolean, keep: boolean): boolean {
  return shown || keep;
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

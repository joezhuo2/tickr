import { num } from "./format";
import { CHART_PATTERN_KINDS, type ChartPatternKind } from "./patternInfo";
import type { Analysis, Candle, IndicatorConfig, Overlays } from "./types";

export function overlayVisibility(c: IndicatorConfig): Overlays {
  return {
    mas: [...c.sma, ...c.ema].some((l) => l.visible),
    bollinger: c.bollinger.visible, vwap: c.vwap.visible, opening_range: c.opening_range.visible, levels: c.levels.visible, volume_ma: c.volume_ma.visible, rsi: c.rsi.visible, macd: c.macd.visible,
    fib: c.fib, targets: c.targets, patterns: c.patterns, chart_patterns: c.chart_patterns, volume_profile: c.volume_profile,
  };
}

export function toggleOverlay(c: IndicatorConfig, key: keyof Overlays, visible: boolean): IndicatorConfig {
  if (key === "mas") return { ...c, sma: c.sma.map((l) => ({ ...l, visible })), ema: c.ema.map((l) => ({ ...l, visible })) };
  if (key === "fib" || key === "targets" || key === "patterns" || key === "chart_patterns" || key === "volume_profile") return { ...c, [key]: visible };
  return { ...c, [key]: { ...c[key], visible } };
}

export const OVERLAY_TOGGLES: { key: keyof Overlays; label: string }[] = [
  { key: "mas", label: "Moving averages" },
  { key: "bollinger", label: "Bollinger bands" },
  { key: "vwap", label: "VWAP" },
  { key: "opening_range", label: "Opening range" },
  { key: "levels", label: "Key levels" },
  { key: "volume_ma", label: "Volume average" },
  { key: "volume_profile", label: "Volume profile" },
  { key: "fib", label: "Fibonacci" },
  { key: "targets", label: "Targets" },
  { key: "patterns", label: "Patterns" },
  { key: "chart_patterns", label: "Chart patterns" },
  { key: "rsi", label: "RSI pane" },
  { key: "macd", label: "MACD pane" },
];

export function chartPatternKinds(c: IndicatorConfig): ChartPatternKind[] {
  return CHART_PATTERN_KINDS.filter((k) => !c.chart_patterns_off.includes(k));
}

export function toggleChartPattern(c: IndicatorConfig, kind: ChartPatternKind, on: boolean): IndicatorConfig {
  const off = c.chart_patterns_off.filter((k) => k !== kind);
  return { ...c, chart_patterns_off: on ? off : [...off, kind] };
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

export interface AlertLevel {
  label: string;
  level: number;
  direction: "above" | "below";
}

/** Breakout levels worth an alert: the latest opening range, prior-day and premarket highs and lows. */
export function alertLevels(series: Pick<Analysis["series"], "opening_range" | "levels">): AlertLevel[] {
  const last = (key: string) => [...series.opening_range, ...series.levels].find((l) => l.key === key)?.values.filter((v) => v != null).pop() ?? null;
  const all: [string, string, AlertLevel["direction"]][] = [
    ["or_high", "OR high", "above"], ["or_low", "OR low", "below"],
    ["pd_high", "PDH", "above"], ["pd_low", "PDL", "below"],
    ["pm_high", "PMH", "above"], ["pm_low", "PML", "below"],
  ];
  return all.flatMap(([key, label, direction]) => {
    const level = last(key);
    return level != null && level > 0 ? [{ label, level, direction }] : [];
  });
}

export const PANEL_MIN = 92;

export function clampPanel(height: number, total: number): number {
  return Math.round(Math.max(PANEL_MIN, Math.min(height, total * 0.85)));
}

export function paneLayout(height: number, rsi: boolean, macd: boolean, extra = 0) {
  const count = Number(rsi) + Number(macd) + extra;
  const gap = height * 0.02;
  const many = count > 2;
  const priceH = height * (many ? 0.46 - 0.06 * (count - 1) : count === 2 ? 0.42 : count === 1 ? 0.6 : 0.8);
  const volTop = many ? priceH + gap : height * (count === 2 ? 0.44 : count === 1 ? 0.62 : 0.84);
  const volH = height * (many ? 0.1 : count ? 0.12 : 0.16);
  const first = many ? volTop + volH + height * 0.03 : height * (count === 2 ? 0.6 : 0.78);
  const paneH = many ? (height - first - gap * (count - 1)) / count : height * (count === 2 ? 0.19 : 0.22);
  const top = (k: number) => first + k * (paneH + gap);
  const used = Number(rsi) + Number(macd);
  return { priceH, volTop, volH, rsiTop: first, rsiH: paneH, macdTop: top(Number(rsi)), macdH: paneH, extraTops: Array.from({ length: extra }, (_, k) => top(used + k)) };
}

export function legendText(label: string, values: (number | null)[], digits?: number): string {
  const shown = values.filter((v): v is number => v != null && Number.isFinite(v)).map((v) => num(v, digits));
  return shown.length ? `${label}  ${shown.join(" / ")}` : label;
}

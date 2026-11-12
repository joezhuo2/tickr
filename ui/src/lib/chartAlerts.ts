import { timeToIndex } from "./drawing";
import { check, evaluate, parse, type SessionClock } from "./strategy";
import type { Candle, DrawingPoint } from "./types";

export interface LineSpec {
  a: DrawingPoint;
  b: DrawingPoint;
  direction: "above" | "below";
}

export interface ChartAlert {
  id: number;
  symbol: string;
  interval: string;
  label: string;
  expr: string | null;
  line: LineSpec | null;
  enabled: boolean;
  fired_at: number | null;
}

export const MAX_CHART_ALERTS = 50;

export const PRESETS: { label: string; expr: string }[] = [
  { label: "RSI crosses above 70", expr: "crosses_above(rsi(14), 70)" },
  { label: "RSI crosses below 30", expr: "crosses_below(rsi(14), 30)" },
  { label: "SMA 20 crosses above SMA 50", expr: "crosses_above(sma(20), sma(50))" },
  { label: "SMA 20 crosses below SMA 50", expr: "crosses_below(sma(20), sma(50))" },
  { label: "Close crosses above SMA 50", expr: "crosses_above(close, sma(50))" },
  { label: "Close crosses below EMA 21", expr: "crosses_below(close, ema(21))" },
];

export function lineValue(line: Pick<LineSpec, "a" | "b">, times: number[], i: number): number | null {
  const ia = timeToIndex(times, line.a.t);
  const ib = timeToIndex(times, line.b.t);
  if (ia === ib) return null;
  return line.a.price + ((line.b.price - line.a.price) * (i - ia)) / (ib - ia);
}

export function lineBroken(line: LineSpec, candles: readonly Candle[]): boolean {
  const n = candles.length;
  if (n < 2) return false;
  const times = candles.map((c) => c.t);
  const prev = lineValue(line, times, n - 2);
  const now = lineValue(line, times, n - 1);
  if (prev == null || now == null) return false;
  const [before, after] = [candles[n - 2].c, candles[n - 1].c];
  return line.direction === "above" ? before <= prev && after > now : before >= prev && after < now;
}

export function holds(alert: Pick<ChartAlert, "expr" | "line">, candles: readonly Candle[], clock?: SessionClock): boolean {
  if (alert.line) return lineBroken(alert.line, candles);
  if (!alert.expr || candles.length < 2 || check(alert.expr)) return false;
  const hits = evaluate(parse(alert.expr), candles, clock);
  return hits[hits.length - 1] === true;
}

export function due(alerts: readonly ChartAlert[], symbol: string, interval: string, candles: readonly Candle[], clock?: SessionClock): ChartAlert[] {
  const s = symbol.toUpperCase();
  return alerts.filter((a) => a.enabled && a.symbol === s && a.interval === interval && holds(a, candles, clock));
}

export function addError(alerts: readonly ChartAlert[], expr: string | null): string | null {
  if (alerts.length >= MAX_CHART_ALERTS) return `At most ${MAX_CHART_ALERTS} chart alerts are allowed`;
  if (expr == null) return null;
  if (!expr.trim()) return "Enter a condition";
  if (expr.length > 200) return "Conditions are limited to 200 characters";
  return check(expr);
}

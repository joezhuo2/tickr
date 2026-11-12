import { holds, type ChartAlert } from "./chartAlerts";
import type { SessionClock } from "./strategy";
import type { Candle } from "./types";

const TABLE = new Map<string, { range: string; seconds: number }>([
  ["1m", { range: "5d", seconds: 60 }],
  ["5m", { range: "5d", seconds: 300 }],
  ["15m", { range: "1mo", seconds: 900 }],
  ["30m", { range: "1mo", seconds: 1800 }],
  ["60m", { range: "1mo", seconds: 3600 }],
  ["1d", { range: "1y", seconds: 86_400 }],
  ["1wk", { range: "5y", seconds: 604_800 }],
  ["1mo", { range: "max", seconds: 2_592_000 }],
]);

export const FLOOR = 60;
export const CAP = 900;
export const DELAY = 15;
export const STAGGER = 30;
export const CONCURRENCY = 2;

export interface Group {
  key: string;
  symbol: string;
  interval: string;
  range: string;
}

export function cadence(interval: string): number | null {
  const row = TABLE.get(interval);
  return row ? Math.min(CAP, Math.max(FLOOR, row.seconds)) : null;
}

export function inBackground(alert: Pick<ChartAlert, "interval">): boolean {
  return TABLE.has(alert.interval);
}

export function groups(alerts: readonly ChartAlert[]): Group[] {
  const out = new Map<string, Group>();
  for (const a of alerts) {
    const row = TABLE.get(a.interval);
    const key = `${a.symbol}|${a.interval}`;
    if (a.enabled && row && !out.has(key)) out.set(key, { key, symbol: a.symbol, interval: a.interval, range: row.range });
  }
  return [...out.values()];
}

export function stagger(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % STAGGER;
}

export function nextCheck(group: Pick<Group, "key" | "interval">, after: number): number {
  const step = cadence(group.interval) ?? CAP;
  return (Math.floor(after / step) + 1) * step + DELAY + stagger(group.key);
}

export function dueGroups(all: readonly Group[], checked: ReadonlyMap<string, number>, now: number): Group[] {
  return all.filter((g) => {
    const last = checked.get(g.key);
    return last == null || now >= nextCheck(g, last);
  });
}

export function triggered(alerts: readonly ChartAlert[], symbol: string, interval: string, candles: readonly Candle[], clock: SessionClock | undefined, since: number | null): ChartAlert[] {
  const s = symbol.toUpperCase();
  const closedSince = since != null && candles.length > 0 && candles[candles.length - 1].t > since;
  const closed = candles.slice(0, -1);
  return alerts.filter((a) => a.enabled && a.symbol === s && a.interval === interval && (holds(a, candles, clock) || (closedSince && holds(a, closed, clock))));
}

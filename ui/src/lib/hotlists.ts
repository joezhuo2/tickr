import { volume } from "./format";
import type { Market, Mover } from "./types";

export const HOTLISTS = [
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "active", label: "Most active" },
  { id: "gap-up", label: "Gap up" },
  { id: "gap-down", label: "Gap down" },
  { id: "high", label: "52w highs" },
  { id: "low", label: "52w lows" },
] as const;

export type HotlistId = (typeof HOTLISTS)[number]["id"];

export const HOTLIST_SIZE = 25;

export interface HotRow {
  mover: Mover;
  px: string | null;
  pct: number | null;
}

const ratio = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? (a / b - 1) * 100 : null);

export function hotlist(market: Market, id: HotlistId): HotRow[] {
  if (id === "gainers" || id === "losers") {
    return market[id].slice(0, HOTLIST_SIZE).map((mover) => ({ mover, px: null, pct: mover.change_pct }));
  }
  if (id === "active") {
    return [...market.actives]
      .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))
      .slice(0, HOTLIST_SIZE)
      .map((mover) => ({ mover, px: volume(mover.volume), pct: mover.change_pct }));
  }
  const seen = new Set<string>();
  const pool = [...market.actives, ...market.gainers, ...market.losers].filter((m) => !seen.has(m.symbol) && seen.add(m.symbol));
  const sign = id === "gap-up" || id === "high" ? 1 : -1;
  const metric = (m: Mover) =>
    id === "gap-up" || id === "gap-down" ? ratio(m.open, m.prev_close) : ratio(m.price, id === "high" ? m.high_52w : m.low_52w);
  return pool
    .map((mover) => ({ mover, px: null, pct: metric(mover) }))
    .filter((r) => r.pct != null)
    .sort((a, b) => sign * ((b.pct as number) - (a.pct as number)))
    .slice(0, HOTLIST_SIZE);
}

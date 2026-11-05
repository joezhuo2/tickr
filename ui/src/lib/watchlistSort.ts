import type { WatchlistSort, WatchlistSortKey } from "./types";

export const DEFAULT_WATCHLIST_SORT: WatchlistSort = { key: "change", dir: "desc" };

export const WATCHLIST_SORT_KEYS: { key: WatchlistSortKey; label: string }[] = [
  { key: "price", label: "Price" },
  { key: "change", label: "Change" },
  { key: "volume", label: "Volume" },
];

export function nextSort(sort: WatchlistSort, key: WatchlistSortKey): WatchlistSort {
  if (sort.key !== key) return { key, dir: "desc" };
  return { key, dir: sort.dir === "desc" ? "asc" : "desc" };
}

export function sortSymbols(
  symbols: string[],
  value: (symbol: string, key: WatchlistSortKey) => number | null | undefined,
  sort: WatchlistSort,
): string[] {
  const sign = sort.dir === "desc" ? -1 : 1;
  const rows = symbols.map((symbol, i) => ({ symbol, i, v: value(symbol, sort.key) }));
  return rows
    .sort((a, b) => {
      const aKnown = a.v != null && Number.isFinite(a.v);
      const bKnown = b.v != null && Number.isFinite(b.v);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (aKnown && bKnown && a.v !== b.v) return sign * (a.v! - b.v!);
      return a.i - b.i;
    })
    .map((r) => r.symbol);
}

import type { SearchHit } from "./types";

export type SearchType = "all" | "stocks" | "etfs" | "crypto" | "currencies" | "indices" | "funds";

export const SEARCH_TYPES: { key: SearchType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "stocks", label: "Stocks" },
  { key: "etfs", label: "ETFs" },
  { key: "crypto", label: "Crypto" },
  { key: "currencies", label: "Currencies" },
  { key: "indices", label: "Indices" },
  { key: "funds", label: "Funds" },
];

const QUOTE_TYPES: Record<string, { type: Exclude<SearchType, "all">; label: string }> = {
  EQUITY: { type: "stocks", label: "Equity" },
  ETF: { type: "etfs", label: "ETF" },
  CRYPTOCURRENCY: { type: "crypto", label: "Cryptocurrency" },
  CURRENCY: { type: "currencies", label: "Currency" },
  INDEX: { type: "indices", label: "Index" },
  MUTUALFUND: { type: "funds", label: "Mutual Fund" },
};

const SEPARATORS = /[\s.\-/_^=]/g;

function known(key: string): { type: Exclude<SearchType, "all">; label: string } | undefined {
  return Object.hasOwn(QUOTE_TYPES, key) ? QUOTE_TYPES[key] : undefined;
}

export function searchTypeOf(hit: SearchHit): Exclude<SearchType, "all"> | null {
  return known((hit.quote_type ?? "").trim().toUpperCase())?.type ?? null;
}

export function matchesType(hit: SearchHit, type: SearchType): boolean {
  return type === "all" || searchTypeOf(hit) === type;
}

export function filterHits(hits: SearchHit[], type: SearchType, exchange: string): SearchHit[] {
  return hits.filter((h) => matchesType(h, type) && (!exchange || h.exchange === exchange));
}

export function exchangesOf(hits: SearchHit[]): string[] {
  const seen = new Set<string>();
  for (const h of hits) {
    const ex = (h.exchange ?? "").trim();
    if (ex) seen.add(ex);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function compact(s: string): string {
  return s.toLowerCase().replace(SEPARATORS, "");
}

function tier(symbol: string, query: string, compactQuery: string): number {
  const sym = symbol.trim().toLowerCase();
  if (sym === query) return 0;
  const compactSym = compact(sym);
  if (compactQuery && compactSym === compactQuery) return 1;
  if (sym.startsWith(query) || (compactQuery && compactSym.startsWith(compactQuery))) return 2;
  return 3;
}

export function rankHits(hits: SearchHit[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...hits];
  const cq = compact(q);
  return hits
    .map((hit, i) => ({ hit, i, t: tier(hit.symbol ?? "", q, cq) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((r) => r.hit);
}

export function searchView(hits: SearchHit[], query: string, type: SearchType, exchange: string): SearchHit[] {
  return rankHits(filterHits(hits, type, exchange), query);
}

export function hitCurrency(hit: SearchHit): string {
  const given = (hit.currency ?? "").trim().toUpperCase();
  if (given) return given;
  const symbol = (hit.symbol ?? "").trim().toUpperCase();
  const kind = known((hit.quote_type ?? "").trim().toUpperCase())?.type;
  if (kind === "crypto") return /^[A-Z0-9]+-([A-Z]{3,4})$/.exec(symbol)?.[1] ?? "";
  if (kind === "currencies") return /^[A-Z]{6}=X$/.exec(symbol) ? symbol.slice(3, 6) : "";
  return "";
}

export function hitTypeLabel(hit: SearchHit): string {
  const given = (hit.kind ?? "").trim();
  if (given) return given;
  return known((hit.quote_type ?? "").trim().toUpperCase())?.label ?? "";
}

export function hitLabel(hit: SearchHit): string {
  return [(hit.exchange ?? "").trim(), hitCurrency(hit), hitTypeLabel(hit)].filter(Boolean).join(" · ");
}

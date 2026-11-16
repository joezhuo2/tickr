import type { Candle } from "./types";

export const MAX_COMPARE = 4;
export const COMPARE_COLORS = ["--ma-1", "--ma-2", "--accent", "--rsi"] as const;

export function cleanCompare(v: unknown): string[] {
  const out: string[] = [];
  for (const s of Array.isArray(v) ? v : []) {
    const sym = typeof s === "string" ? s.trim().toUpperCase() : "";
    if (/^[A-Z0-9.^=-]{1,15}$/.test(sym) && !out.includes(sym)) out.push(sym);
  }
  return out.slice(0, MAX_COMPARE);
}

export function alignCloses(times: readonly number[], other: readonly Candle[]): (number | null)[] {
  let k = -1;
  return times.map((t) => {
    while (k + 1 < other.length && other[k + 1].t <= t) k++;
    return k < 0 ? null : other[k].c;
  });
}

export function rebase(aligned: readonly (number | null)[], from: number, to: number, base: number): { values: (number | null)[]; first: number | null } {
  let first: number | null = null;
  for (let i = from; i < aligned.length && first == null; i++) first = aligned[i];
  const values = aligned.map((x, i) => (first && x != null && i >= from - 1 && i <= to + 1 ? (x / first) * base : null));
  return { values, first };
}

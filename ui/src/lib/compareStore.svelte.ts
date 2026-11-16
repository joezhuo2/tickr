import { invoke } from "@tauri-apps/api/core";
import { aggregateChart } from "./aggregate";
import { MAX_COMPARE, cleanCompare } from "./compare";
import { baseFor, type Candle, type Chart } from "./types";

const KEY = "tickr.compare";

function load(): string[] {
  try { return cleanCompare(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return []; }
}

export const compare = $state({ symbols: load() });

function save(next: string[]) {
  compare.symbols = cleanCompare(next);
  try { localStorage.setItem(KEY, JSON.stringify(compare.symbols)); } catch { /* storage unavailable */ }
}

export function addCompare(symbol: string) {
  const sym = cleanCompare([symbol])[0];
  if (sym && compare.symbols.length < MAX_COMPARE) save([...compare.symbols, sym]);
}

export function removeCompare(symbol: string) {
  save(compare.symbols.filter((s) => s !== symbol));
}

export async function fetchCandles(symbol: string, range: string, interval: string, extended: boolean): Promise<Candle[]> {
  const c = await invoke<Chart>("get_chart", { symbol, range, interval: baseFor(interval, range) ?? interval, extended });
  return aggregateChart(c, interval).candles;
}

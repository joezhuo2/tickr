import { atrPct, evaluate, type Decision, type SavedRun } from "./practice";

export type Outcome = "win" | "loss" | "even";

export interface TradeRow {
  id: number;
  symbol: string;
  saved: number;
  currency: string;
  decision: Decision;
  entry: number;
  exit: number;
  pct: number;
  r: number | null;
  outcome: Outcome;
  tags: string[];
  note: string;
}

export interface Stats {
  trades: number;
  wins: number;
  winRate: number | null;
  avgR: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  longestWin: number;
  longestLoss: number;
  current: { outcome: Outcome; length: number } | null;
}

export interface Group {
  key: string;
  trades: number;
  winRate: number;
  avgR: number | null;
  expectancy: number | null;
}

const outcomeOf = (pct: number): Outcome => (pct > 0 ? "win" : pct < 0 ? "loss" : "even");
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export function tradeRows(runs: readonly SavedRun[]): TradeRow[] {
  const rows: TradeRow[] = [];
  for (const run of runs) {
    const t = run.trade;
    if (t.decision === "skip" || t.cancelled || t.exit == null) continue;
    const e = evaluate(t, run.candles, run.candles.length - 1);
    if (e.status !== "closed" || e.entry_price == null || e.exit_price == null) continue;
    const risk = atrPct(run.candles, t.decided);
    rows.push({
      id: run.id,
      symbol: run.symbol,
      saved: run.saved,
      currency: run.currency,
      decision: t.decision,
      entry: e.entry_price,
      exit: e.exit_price,
      pct: run.return_pct,
      r: risk ? run.return_pct / risk : null,
      outcome: outcomeOf(run.return_pct),
      tags: run.tags ?? [],
      note: run.note ?? "",
    });
  }
  return rows.sort((a, b) => a.saved - b.saved || a.id - b.id);
}

function expectancy(rs: number[]): number | null {
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  if (!rs.length) return null;
  return ((wins.length / rs.length) * (mean(wins) ?? 0)) + ((losses.length / rs.length) * (mean(losses) ?? 0));
}

export function computeStats(rows: readonly TradeRow[]): Stats {
  const rs = rows.flatMap((r) => (r.r == null ? [] : [r.r]));
  const win = rows.filter((r) => r.outcome === "win").length;
  const gain = rows.reduce((a, r) => a + Math.max(r.pct, 0), 0);
  const loss = rows.reduce((a, r) => a + Math.max(-r.pct, 0), 0);
  let longestWin = 0;
  let longestLoss = 0;
  let current = null as Stats["current"];
  for (const r of rows) {
    current = current?.outcome === r.outcome ? { outcome: r.outcome, length: current.length + 1 } : { outcome: r.outcome, length: 1 };
    if (r.outcome === "win") longestWin = Math.max(longestWin, current.length);
    if (r.outcome === "loss") longestLoss = Math.max(longestLoss, current.length);
  }
  return {
    trades: rows.length,
    wins: win,
    winRate: rows.length ? win / rows.length : null,
    avgR: mean(rs),
    expectancy: expectancy(rs),
    profitFactor: loss > 0 ? gain / loss : gain > 0 ? Infinity : null,
    longestWin,
    longestLoss,
    current,
  };
}

export function breakdown(rows: readonly TradeRow[], by: "symbol" | "tag"): Group[] {
  const buckets = new Map<string, TradeRow[]>();
  for (const r of rows) for (const k of by === "symbol" ? [r.symbol] : r.tags) buckets.set(k, [...(buckets.get(k) ?? []), r]);
  return [...buckets]
    .map(([key, list]) => {
      const s = computeStats(list);
      return { key, trades: s.trades, winRate: s.winRate ?? 0, avgR: s.avgR, expectancy: s.expectancy };
    })
    .sort((a, b) => b.trades - a.trades || a.key.localeCompare(b.key));
}

export function filterRows(rows: readonly TradeRow[], symbol: string, tag: string): TradeRow[] {
  return rows.filter((r) => (!symbol || r.symbol === symbol) && (!tag || r.tags.includes(tag)));
}

export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];
}

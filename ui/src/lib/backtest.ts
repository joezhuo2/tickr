import { DEFAULT_CLOCK, evaluate, parse, values, type SessionClock } from "./strategy";
import type { Candle } from "./types";

export interface Rules {
  entry: string;
  /** Optional price expression: buy when a bar trades up through it, instead of at the next open. */
  entry_stop?: string;
  exit: string;
  stop_pct: number | null;
  target_pct: number | null;
}

export type ExitReason = "signal" | "stop" | "target" | "end";

export interface Trade {
  entry_time: number;
  entry_price: number;
  exit_time: number;
  exit_price: number;
  return_pct: number;
  reason: ExitReason;
}

export interface Report {
  trades: Trade[];
  count: number;
  win_rate: number | null;
  total_return: number;
  max_drawdown: number;
  buy_hold: number;
  avg_trade: number | null;
  profit_factor: number | null;
  sharpe: number | null;
  curve: CurvePoint[];
}

export interface CurvePoint {
  t: number;
  equity: number;
  drawdown: number;
}

const YEAR_SECONDS = 365.25 * 86_400;

export function profitFactor(returns: readonly number[]): number | null {
  if (!returns.length) return null;
  const win = returns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const loss = -returns.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  return loss > 0 ? win / loss : win > 0 ? Infinity : null;
}

export function sharpe(curve: readonly CurvePoint[]): number | null {
  const n = curve.length - 1;
  const span = n > 0 ? curve[n].t - curve[0].t : 0;
  if (n < 2 || span <= 0) return null;
  const r = curve.slice(1).map((p, i) => p.equity / curve[i].equity - 1);
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return sd > 1e-12 ? (mean / sd) * Math.sqrt((n / span) * YEAR_SECONDS) : null;
}

export function backtest(candles: readonly Candle[], rules: Rules, clock: SessionClock = DEFAULT_CLOCK): Report {
  const entry = evaluate(parse(rules.entry), candles, clock);
  const exit = rules.exit.trim() ? evaluate(parse(rules.exit), candles, clock) : candles.map(() => false);
  const level = rules.entry_stop?.trim() ? values(parse(rules.entry_stop, "num"), candles, clock) : null;
  const trades: Trade[] = [];
  let pos: { t: number; price: number } | null = null;
  let pending = false;
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  const curve: CurvePoint[] = [];

  const close = (t: number, price: number, reason: ExitReason) => {
    const r = price / pos!.price - 1;
    trades.push({ entry_time: pos!.t, entry_price: pos!.price, exit_time: t, exit_price: price, return_pct: r * 100, reason });
    equity *= 1 + r;
    pos = null;
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (pending) {
      if (pos) close(c.t, c.o, "signal");
      else if (!level) pos = { t: c.t, price: c.o };
      else if (c.h >= level[i - 1]) pos = { t: c.t, price: Math.max(c.o, level[i - 1]) };
      pending = false;
    }
    if (pos) {
      const stop = rules.stop_pct != null ? pos.price * (1 - rules.stop_pct / 100) : null;
      const target = rules.target_pct != null ? pos.price * (1 + rules.target_pct / 100) : null;
      if (stop != null && c.l <= stop) close(c.t, Math.min(c.o, stop), "stop");
      else if (target != null && c.h >= target) close(c.t, Math.max(c.o, target), "target");
    }
    if (i < candles.length - 1) pending = pos ? exit[i] : entry[i];
    const marked = pos ? equity * (c.c / pos.price) : equity;
    peak = Math.max(peak, marked);
    drawdown = Math.max(drawdown, 1 - marked / peak);
    curve.push({ t: c.t, equity: marked, drawdown: 1 - marked / peak });
  }

  const last = candles[candles.length - 1];
  if (pos) close(last.t, last.c, "end");
  const returns = trades.map((t) => t.return_pct);
  return {
    trades,
    count: trades.length,
    win_rate: trades.length ? (returns.filter((r) => r > 0).length / trades.length) * 100 : null,
    total_return: (equity - 1) * 100,
    max_drawdown: drawdown * 100,
    buy_hold: candles.length ? (last.c / candles[0].c - 1) * 100 : 0,
    avg_trade: trades.length ? returns.reduce((a, b) => a + b, 0) / trades.length : null,
    profit_factor: profitFactor(returns),
    sharpe: sharpe(curve),
    curve,
  };
}

export function markers(report: Report | null): { t: number; side: "buy" | "sell"; price: number }[] {
  return (report?.trades ?? []).flatMap((t) => [
    { t: t.entry_time, side: "buy" as const, price: t.entry_price },
    { t: t.exit_time, side: "sell" as const, price: t.exit_price },
  ]);
}

export const MAX_RUNS = 400;

export interface Param {
  id: string;
  label: string;
  value: number;
}

export interface Range {
  from: number;
  to: number;
  step: number;
}

export interface SweepRow {
  values: number[];
  total_return: number;
  profit_factor: number | null;
  sharpe: number | null;
  max_drawdown: number;
  win_rate: number | null;
  count: number;
}

const FIELDS = ["entry", "entry_stop", "exit"] as const;
const FIELD_LABEL = { entry: "Entry", entry_stop: "Entry stop", exit: "Exit" };
const NUMBER = /\d+(?:\.\d+)?/g;

export function parameters(rules: Rules): Param[] {
  const out: Param[] = [];
  for (const f of FIELDS) {
    const text = rules[f] ?? "";
    [...text.matchAll(NUMBER)].forEach((m, i) => {
      const at = m.index!;
      out.push({ id: `${f}:${i}`, label: `${FIELD_LABEL[f]}: ${text.slice(Math.max(0, at - 8), at + m[0].length + 1).trim()}`, value: Number(m[0]) });
    });
  }
  if (rules.stop_pct != null) out.push({ id: "stop_pct", label: "Stop-loss %", value: rules.stop_pct });
  if (rules.target_pct != null) out.push({ id: "target_pct", label: "Take-profit %", value: rules.target_pct });
  return out;
}

export function withParam(rules: Rules, id: string, value: number): Rules {
  if (id === "stop_pct" || id === "target_pct") return { ...rules, [id]: value };
  const [field, index] = id.split(":") as [(typeof FIELDS)[number], string];
  let k = 0;
  return { ...rules, [field]: (rules[field] ?? "").replace(NUMBER, (m) => (k++ === Number(index) ? String(value) : m)) };
}

export function steps({ from, to, step }: Range): number[] {
  if (![from, to, step].every(Number.isFinite) || step <= 0 || to < from) return [];
  const n = Math.floor((to - from) / step + 1e-9);
  return Array.from({ length: n + 1 }, (_, i) => Number((from + i * step).toFixed(10)));
}

export function grid(ranges: readonly Range[], max = MAX_RUNS): { points: number[][]; total: number; capped: boolean } {
  const axes = ranges.map(steps);
  const total = axes.length && axes.every((a) => a.length) ? axes.reduce((n, a) => n * a.length, 1) : 0;
  if (total > max) return { points: [], total, capped: true };
  const points = total ? axes.reduce<number[][]>((acc, a) => acc.flatMap((p) => a.map((v) => [...p, v])), [[]]) : [];
  return { points, total, capped: false };
}

export function sweepRow(candles: readonly Candle[], rules: Rules, ids: readonly string[], values: number[], clock: SessionClock = DEFAULT_CLOCK): SweepRow {
  const r = backtest(candles, ids.reduce((acc, id, i) => withParam(acc, id, values[i]), rules), clock);
  return { values, total_return: r.total_return, profit_factor: r.profit_factor, sharpe: r.sharpe, max_drawdown: r.max_drawdown, win_rate: r.win_rate, count: r.count };
}

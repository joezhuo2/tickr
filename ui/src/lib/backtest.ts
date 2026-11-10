import { evaluate, parse } from "./strategy";
import type { Candle } from "./types";

export interface Rules {
  entry: string;
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
}

export function backtest(candles: readonly Candle[], rules: Rules): Report {
  const entry = evaluate(parse(rules.entry), candles);
  const exit = rules.exit.trim() ? evaluate(parse(rules.exit), candles) : candles.map(() => false);
  const trades: Trade[] = [];
  let pos: { t: number; price: number } | null = null;
  let pending = false;
  let equity = 1;
  let peak = 1;
  let drawdown = 0;

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
      else pos = { t: c.t, price: c.o };
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
  };
}

export function markers(report: Report | null): { t: number; side: "buy" | "sell"; price: number }[] {
  return (report?.trades ?? []).flatMap((t) => [
    { t: t.entry_time, side: "buy" as const, price: t.entry_price },
    { t: t.exit_time, side: "sell" as const, price: t.exit_price },
  ]);
}

import type { Candle, OptionContract, Options } from "./types";

export const MIN_UNUSUAL_VOLUME = 100;
const MIN_IV = 0.01;
const DAY = 86400;
const CLOSE_AFTER_OPEN = 6.5 * 3600;

export interface Unusual {
  kind: "call" | "put";
  contract: OptionContract;
  ratio: number | null;
}

export interface StrikeOi {
  strike: number;
  calls: number;
  puts: number;
}

export interface Straddle {
  expiry: number;
  strike: number;
  cost: number;
  pct: number;
}

export interface Move {
  reported: number;
  pct: number;
}

export function isUnusual(c: OptionContract, min = MIN_UNUSUAL_VOLUME): boolean {
  return c.volume != null && c.open_interest != null && c.volume >= min && c.volume > c.open_interest;
}

export function unusualActivity(o: Options, min = MIN_UNUSUAL_VOLUME): Unusual[] {
  const pick = (list: OptionContract[], kind: "call" | "put"): Unusual[] =>
    list.filter((c) => isUnusual(c, min)).map((c) => ({ kind, contract: c, ratio: c.open_interest ? c.volume! / c.open_interest : null }));
  return [...pick(o.calls, "call"), ...pick(o.puts, "put")].sort((a, b) => b.contract.volume! - a.contract.volume!);
}

export function maxPain(o: Options): number | null {
  const strikes = [...new Set([...o.calls, ...o.puts].map((c) => c.strike))].sort((a, b) => a - b);
  if (![...o.calls, ...o.puts].some((c) => (c.open_interest ?? 0) > 0)) return null;
  let best: number | null = null;
  let bestPay = Infinity;
  for (const k of strikes) {
    let pay = 0;
    for (const c of o.calls) pay += Math.max(0, k - c.strike) * (c.open_interest ?? 0);
    for (const p of o.puts) pay += Math.max(0, p.strike - k) * (p.open_interest ?? 0);
    if (pay < bestPay) {
      bestPay = pay;
      best = k;
    }
  }
  return best;
}

export function oiByStrike(o: Options, limit = 40): StrikeOi[] {
  const rows = new Map<number, StrikeOi>();
  const add = (list: OptionContract[], key: "calls" | "puts") => {
    for (const c of list) {
      const row = rows.get(c.strike) ?? { strike: c.strike, calls: 0, puts: 0 };
      row[key] += c.open_interest ?? 0;
      rows.set(c.strike, row);
    }
  };
  add(o.calls, "calls");
  add(o.puts, "puts");
  const p = o.price ?? 0;
  return [...rows.values()]
    .filter((r) => r.calls + r.puts > 0)
    .sort((a, b) => Math.abs(a.strike - p) - Math.abs(b.strike - p))
    .slice(0, limit)
    .sort((a, b) => a.strike - b.strike);
}

export function smile(o: Options): { strike: number; iv: number }[] {
  const p = o.price;
  const out = new Map<number, number>();
  const ok = (c: OptionContract) => c.iv != null && c.iv >= MIN_IV;
  for (const c of o.puts) if (ok(c) && (p == null || c.strike < p)) out.set(c.strike, c.iv!);
  for (const c of o.calls) if (ok(c) && (p == null || c.strike >= p)) out.set(c.strike, c.iv!);
  return [...out].map(([strike, iv]) => ({ strike, iv })).sort((a, b) => a.strike - b.strike);
}

function nearest(list: OptionContract[], price: number): OptionContract | undefined {
  return list.filter((c) => c.iv != null && c.iv >= MIN_IV).sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0];
}

export function atmIv(o: Options): number | null {
  if (o.price == null) return null;
  const ivs = [nearest(o.calls, o.price), nearest(o.puts, o.price)].filter((c): c is OptionContract => !!c).map((c) => c.iv!);
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
}

export function expiryAfter(expirations: number[], date: number): number | null {
  const dayEnd = Math.floor(date / DAY) * DAY + DAY;
  return [...expirations].sort((a, b) => a - b).find((e) => e >= dayEnd) ?? null;
}

function mark(c: OptionContract): number | null {
  if (c.bid != null && c.ask != null && c.bid > 0 && c.ask >= c.bid) return (c.bid + c.ask) / 2;
  return c.last != null && c.last > 0 ? c.last : null;
}

export function straddle(o: Options): Straddle | null {
  if (o.price == null || o.expiry == null) return null;
  const strikes = o.calls.filter((c) => o.puts.some((p) => p.strike === c.strike)).map((c) => c.strike);
  const k = strikes.sort((a, b) => Math.abs(a - o.price!) - Math.abs(b - o.price!))[0];
  if (k == null) return null;
  const call = mark(o.calls.find((c) => c.strike === k)!);
  const put = mark(o.puts.find((c) => c.strike === k)!);
  if (call == null || put == null) return null;
  const cost = call + put;
  return { expiry: o.expiry, strike: k, cost, pct: (cost / o.price) * 100 };
}

export function pastMoves(candles: Candle[], reported: number[]): Move[] {
  const out: Move[] = [];
  for (const t of reported) {
    let i = -1;
    for (let j = 0; j < candles.length && candles[j].t <= t; j++) i = j;
    if (i < 0) continue;
    const after = t >= candles[i].t + CLOSE_AFTER_OPEN;
    const [from, to] = after ? [i, i + 1] : [i - 1, i];
    if (from < 0 || to >= candles.length || candles[from].c <= 0) continue;
    out.push({ reported: t, pct: (candles[to].c / candles[from].c - 1) * 100 });
  }
  return out;
}

export function averageAbs(moves: Move[]): number | null {
  return moves.length ? moves.reduce((s, m) => s + Math.abs(m.pct), 0) / moves.length : null;
}

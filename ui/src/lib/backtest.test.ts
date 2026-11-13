import { describe, expect, it } from "vitest";
import { backtest, grid, markers, parameters, profitFactor, sharpe, steps, sweepRow, withParam, type Rules } from "./backtest";
import type { Candle } from "./types";

const bar = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t, o, h, l, c, v: 1 });
const flat = (t: number, p: number) => bar(t, p, p, p, p);
const rules = (r: Partial<Rules>): Rules => ({ entry: "close > 1000", exit: "", stop_pct: null, target_pct: null, ...r });

describe("fills", () => {
  it("enters and exits at the next bar's open after a signal", () => {
    const candles = [flat(0, 10), bar(1, 11, 12, 10, 12), bar(2, 13, 14, 12, 14), bar(3, 15, 15, 9, 9), bar(4, 8, 9, 7, 8)];
    const r = backtest(candles, rules({ entry: "close >= 12", exit: "close < 10" }));
    expect(r.trades).toEqual([{ entry_time: 2, entry_price: 13, exit_time: 4, exit_price: 8, return_pct: (8 / 13 - 1) * 100, reason: "signal" }]);
  });

  it("ignores an entry signal on the last bar and closes open positions at the last close", () => {
    expect(backtest([flat(0, 10), flat(1, 20)], rules({ entry: "close > 15" })).count).toBe(0);
    const r = backtest([flat(0, 10), flat(1, 11), flat(2, 12)], rules({ entry: "close > 5" }));
    expect(r.trades).toEqual([{ entry_time: 1, entry_price: 11, exit_time: 2, exit_price: 12, return_pct: (12 / 11 - 1) * 100, reason: "end" }]);
  });

  it("stops or takes profit intrabar, stop first when both are hit", () => {
    const open = [flat(0, 100), flat(1, 100)];
    const stop = backtest([...open, bar(2, 100, 103, 94, 100), flat(3, 100)], rules({ entry: "close == 100 and high == 100", stop_pct: 5, target_pct: 10 }));
    expect(stop.trades[0]).toMatchObject({ exit_time: 2, exit_price: 95, reason: "stop" });
    const target = backtest([...open, bar(2, 100, 111, 99, 100)], rules({ entry: "close == 100 and high == 100", stop_pct: 5, target_pct: 10 }));
    expect(target.trades[0]).toMatchObject({ exit_time: 2, reason: "target" });
    expect(target.trades[0].exit_price).toBeCloseTo(110);
    const both = backtest([...open, bar(2, 100, 120, 80, 100)], rules({ entry: "close == 100 and high == 100", stop_pct: 5, target_pct: 10 }));
    expect(both.trades[0]).toMatchObject({ exit_price: 95, reason: "stop" });
  });

  it("fills at the open when a bar gaps through the stop or target", () => {
    const base = [flat(0, 100), flat(1, 100)];
    const gapDown = backtest([...base, bar(2, 90, 91, 88, 90)], rules({ entry: "close == 100", stop_pct: 5 }));
    expect(gapDown.trades[0]).toMatchObject({ exit_price: 90, reason: "stop" });
    const gapUp = backtest([...base, bar(2, 120, 121, 119, 120)], rules({ entry: "close == 100", target_pct: 10 }));
    expect(gapUp.trades[0]).toMatchObject({ exit_price: 120, reason: "target" });
  });

  it("can re-enter after an exit and ignores entries while long", () => {
    const candles = [flat(0, 10), flat(1, 10), flat(2, 20), flat(3, 10), flat(4, 10), flat(5, 30)];
    const r = backtest(candles, rules({ entry: "close == 10", exit: "close > 10" }));
    expect(r.trades.map((t) => [t.entry_time, t.exit_time, t.reason])).toEqual([[1, 3, "signal"], [4, 5, "end"]]);
  });

  it("throws on bad expressions", () => {
    expect(() => backtest([flat(0, 1)], rules({ entry: "close >" }))).toThrow(/position 8/);
    expect(() => backtest([flat(0, 1)], rules({ exit: "nope" }))).toThrow(/Unknown name/);
  });
});

describe("metrics", () => {
  it("compounds trades and compares with buy and hold", () => {
    const oc = (t: number, o: number, c: number) => bar(t, o, Math.max(o, c), Math.min(o, c), c);
    const candles = [oc(0, 100, 99), oc(1, 100, 106), oc(2, 110, 99), oc(3, 100, 106), oc(4, 50, 99), oc(5, 100, 100), oc(6, 110, 120)];
    const r = backtest(candles, rules({ entry: "close < 100", exit: "close > 105" }));
    expect(r.trades.map((t) => [t.entry_price, t.exit_price, t.reason])).toEqual([[100, 110, "signal"], [100, 50, "signal"], [100, 120, "end"]]);
    expect(r.trades.map((t) => t.return_pct)).toEqual([expect.closeTo(10), expect.closeTo(-50), expect.closeTo(20)]);
    expect(r.count).toBe(3);
    expect(r.win_rate).toBeCloseTo(200 / 3);
    expect(r.total_return).toBeCloseTo((1.1 * 0.5 * 1.2 - 1) * 100);
    expect(r.avg_trade).toBeCloseTo((10 - 50 + 20) / 3);
    expect(r.buy_hold).toBeCloseTo((120 / 99 - 1) * 100);
    expect(r.max_drawdown).toBeCloseTo((1 - 0.55 / (1.1 * 1.06)) * 100);
  });

  it("measures drawdown on marked-to-market equity", () => {
    const candles = [flat(0, 100), flat(1, 100), flat(2, 80), flat(3, 120), flat(4, 90)];
    const r = backtest(candles, rules({ entry: "close == 100" }));
    expect(r.total_return).toBeCloseTo(-10);
    expect(r.max_drawdown).toBeCloseTo(25);
  });

  it("reports empty stats without trades", () => {
    const r = backtest([flat(0, 10), flat(1, 12)], rules({}));
    expect(r).toMatchObject({ count: 0, win_rate: null, avg_trade: null, total_return: 0, max_drawdown: 0 });
    expect(r.buy_hold).toBeCloseTo(20);
    expect(markers(r)).toEqual([]);
  });

  it("marks entries as buys and exits as sells", () => {
    const r = backtest([flat(0, 10), flat(1, 11), flat(2, 12)], rules({ entry: "close > 5" }));
    expect(markers(r)).toEqual([{ t: 1, side: "buy", price: 11 }, { t: 2, side: "sell", price: 12 }]);
  });
});

describe("report depth", () => {
  const sweepRules = rules({ entry: "close > sma(2)", exit: "close < ema(3)", stop_pct: 5 });

  it("builds an equity curve with drawdown per bar", () => {
    const r = backtest([flat(0, 100), flat(1, 100), flat(2, 80), flat(3, 120), flat(4, 90)], rules({ entry: "close == 100" }));
    expect(r.curve.map((p) => p.t)).toEqual([0, 1, 2, 3, 4]);
    expect(r.curve.map((p) => p.equity)).toEqual([1, 1, 0.8, 1.2, 0.9]);
    expect(r.curve.map((p) => p.drawdown)).toEqual([0, 0, expect.closeTo(0.2), 0, expect.closeTo(0.25)]);
  });

  it("computes profit factor edge cases", () => {
    expect(profitFactor([])).toBeNull();
    expect(profitFactor([10, -5, 5])).toBe(3);
    expect(profitFactor([4, 6])).toBe(Infinity);
    expect(profitFactor([-4, -6])).toBe(0);
    expect(profitFactor([0])).toBeNull();
    expect(backtest([flat(0, 10), flat(1, 12)], rules({})).profit_factor).toBeNull();
  });

  it("annualizes per-bar Sharpe and returns null with zero variance", () => {
    const day = 86_400;
    const curve = [1, 1.01, 1, 1.02].map((equity, i) => ({ t: i * day, equity, drawdown: 0 }));
    const r = [1.01 - 1, 1 / 1.01 - 1, 1.02 - 1];
    const mean = r.reduce((a, b) => a + b) / 3;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / 2);
    expect(sharpe(curve)).toBeCloseTo((mean / sd) * Math.sqrt(365.25));
    expect(sharpe([1, 1, 1, 1].map((equity, i) => ({ t: i * day, equity, drawdown: 0 })))).toBeNull();
    expect(sharpe(curve.slice(0, 2))).toBeNull();
    expect(backtest([flat(0, 10), flat(1, 12), flat(2, 12)], rules({})).sharpe).toBeNull();
  });

  it("finds and rewrites numeric parameters", () => {
    const p = parameters(sweepRules);
    expect(p.map((x) => [x.id, x.value])).toEqual([["entry:0", 2], ["exit:0", 3], ["stop_pct", 5]]);
    expect(withParam(sweepRules, "entry:0", 7).entry).toBe("close > sma(7)");
    expect(withParam(sweepRules, "exit:0", 9).exit).toBe("close < ema(9)");
    expect(withParam(sweepRules, "stop_pct", 2).stop_pct).toBe(2);
  });

  it("generates grids and caps them", () => {
    expect(steps({ from: 0.1, to: 0.5, step: 0.1 })).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(steps({ from: 5, to: 1, step: 1 })).toEqual([]);
    expect(steps({ from: 1, to: 5, step: 0 })).toEqual([]);
    expect(grid([{ from: 1, to: 2, step: 1 }, { from: 10, to: 30, step: 10 }]).points).toEqual([[1, 10], [1, 20], [1, 30], [2, 10], [2, 20], [2, 30]]);
    expect(grid([{ from: 1, to: 401, step: 1 }])).toMatchObject({ points: [], total: 401, capped: true });
    expect(grid([{ from: 1, to: 400, step: 1 }]).capped).toBe(false);
    expect(grid([{ from: 1, to: 20, step: 1 }, { from: 1, to: 21, step: 1 }]).capped).toBe(true);
    expect(grid([{ from: 3, to: 1, step: 1 }])).toEqual({ points: [], total: 0, capped: false });
  });

  it("runs one sweep row", () => {
    const candles = [10, 11, 12, 11, 10, 11, 13, 12].map((p, i) => flat(i, p));
    const row = sweepRow(candles, sweepRules, ["entry:0"], [3]);
    expect(row.values).toEqual([3]);
    expect(row.total_return).toBeCloseTo(backtest(candles, withParam(sweepRules, "entry:0", 3)).total_return);
  });
});

describe("opening range breakout", () => {
  const OPEN = 34_200;
  const at = (min: number, o: number, h: number, l: number, c: number, day = 0) => ({ t: day * 86_400 + OPEN + min * 60, o, h, l, c, v: 100 });
  const day = [
    at(-5, 50, 60, 40, 50),
    at(0, 100, 102, 99, 101),
    at(5, 101, 104, 100, 103),
    at(10, 103, 103.5, 98, 102),
    at(15, 102, 103, 101, 102.5),
    at(20, 102.5, 106, 102, 105.5),
    at(25, 105.5, 108, 105, 107),
    at(30, 107, 107.5, 106, 106.5),
  ];

  it("exposes time and session terms without looking ahead", async () => {
    const { parse, values, sessionTerms, DEFAULT_CLOCK, clockFor, check } = await import("./strategy");
    expect(values(parse("time", "num"), day)).toEqual([925, 930, 935, 940, 945, 950, 955, 1000]);
    expect(values(parse("or_high(15)", "num"), day)).toEqual([NaN, NaN, NaN, NaN, 104, 104, 104, 104]);
    expect(values(parse("or_low(15)", "num"), day)[7]).toBe(98);
    expect(sessionTerms(day, DEFAULT_CLOCK, "day_high")).toEqual([NaN, NaN, 102, 104, 104, 104, 106, 108]);
    expect(values(parse("vwap", "num"), [at(0, 9, 12, 6, 9), at(5, 9, 12, 6, 12)])).toEqual([9, 9.5]);
    const next = [...day, at(-5, 1, 2, 1, 1, 1), at(0, 110, 111, 109, 110, 1)];
    expect(["prev_high", "prev_low", "prev_close"].map((n) => values(parse(n, "num"), next)[9])).toEqual([108, 98, 106.5]);
    expect(values(parse("prev_high", "num"), day)[7]).toBeNaN();
    expect(values(parse("atr(2)", "num"), [at(0, 10, 12, 8, 10), at(5, 10, 16, 10, 14)])).toEqual([NaN, 5]);
    expect(clockFor({ gmtoffset: -18_000, periods: { regular: { start: 5 * 86_400 + OPEN + 18_000, end: 5 * 86_400 + 57_600 + 18_000 } } })).toEqual({ gmtoffset: -18_000, open: OPEN, close: 57_600 });
    expect(clockFor({ gmtoffset: 0, periods: null })).toEqual({ gmtoffset: 0, open: 0, close: 86_400 });
    expect(check("or_high(15)")).toMatch(/true\/false/);
    expect(check("close > 1", "num")).toMatch(/number/);
    expect(check("or_high(15)", "num")).toBeNull();
  });

  it("fills a stop entry where the bar breaks the level", () => {
    const r = backtest(day, { entry: "time >= 945 and time < 1100", entry_stop: "or_high(15)", exit: "time >= 955", stop_pct: null, target_pct: null });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ entry_time: day[5].t, entry_price: 104, exit_time: day[7].t, exit_price: 107, reason: "signal" });
    const gap = backtest([...day.slice(0, 5), at(20, 105, 106, 104.5, 105.5)], { entry: "time >= 945", entry_stop: "or_high(15)", exit: "", stop_pct: null, target_pct: null });
    expect(gap.trades[0].entry_price).toBe(105);
    expect(backtest(day.slice(0, 5), { entry: "time >= 930", entry_stop: "or_high(15)", exit: "", stop_pct: null, target_pct: null }).count).toBe(0);
    expect(() => backtest(day, { entry: "close > 1", entry_stop: "close > 1", exit: "", stop_pct: null, target_pct: null })).toThrow();
  });
});

it("labels a sweep parameter by the call it sits in", () => {
  const labels = parameters({ entry: "crosses_above(ema(20), sma(50)) and close > 5", exit: "rsi(14) > 70" } as Parameters<typeof parameters>[0]).map((p) => p.label);
  expect(labels).toEqual(["Entry: ema(20)", "Entry: sma(50)", "Entry: 5", "Exit: rsi(14)", "Exit: 70"]);
});

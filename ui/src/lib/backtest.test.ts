import { describe, expect, it } from "vitest";
import { backtest, markers, type Rules } from "./backtest";
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

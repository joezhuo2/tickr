import { describe, expect, it } from "vitest";
import { CAP, DELAY, cadence, dueGroups, groups, inBackground, nextCheck, stagger, triggered } from "./chartAlertSchedule";
import { claim, type ChartAlert } from "./chartAlerts";
import type { Candle } from "./types";

const closes = (...values: number[]): Candle[] => values.map((c, i) => ({ t: i * 60, o: c, h: c, l: c, c, v: 1 }));
const alert = (over: Partial<ChartAlert>): ChartAlert => ({ id: 1, symbol: "AAPL", interval: "5m", label: "x", expr: null, line: null, enabled: true, fired_at: null, ...over });
const cross = "crosses_above(close, sma(2))";

describe("background chart alert schedule", () => {
  it("checks once per bar, at least every minute and at most every 15 minutes", () => {
    expect(["1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"].map(cadence)).toEqual([60, 300, 900, 900, 900, 900, 900, 900]);
    expect(cadence("2h")).toBeNull();
    expect(inBackground({ interval: "1d" })).toBe(true);
    expect(inBackground({ interval: "constructor" })).toBe(false);
  });

  it("schedules the next check just after the next bar boundary, staggered per group", () => {
    const g = { key: "AAPL|5m", interval: "5m" };
    const offset = DELAY + stagger(g.key);
    expect(nextCheck(g, 600)).toBe(900 + offset);
    expect(nextCheck(g, 899)).toBe(900 + offset);
    expect(nextCheck({ key: "AAPL|1d", interval: "1d" }, 0)).toBe(CAP + DELAY + stagger("AAPL|1d"));
    expect(stagger("AAPL|5m")).toBeLessThan(30);
  });

  it("groups armed alerts by symbol and interval and skips paused or unsupported ones", () => {
    const list = [
      alert({ id: 1 }),
      alert({ id: 2, expr: cross }),
      alert({ id: 3, symbol: "MSFT" }),
      alert({ id: 4, interval: "1d" }),
      alert({ id: 5, symbol: "TSLA", enabled: false }),
      alert({ id: 6, interval: "2h" }),
    ];
    expect(groups(list).map((g) => [g.key, g.range])).toEqual([["AAPL|5m", "5d"], ["MSFT|5m", "5d"], ["AAPL|1d", "1y"]]);
  });

  it("returns groups never checked or past their next check", () => {
    const all = groups([alert({ id: 1 }), alert({ id: 2, symbol: "MSFT" })]);
    const checked = new Map([["AAPL|5m", 600]]);
    const at = nextCheck(all[0], 600);
    expect(dueGroups(all, checked, at - 1).map((g) => g.key)).toEqual(["MSFT|5m"]);
    expect(dueGroups(all, checked, at).map((g) => g.key)).toEqual(["AAPL|5m", "MSFT|5m"]);
  });

  it("fires on the forming bar, and on a bar that closed since the last check", () => {
    const list = [alert({ id: 1, expr: cross })];
    expect(triggered(list, "aapl", "5m", closes(10, 10, 10, 12), undefined, null).map((a) => a.id)).toEqual([1]);
    const closedCross = closes(10, 10, 10, 12, 13);
    expect(triggered(list, "AAPL", "5m", closedCross, undefined, null)).toEqual([]);
    expect(triggered(list, "AAPL", "5m", closedCross, undefined, 200).map((a) => a.id)).toEqual([1]);
    expect(triggered(list, "AAPL", "5m", closedCross, undefined, 240)).toEqual([]);
    expect(triggered(list, "AAPL", "1d", closes(10, 10, 10, 12), undefined, null)).toEqual([]);
  });

  it("fires each alert once even when two checkers see the same bar", () => {
    const candles = closes(10, 10, 10, 12);
    let list = [alert({ id: 1, expr: cross }), alert({ id: 2, expr: cross, symbol: "MSFT" })];
    const first = triggered(list, "AAPL", "5m", candles, undefined, null);
    const r = claim(list, new Set(first.map((a) => a.id)), 1000);
    expect(r.claimed.map((a) => a.id)).toEqual([1]);
    list = r.list;
    expect(claim(list, new Set([1]), 1001).claimed).toEqual([]);
    expect(list[0]).toMatchObject({ enabled: false, fired_at: 1000 });
    expect(list[1]).toMatchObject({ enabled: true, fired_at: null });
    expect(triggered(list, "AAPL", "5m", candles, undefined, 0)).toEqual([]);
    expect(groups(list).map((g) => g.key)).toEqual(["MSFT|5m"]);
  });
});

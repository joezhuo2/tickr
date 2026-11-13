import { describe, expect, it } from "vitest";
import { MAX_CHART_ALERTS, PRESETS, addError, claim, due, holds, lineBroken, lineValue, type ChartAlert } from "./chartAlerts";
import type { Candle } from "./types";

const closes = (...values: number[]): Candle[] => values.map((c, i) => ({ t: i * 60, o: c, h: c, l: c, c, v: 1 }));
const alert = (over: Partial<ChartAlert>): ChartAlert => ({ id: 1, symbol: "AAPL", interval: "5m", label: "x", expr: null, line: null, enabled: true, fired_at: null, ...over });

describe("chart alerts", () => {
  it("accepts the study functions in indicator alerts", () => {
    expect(addError([], "crosses_above(roc(1), 5)")).toBeNull();
    expect(holds({ expr: "crosses_above(roc(1), 5)", line: null }, closes(100, 101, 110))).toBe(true);
    expect(holds({ expr: "willr(2) > -50", line: null }, closes(100, 90))).toBe(false);
  });

  it("extends a line in bar space", () => {
    const times = [0, 60, 120, 180];
    const line = { a: { t: 0, price: 10 }, b: { t: 60, price: 12 } };
    expect(lineValue(line, times, 3)).toBe(16);
    expect(lineValue({ a: line.a, b: { t: 0, price: 12 } }, times, 3)).toBeNull();
  });

  it("fires a trendline break only on the bar that closes through it", () => {
    const flat = { a: { t: 0, price: 10 }, b: { t: 60, price: 10 } };
    expect(lineBroken({ ...flat, direction: "above" }, closes(9, 9, 11))).toBe(true);
    expect(lineBroken({ ...flat, direction: "above" }, closes(9, 11, 12))).toBe(false);
    expect(lineBroken({ ...flat, direction: "below" }, closes(11, 11, 9))).toBe(true);
    expect(lineBroken({ ...flat, direction: "below" }, closes(11))).toBe(false);
  });

  it("measures a line to a future anchor in trading bars, skipping the weekend", () => {
    const mon = Date.UTC(2026, 5, 1, 13, 30) / 1000;
    const week = [10, 11, 12, 12.9, 14.5].map((c, i) => ({ t: mon + i * 86_400, o: c, h: c, l: c, c, v: 1 }));
    const line = { a: { t: mon, price: 10 }, b: { t: mon + 9 * 86_400, price: 17 }, direction: "above" as const };
    const clock = { gmtoffset: -14_400, open: 34_200, close: 57_600 };
    expect(lineBroken(line, week, "1d", clock)).toBe(true);
    expect(lineBroken(line, week)).toBe(false);
    expect(due([alert({ interval: "1d", line })], "aapl", "1d", week, clock)).toHaveLength(1);
  });

  it("evaluates an expression on the latest bar", () => {
    const cross = "crosses_above(close, sma(2))";
    expect(holds(alert({ expr: cross }), closes(10, 10, 10, 12))).toBe(true);
    expect(holds(alert({ expr: cross }), closes(10, 10, 12, 13))).toBe(false);
    expect(holds(alert({ expr: "close >" }), closes(1, 2, 3))).toBe(false);
  });

  it("returns only armed alerts for the symbol and interval on screen", () => {
    const c = closes(10, 10, 10, 12);
    const expr = "crosses_above(close, sma(2))";
    const list = [alert({ id: 1, expr }), alert({ id: 2, expr, enabled: false }), alert({ id: 3, expr, symbol: "MSFT" }), alert({ id: 4, expr, interval: "1d" })];
    expect(due(list, "aapl", "5m", c).map((a) => a.id)).toEqual([1]);
  });

  it("validates new alerts and ships parseable presets", () => {
    expect(addError([], "close > ")).not.toBeNull();
    expect(addError([], " ")).toBe("Enter a condition");
    expect(addError([], null)).toBeNull();
    expect(addError(Array.from({ length: MAX_CHART_ALERTS }, (_, id) => alert({ id })), null)).not.toBeNull();
    for (const p of PRESETS) expect(addError([], p.expr)).toBeNull();
  });
  it("claims only alerts still armed in storage, so a second window does not fire again", () => {
    const stored = [alert({ id: 1 }), alert({ id: 2, enabled: false, fired_at: 5 }), alert({ id: 3 })];
    const { list, claimed } = claim(stored, new Set([1, 2]), 9);
    expect(claimed.map((a) => a.id)).toEqual([1]);
    expect(list.map((a) => [a.id, a.enabled, a.fired_at])).toEqual([[1, false, 9], [2, false, 5], [3, true, null]]);
    expect(claim(list, new Set([1]), 10).claimed).toEqual([]);
  });
});

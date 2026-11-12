import { describe, expect, it } from "vitest";
import { MAX_CHART_ALERTS, PRESETS, addError, due, holds, lineBroken, lineValue, type ChartAlert } from "./chartAlerts";
import type { Candle } from "./types";

const closes = (...values: number[]): Candle[] => values.map((c, i) => ({ t: i * 60, o: c, h: c, l: c, c, v: 1 }));
const alert = (over: Partial<ChartAlert>): ChartAlert => ({ id: 1, symbol: "AAPL", interval: "5m", label: "x", expr: null, line: null, enabled: true, fired_at: null, ...over });

describe("chart alerts", () => {
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
});

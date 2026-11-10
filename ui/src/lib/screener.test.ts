import { describe, expect, it } from "vitest";
import {
  canSave,
  findScreen,
  matchesRule,
  newRule,
  ruleLabel,
  ruleValid,
  sameRules,
  screenRows,
  smaOf,
} from "./screener";
import type { ScreenRow, ScreenRule } from "./types";

function row(symbol: string, over: Partial<ScreenRow> = {}): ScreenRow {
  return { symbol, price: 100, change_pct: 1, rsi: 50, sma20: 95, sma50: 90, sma200: 80, score: null, bias: null, error: null, ...over };
}

const rule = (kind: ScreenRule["kind"], op: ScreenRule["op"], value: number): ScreenRule => ({ kind, op, value });

describe("matchesRule", () => {
  it("compares RSI strictly above or below the value", () => {
    expect(matchesRule(row("A", { rsi: 71 }), rule("rsi", "above", 70))).toBe(true);
    expect(matchesRule(row("A", { rsi: 70 }), rule("rsi", "above", 70))).toBe(false);
    expect(matchesRule(row("A", { rsi: 29 }), rule("rsi", "below", 30))).toBe(true);
    expect(matchesRule(row("A", { rsi: 30 }), rule("rsi", "below", 30))).toBe(false);
  });
  it("compares price with the chosen moving average", () => {
    const r = row("A", { price: 100, sma20: 105, sma50: 100, sma200: 90 });
    expect(matchesRule(r, rule("sma", "below", 20))).toBe(true);
    expect(matchesRule(r, rule("sma", "above", 20))).toBe(false);
    expect(matchesRule(r, rule("sma", "above", 50))).toBe(false);
    expect(matchesRule(r, rule("sma", "below", 50))).toBe(false);
    expect(matchesRule(r, rule("sma", "above", 200))).toBe(true);
  });
  it("compares percent change, including negative thresholds", () => {
    expect(matchesRule(row("A", { change_pct: 3.2 }), rule("change", "above", 3))).toBe(true);
    expect(matchesRule(row("A", { change_pct: -4 }), rule("change", "below", -3))).toBe(true);
    expect(matchesRule(row("A", { change_pct: -2 }), rule("change", "below", -3))).toBe(false);
    expect(matchesRule(row("A", { change_pct: 0 }), rule("change", "above", 0))).toBe(false);
  });
  it("never matches when the needed value is unknown", () => {
    expect(matchesRule(row("A", { rsi: null }), rule("rsi", "below", 100))).toBe(false);
    expect(matchesRule(row("A", { change_pct: null }), rule("change", "below", 100))).toBe(false);
    expect(matchesRule(row("A", { price: null }), rule("sma", "above", 20))).toBe(false);
    expect(matchesRule(row("A", { sma200: null }), rule("sma", "above", 200))).toBe(false);
    expect(matchesRule(row("A", { sma200: null }), rule("sma", "below", 200))).toBe(false);
    expect(matchesRule(row("A", { rsi: NaN }), rule("rsi", "below", 100))).toBe(false);
  });
  it("never matches an invalid rule", () => {
    expect(matchesRule(row("A"), rule("sma", "above", 100))).toBe(false);
    expect(matchesRule(row("A"), rule("rsi", "above", NaN))).toBe(false);
  });
});

describe("screenRows", () => {
  const rows = [
    row("OVERSOLD", { rsi: 25, price: 80, sma50: 90, sma200: 85 }),
    row("STRONG", { rsi: 75, price: 120, sma50: 100, sma200: 90, change_pct: 4 }),
    row("MID", { rsi: 50 }),
    row("NEW", { rsi: 20, sma200: null }),
    row("BROKEN", { rsi: 10, error: "HTTP 404" }),
  ];
  it("keeps rows that satisfy every rule, in order", () => {
    const got = screenRows(rows, [rule("rsi", "below", 30), rule("sma", "below", 50)]);
    expect(got.map((r) => r.symbol)).toEqual(["OVERSOLD"]);
    expect(screenRows(rows, [rule("rsi", "above", 40)]).map((r) => r.symbol)).toEqual(["STRONG", "MID"]);
    expect(screenRows(rows, [rule("sma", "above", 200), rule("change", "above", 2)]).map((r) => r.symbol)).toEqual(["STRONG"]);
  });
  it("drops symbols whose history could not be loaded", () => {
    expect(screenRows(rows, [rule("rsi", "below", 30)]).map((r) => r.symbol)).toEqual(["OVERSOLD", "NEW"]);
    expect(screenRows(rows, []).map((r) => r.symbol)).toEqual(["OVERSOLD", "STRONG", "MID", "NEW"]);
  });
  it("ignores rules that are not valid yet", () => {
    expect(screenRows(rows, [rule("rsi", "below", NaN), rule("rsi", "above", 70)]).map((r) => r.symbol)).toEqual(["STRONG"]);
  });
  it("does not modify its input", () => {
    const copy = [...rows];
    screenRows(rows, [rule("rsi", "below", 30)]);
    expect(rows).toEqual(copy);
  });
});

describe("rules", () => {
  it("validates by kind", () => {
    expect(ruleValid(rule("rsi", "above", 0))).toBe(true);
    expect(ruleValid(rule("rsi", "above", 100))).toBe(true);
    expect(ruleValid(rule("rsi", "above", 101))).toBe(false);
    expect(ruleValid(rule("rsi", "above", -1))).toBe(false);
    expect(ruleValid(rule("sma", "above", 50))).toBe(true);
    expect(ruleValid(rule("sma", "above", 30))).toBe(false);
    expect(ruleValid(rule("change", "below", -12.5))).toBe(true);
    expect(ruleValid(rule("change", "below", Infinity))).toBe(false);
  });
  it("starts every kind with a valid default", () => {
    for (const kind of ["rsi", "sma", "change"] as const) expect(ruleValid(newRule(kind))).toBe(true);
    expect(newRule("rsi").op).toBe("below");
    expect(newRule("sma", "below").op).toBe("below");
  });
  it("describes a rule", () => {
    expect(ruleLabel(rule("rsi", "below", 30))).toBe("RSI 14 below 30");
    expect(ruleLabel(rule("sma", "above", 200))).toBe("Price above SMA 200");
    expect(ruleLabel(rule("change", "below", -2.5))).toBe("Change below -2.5%");
  });
  it("compares rule lists", () => {
    const a = [rule("rsi", "below", 30)];
    expect(sameRules(a, [rule("rsi", "below", 30)])).toBe(true);
    expect(sameRules(a, [rule("rsi", "below", 31)])).toBe(false);
    expect(sameRules(a, [rule("rsi", "above", 30)])).toBe(false);
    expect(sameRules(a, [])).toBe(false);
  });
  it("reads a moving average from a row", () => {
    expect(smaOf(row("A"), 20)).toBe(95);
    expect(smaOf(row("A"), 200)).toBe(80);
    expect(smaOf(row("A"), 10)).toBeNull();
  });
});

describe("saving", () => {
  const ok = [rule("rsi", "below", 30)];
  it("needs a name and at least one valid rule", () => {
    expect(canSave("Oversold", ok)).toBe(true);
    expect(canSave("   ", ok)).toBe(false);
    expect(canSave("x".repeat(41), ok)).toBe(false);
    expect(canSave("x".repeat(40), ok)).toBe(true);
    expect(canSave("Oversold", [])).toBe(false);
    expect(canSave("Oversold", [rule("rsi", "below", NaN)])).toBe(false);
    expect(canSave("Oversold", Array(11).fill(ok[0]))).toBe(false);
  });
  it("finds a saved filter by name, ignoring case and padding", () => {
    const screens = [{ name: "Oversold", rules: ok }];
    expect(findScreen(screens, "  oversold ")).toBe(screens[0]);
    expect(findScreen(screens, "other")).toBeUndefined();
  });
});

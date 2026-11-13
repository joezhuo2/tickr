import { describe, expect, it } from "vitest";
import {
  canSave,
  cleanColumns,
  fieldOf,
  findScreen,
  formatField,
  matchesRule,
  mergeItems,
  migrateRule,
  needsFundamentals,
  newRule,
  ruleLabel,
  ruleValid,
  sameRules,
  screenRows,
  smaOf,
  sortItems,
} from "./screener";
import type { ScreenFundamentals, ScreenItem, ScreenRow, ScreenRule } from "./types";

function row(symbol: string, over: Partial<ScreenItem> = {}): ScreenItem {
  return {
    symbol,
    price: 100,
    change_pct: 1,
    rsi: 50,
    sma20: 95,
    sma50: 90,
    sma200: 80,
    perf_1w: null,
    perf_1m: null,
    perf_3m: null,
    perf_6m: null,
    perf_ytd: null,
    perf_1y: null,
    volume: null,
    rel_volume: null,
    from_high_52w: null,
    from_low_52w: null,
    atr_pct: null,
    macd_hist: null,
    gap_pct: null,
    score: null,
    bias: null,
    error: null,
    ...over,
  };
}

const rule = (kind: ScreenRule["kind"], op: ScreenRule["op"], value: number, extra: Partial<ScreenRule> = {}): ScreenRule => ({ kind, op, value, ...extra });

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

describe("new fields and operators", () => {
  it("matches between inclusively, in either order", () => {
    const r = row("A", { perf_1m: 5 });
    expect(matchesRule(r, rule("perf_1m", "between", 5, { value2: 10 }))).toBe(true);
    expect(matchesRule(r, rule("perf_1m", "between", 10, { value2: 5 }))).toBe(true);
    expect(matchesRule(r, rule("perf_1m", "between", 5.1, { value2: 10 }))).toBe(false);
    expect(ruleValid(rule("perf_1m", "between", 5))).toBe(false);
  });
  it("never matches a missing value, including between", () => {
    expect(matchesRule(row("A", { perf_1w: null }), rule("perf_1w", "above", -1000))).toBe(false);
    expect(matchesRule(row("A", { perf_1w: null }), rule("perf_1w", "between", -1000, { value2: 1000 }))).toBe(false);
    expect(matchesRule(row("A"), rule("pe", "below", 1000))).toBe(false);
    expect(matchesRule(row("A", { sector: null }), rule("sector", "any", 0, { values: ["Energy"] }))).toBe(false);
  });
  it("scales market cap to billions and volume to millions", () => {
    const r = row("A", { market_cap: 5e11, volume: 2_500_000 });
    expect(matchesRule(r, rule("market_cap", "above", 100))).toBe(true);
    expect(matchesRule(r, rule("market_cap", "above", 600))).toBe(false);
    expect(matchesRule(r, rule("volume", "between", 2, { value2: 3 }))).toBe(true);
  });
  it("computes price versus a moving average in percent", () => {
    const r = row("A", { price: 110, sma50: 100 });
    expect(matchesRule(r, rule("vs_sma50", "above", 9.9))).toBe(true);
    expect(matchesRule(r, rule("vs_sma50", "above", 10.1))).toBe(false);
    expect(matchesRule(row("A", { sma200: null }), rule("vs_sma200", "below", 100))).toBe(false);
  });
  it("matches a sector with is and any-of, ignoring case", () => {
    const r = row("A", { sector: "Technology" });
    expect(matchesRule(r, rule("sector", "is", 0, { values: ["technology"] }))).toBe(true);
    expect(matchesRule(r, rule("sector", "is", 0, { values: ["Energy"] }))).toBe(false);
    expect(matchesRule(r, rule("sector", "any", 0, { values: ["Energy", "Technology"] }))).toBe(true);
    expect(matchesRule(r, rule("sector", "any", 0, { values: ["Energy", "Utilities"] }))).toBe(false);
  });
  it("validates sector and numeric operators", () => {
    expect(ruleValid(rule("sector", "is", 0, { values: [] }))).toBe(false);
    expect(ruleValid(rule("sector", "is", 0, { values: ["A", "B"] }))).toBe(false);
    expect(ruleValid(rule("sector", "any", 0, { values: ["A", "B"] }))).toBe(true);
    expect(ruleValid(rule("sector", "above", 0, { values: ["A"] }))).toBe(false);
    expect(ruleValid(rule("pe", "is", 0, { values: ["A"] }))).toBe(false);
    expect(ruleValid(rule("nope", "above", 1))).toBe(false);
    expect(ruleValid(rule("rsi", "between", 20, { value2: 120 }))).toBe(false);
  });
  it("migrates the old moving-average rule and keeps it equal to its saved form", () => {
    expect(migrateRule(rule("sma", "below", 200))).toEqual(rule("vs_sma200", "below", 0));
    expect(migrateRule(rule("rsi", "below", 30))).toEqual(rule("rsi", "below", 30));
    expect(sameRules([rule("sma", "above", 50)], [rule("vs_sma50", "above", 0)])).toBe(true);
    expect(sameRules([rule("sector", "any", 0, { values: ["A"] })], [rule("sector", "any", 0, { values: ["B"] })])).toBe(false);
  });
  it("starts every field with a valid default except text lists", () => {
    for (const k of ["pe", "perf_ytd", "from_high_52w", "rel_volume", "macd_hist"]) expect(ruleValid(newRule(k))).toBe(true);
    expect(newRule("sector").op).toBe("is");
    expect(ruleValid(newRule("sector"))).toBe(false);
  });
  it("describes the new rules", () => {
    expect(ruleLabel(rule("pe", "between", 5, { value2: 15 }))).toBe("P/E between 5 and 15");
    expect(ruleLabel(rule("sector", "any", 0, { values: ["Energy", "Utilities"] }))).toBe("Sector is any of Energy, Utilities");
  });
});

describe("sortItems", () => {
  const items = [row("B", { pe: 20 }), row("A", { pe: null }), row("C", { pe: 5 }), row("D", { pe: 30 })];
  it("sorts numbers both ways with missing values last", () => {
    expect(sortItems(items, "pe", "asc").map((r) => r.symbol)).toEqual(["C", "B", "D", "A"]);
    expect(sortItems(items, "pe", "desc").map((r) => r.symbol)).toEqual(["D", "B", "C", "A"]);
  });
  it("sorts text and symbols, missing last", () => {
    const s = [row("A", { sector: "Technology" }), row("B", { sector: null }), row("C", { sector: "Energy" })];
    expect(sortItems(s, "sector", "asc").map((r) => r.symbol)).toEqual(["C", "A", "B"]);
    expect(sortItems(s, "sector", "desc").map((r) => r.symbol)).toEqual(["A", "C", "B"]);
    expect(sortItems(s, "symbol", "desc").map((r) => r.symbol)).toEqual(["C", "B", "A"]);
  });
  it("keeps order without a key and does not modify its input", () => {
    expect(sortItems(items, null, "asc")).toBe(items);
    const copy = [...items];
    sortItems(items, "pe", "asc");
    expect(items).toEqual(copy);
  });
});

describe("columns and data", () => {
  it("drops unknown columns and falls back to the defaults", () => {
    expect(cleanColumns(["pe", "pe", "bogus", "rsi"])).toEqual(["pe", "rsi"]);
    expect(cleanColumns([])).toEqual(["price", "change", "rsi"]);
    expect(cleanColumns(undefined)).toEqual(["price", "change", "rsi"]);
  });
  it("asks for fundamentals only when a column or rule needs them", () => {
    expect(needsFundamentals(["price", "rsi"], [rule("rsi", "below", 30)])).toBe(false);
    expect(needsFundamentals(["pe"], [])).toBe(true);
    expect(needsFundamentals(["price"], [rule("beta", "above", 1)])).toBe(true);
  });
  it("merges fundamentals into rows and formats fields", () => {
    const f: ScreenFundamentals = { symbol: "A", market_cap: 2.5e12, pe: 30.123, eps: 5, dividend_yield: 0.5, revenue_growth: -3, profit_margin: 20, beta: 1.1, sector: "Energy", error: null };
    const [item, bare] = mergeItems([row("A") as ScreenRow, row("B") as ScreenRow], new Map([["A", f]]));
    expect(item.sector).toBe("Energy");
    expect(bare.pe).toBeUndefined();
    expect(formatField(fieldOf("market_cap")!, item)).toBe("2,500.0B");
    expect(formatField(fieldOf("revenue_growth")!, item)).toBe("−3.0%");
    expect(formatField(fieldOf("sector")!, item)).toBe("Energy");
    expect(formatField(fieldOf("pe")!, bare)).toBe("—");
  });
});

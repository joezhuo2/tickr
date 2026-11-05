import { describe, expect, it } from "vitest";
import { byGain } from "./format";
import { DEFAULT_WATCHLIST_SORT, nextSort, sortSymbols } from "./watchlistSort";

const rows: Record<string, { price?: number; change?: number | null; volume?: number | null }> = {
  A: { price: 10, change: 1.5, volume: 500 },
  B: { price: 300, change: -2, volume: 100 },
  C: { price: 50, change: null, volume: null },
  D: { price: 50, change: 4, volume: 900 },
  E: { price: 1, change: 0, volume: 100 },
};
const value = (s: string, key: "price" | "change" | "volume") => rows[s][key];
const symbols = ["A", "B", "C", "D", "E"];

describe("sortSymbols", () => {
  it("sorts descending and ascending by each key", () => {
    expect(sortSymbols(symbols, value, { key: "price", dir: "desc" })).toEqual(["B", "C", "D", "A", "E"]);
    expect(sortSymbols(symbols, value, { key: "price", dir: "asc" })).toEqual(["E", "A", "C", "D", "B"]);
    expect(sortSymbols(symbols, value, { key: "volume", dir: "desc" })).toEqual(["D", "A", "B", "E", "C"]);
    expect(sortSymbols(symbols, value, { key: "change", dir: "asc" })).toEqual(["B", "E", "A", "D", "C"]);
  });
  it("keeps unknown values last in both directions", () => {
    expect(sortSymbols(symbols, value, { key: "change", dir: "desc" }).at(-1)).toBe("C");
    expect(sortSymbols(symbols, value, { key: "change", dir: "asc" }).at(-1)).toBe("C");
    expect(sortSymbols(["X", "A"], (s, k) => (s === "X" ? undefined : value(s, k)), { key: "price", dir: "asc" })).toEqual(["A", "X"]);
    expect(sortSymbols(["X", "A"], (s) => (s === "X" ? NaN : 1), { key: "price", dir: "desc" })).toEqual(["A", "X"]);
  });
  it("breaks ties by original order", () => {
    expect(sortSymbols(["E", "B"], value, { key: "volume", dir: "desc" })).toEqual(["E", "B"]);
    expect(sortSymbols(["B", "E"], value, { key: "volume", dir: "asc" })).toEqual(["B", "E"]);
  });
  it("does not modify the input", () => {
    const input = ["B", "A"];
    sortSymbols(input, value, { key: "price", dir: "asc" });
    expect(input).toEqual(["B", "A"]);
  });
  it("matches the biggest-gain-first order by default", () => {
    const pct = (s: string) => rows[s].change;
    expect(sortSymbols(symbols, value, DEFAULT_WATCHLIST_SORT)).toEqual(byGain(symbols, pct));
  });
});

describe("nextSort", () => {
  it("starts a new key descending", () => {
    expect(nextSort({ key: "change", dir: "asc" }, "volume")).toEqual({ key: "volume", dir: "desc" });
  });
  it("flips the direction of the active key", () => {
    const once = nextSort({ key: "price", dir: "desc" }, "price");
    expect(once).toEqual({ key: "price", dir: "asc" });
    expect(nextSort(once, "price")).toEqual({ key: "price", dir: "desc" });
  });
});

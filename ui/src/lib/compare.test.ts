import { describe, expect, it } from "vitest";
import { alignCloses, cleanCompare, rebase } from "./compare";
import type { Candle } from "./types";

const bar = (t: number, c: number): Candle => ({ t, o: c, h: c, l: c, c, v: 0 });

describe("compare", () => {
  it("cleans symbols", () => {
    expect(cleanCompare(["spy", " SPY ", "qqq", 5, "", "bad symbol", "a", "b", "c", "d", "e", "f", "g"])).toEqual(["SPY", "QQQ", "A", "B", "C", "D", "E", "F"]);
    expect(cleanCompare(null)).toEqual([]);
  });

  it("aligns the latest close at or before each time", () => {
    expect(alignCloses([1, 2, 3, 5], [bar(2, 20), bar(4, 40)])).toEqual([null, 20, 20, 40]);
  });

  it("rebases to the first visible value", () => {
    const r = rebase([10, 20, null, 30, 40], 1, 3, 100);
    expect(r.first).toBe(20);
    expect(r.values).toEqual([50, 100, null, 150, 200]);
  });

  it("skips leading gaps when rebasing", () => {
    expect(rebase([null, null, 5, 10], 0, 3, 50).values).toEqual([null, null, 50, 100]);
  });
});

import { describe, expect, it } from "vitest";
import type { SavedRun } from "./practice";
import { breakdown, computeStats, filterRows, parseTags, tradeRows } from "./practiceStats";

const candles = Array.from({ length: 40 }, (_, i) => ({ t: 1000 + i * 86400, o: 100, h: 101, l: 99, c: 100, v: 1 }));

function run(id: number, pct: number, extra: Partial<SavedRun> = {}): SavedRun {
  return {
    id,
    saved: id,
    symbol: "AAA",
    name: "",
    exchange: "",
    currency: "USD",
    timezone: "",
    gmtoffset: 0,
    interval: "1d",
    range: "1y",
    start: 20,
    volatile: false,
    trade: { decision: "long", decided: 20, exit: 30, cancelled: false },
    return_pct: pct,
    market_pct: null,
    candles,
    drawings: [],
    note: "",
    tags: [],
    ...extra,
  };
}

const stats = (...pcts: number[]) => computeStats(tradeRows(pcts.map((p, i) => run(i + 1, p))));

describe("practice stats", () => {
  it("handles no trades", () => {
    const s = computeStats([]);
    expect(s).toMatchObject({ trades: 0, winRate: null, avgR: null, expectancy: null, profitFactor: null, longestWin: 0, longestLoss: 0, current: null });
  });

  it("skips skipped, unfilled and open runs", () => {
    const rows = tradeRows([
      run(1, 0, { trade: { decision: "skip", decided: 20, exit: null, cancelled: false } }),
      run(2, 0, { trade: { decision: "long", decided: 20, exit: null, cancelled: true } }),
      run(3, 0, { trade: { decision: "long", decided: 20, exit: null, cancelled: false } }),
      run(4, 2),
    ]);
    expect(rows.map((r) => r.id)).toEqual([4]);
  });

  it("measures R in decision-bar ATR units", () => {
    const [row] = tradeRows([run(1, 4)]);
    expect(row.r).toBeCloseTo(2);
    expect(row.entry).toBeGreaterThan(0);
  });

  it("keeps trades without an ATR out of R stats but still counts them", () => {
    const s = computeStats(tradeRows([run(1, 2, { trade: { decision: "long", decided: 5, exit: 10, cancelled: false } }), run(2, -2)]));
    expect(s.trades).toBe(2);
    expect(s.winRate).toBe(0.5);
    expect(s.avgR).toBeCloseTo(-1);
  });

  it("all wins has infinite profit factor and no loss streak", () => {
    const s = stats(2, 4);
    expect(s).toMatchObject({ winRate: 1, profitFactor: Infinity, longestWin: 2, longestLoss: 0 });
    expect(s.avgR).toBeCloseTo(1.5);
    expect(s.expectancy).toBeCloseTo(1.5);
  });

  it("all losses has zero profit factor", () => {
    const s = stats(-2, -4);
    expect(s).toMatchObject({ winRate: 0, profitFactor: 0, longestLoss: 2, longestWin: 0 });
    expect(s.expectancy).toBeCloseTo(-1.5);
  });

  it("computes mixed profit factor, expectancy and streaks", () => {
    const s = stats(2, 2, -1, 0, 4, -2, -2);
    expect(s.profitFactor).toBeCloseTo(8 / 5);
    expect(s).toMatchObject({ trades: 7, wins: 3, longestWin: 2, longestLoss: 2, current: { outcome: "loss", length: 2 } });
    expect(s.avgR).toBeCloseTo(3 / 7 / 2);
    expect(s.expectancy).toBeCloseTo(s.avgR!);
  });

  it("zero-only trades have no profit factor", () => {
    expect(stats(0).profitFactor).toBeNull();
  });

  it("orders streaks by saved time", () => {
    const rows = tradeRows([run(3, -1, { saved: 3 }), run(1, 1, { saved: 1 }), run(2, 1, { saved: 2 })]);
    expect(computeStats(rows).current).toEqual({ outcome: "loss", length: 1 });
    expect(computeStats(rows).longestWin).toBe(2);
  });

  it("breaks down by symbol and tag", () => {
    const rows = tradeRows([run(1, 2, { tags: ["breakout"] }), run(2, -2, { symbol: "BBB", tags: ["breakout", "gap"] }), run(3, 4, { tags: ["gap"] })]);
    expect(breakdown(rows, "symbol").map((g) => [g.key, g.trades])).toEqual([["AAA", 2], ["BBB", 1]]);
    const tags = breakdown(rows, "tag");
    expect(tags.map((g) => g.key)).toEqual(["breakout", "gap"]);
    expect(tags[0].winRate).toBe(0.5);
    expect(tags[1].avgR).toBeCloseTo(0.5);
  });

  it("filters and parses tags", () => {
    const rows = tradeRows([run(1, 2, { tags: ["a"] }), run(2, 2, { symbol: "BBB" })]);
    expect(filterRows(rows, "", "").length).toBe(2);
    expect(filterRows(rows, "BBB", "").map((r) => r.id)).toEqual([2]);
    expect(filterRows(rows, "", "a").map((r) => r.id)).toEqual([1]);
    expect(parseTags(" a, b ,,a")).toEqual(["a", "b"]);
  });
});

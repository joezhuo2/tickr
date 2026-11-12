import { describe, expect, it } from "vitest";
import { CHART_MODES, brickSize, displayCandles, heikinAshi, isOhlc, nextMode, renko } from "./charttypes";
import type { Candle } from "./types";

const k = (t: number, o: number, h: number, l: number, c: number, v = 10): Candle => ({ t, o, h, l, c, v });

describe("chart types", () => {
  it("cycles through every mode and wraps", () => {
    let m = CHART_MODES[0].id;
    const seen = CHART_MODES.map(() => (m = nextMode(m)));
    expect(new Set(seen).size).toBe(CHART_MODES.length);
    expect(m).toBe(CHART_MODES[0].id);
    expect(isOhlc("bars")).toBe(true);
    expect(isOhlc("baseline")).toBe(false);
  });

  it("computes Heikin Ashi from the previous smoothed candle", () => {
    const ha = heikinAshi([k(1, 10, 12, 9, 11), k(2, 11, 14, 10, 13)]);
    expect(ha[0]).toMatchObject({ o: 10.5, c: 10.5, h: 12, l: 9 });
    expect(ha[1]).toMatchObject({ o: 10.5, c: 12, h: 14, l: 10 });
  });

  it("builds Renko bricks and needs two brick sizes to reverse", () => {
    const closes = [100, 103, 102, 99, 98];
    const bricks = renko(closes.map((c, i) => k(i, c, c, c, c)), 1);
    expect(bricks.map((b) => [b.o, b.c])).toEqual([[100, 101], [101, 102], [102, 103], [102, 101], [101, 100], [100, 99], [99, 98]]);
    expect(bricks[0].t).toBe(1);
    expect(bricks[0].v).toBe(20);
    expect(bricks[1].v).toBe(0);
    expect(renko([], 1)).toEqual([]);
  });

  it("sizes bricks from the average true range, with a fallback", () => {
    expect(brickSize([k(1, 10, 12, 9, 11), k(2, 11, 14, 10, 13)])).toBe(4);
    expect(brickSize([k(1, 50, 50, 50, 50)])).toBe(0.5);
    const same = [k(1, 1, 2, 0, 1)];
    expect(displayCandles(same, "candles")).toBe(same);
  });
});

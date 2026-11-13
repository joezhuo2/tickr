import { describe, expect, it } from "vitest";
import { CHART_MODES, TYPE_DEFAULTS, brickSize, cleanTypeSettings, displayCandles, heikinAshi, isOhlc, isReshaped, kagi, lineBreak, nextMode, pointFigure, rangeBars, renko } from "./charttypes";
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

  it("builds range bars that only break beyond the range", () => {
    const flat = (cs: number[]) => cs.map((c, i) => k(i, c, c, c, c));
    const bars = rangeBars(flat([10, 11, 12, 13, 15, 14, 11]), 2);
    expect(bars.map((b) => [b.o, b.h, b.l, b.c])).toEqual([[10, 12, 10, 12], [12, 14, 12, 14], [14, 15, 13, 13], [13, 13, 11, 11]]);
    expect(rangeBars([k(1, 10, 14, 10, 14)], 2).map((b) => [b.o, b.c])).toEqual([[10, 12], [12, 14]]);
    expect(rangeBars(flat([5, 5, 5]), 1)).toHaveLength(1);
    expect(rangeBars([], 1)).toEqual([]);
    expect(rangeBars(flat([5]), 0)).toEqual([]);
  });

  it("builds three line break lines and reverses only past the last lines", () => {
    const closes = (cs: number[]) => cs.map((c, i) => k(i, c, c, c, c));
    const seq = [10, 11, 12, 13, 12, 11, 10, 9];
    expect(lineBreak(closes(seq), 3).map((l) => [l.o, l.c])).toEqual([[10, 11], [11, 12], [12, 13], [12, 9]]);
    expect(lineBreak(closes(seq), 2).map((l) => [l.o, l.c])).toEqual([[10, 11], [11, 12], [12, 13], [12, 10], [10, 9]]);
    expect(lineBreak(closes([5, 5, 5]), 3)).toEqual([]);
    expect(lineBreak(closes([5]), 3)).toEqual([]);
    expect(lineBreak([], 3)).toEqual([]);
  });

  it("builds Kagi lines with yang and yin switches at the prior shoulder and waist", () => {
    const lines = kagi([10, 11, 12, 10, 9, 13, 14, 11, 8].map((c, i) => k(i, c, c, c, c)), 2);
    expect(lines.map((l) => [l.o, l.c, l.thick, l.flip, l.t])).toEqual([
      [10, 12, false, undefined, 2],
      [12, 9, false, undefined, 3],
      [9, 14, false, 12, 5],
      [14, 8, true, 9, 7],
    ]);
    expect(kagi([100, 101.9].map((c, i) => k(i, c, c, c, c)), 2, true)).toEqual([]);
    expect(kagi([100, 102].map((c, i) => k(i, c, c, c, c)), 2, true).map((l) => [l.o, l.c])).toEqual([[100, 102]]);
    expect(kagi([5, 5, 5].map((c, i) => k(i, c, c, c, c)), 1)).toEqual([]);
    expect(kagi([], 1)).toEqual([]);
  });

  it("builds Point and Figure columns with a reversal of three boxes", () => {
    const cols = pointFigure([10.5, 11.2, 12.7, 13.1, 10.4, 9.9, 12.2].map((c, i) => k(i, c, c, c, c)), 1, 3);
    expect(cols.map((c) => [c.o, c.c, c.l, c.h, c.t, c.box])).toEqual([[10, 14, 10, 14, 1, 1], [13, 9, 9, 13, 4, 1], [10, 13, 10, 13, 6, 1]]);
    expect(cols[0].v).toBe(40);
    expect(pointFigure([10, 12, 9].map((c, i) => k(i, c, c, c, c)), 1, 3)).toHaveLength(2);
    expect(pointFigure([10, 12, 10].map((c, i) => k(i, c, c, c, c)), 1, 3)).toHaveLength(1);
    expect(pointFigure([5, 5, 5].map((c, i) => k(i, c, c, c, c)), 1, 3)).toEqual([]);
    expect(pointFigure([], 1, 3)).toEqual([]);
  });

  it("cleans type settings and dispatches by mode", () => {
    expect(cleanTypeSettings(null)).toEqual(TYPE_DEFAULTS);
    expect(cleanTypeSettings({ lineBreak: 9, pfReversal: 0, rangeSize: -1, kagiPercent: true })).toMatchObject({ lineBreak: 5, pfReversal: 1, rangeSize: 0, kagiPercent: true });
    const cs = [10, 11, 12, 13].map((c, i) => k(i, c, c, c, c));
    expect(displayCandles(cs, "linebreak", { ...TYPE_DEFAULTS, lineBreak: 2 })).toHaveLength(3);
    expect(displayCandles(cs, "pointfigure", { ...TYPE_DEFAULTS, pfBox: 1 })).toHaveLength(1);
    expect(displayCandles(cs, "kagi", { ...TYPE_DEFAULTS, kagiAmount: 1 })).toHaveLength(1);
    expect(displayCandles(cs, "range", { ...TYPE_DEFAULTS, rangeSize: 1 }).length).toBeGreaterThan(1);
    expect(isReshaped("kagi")).toBe(true);
    expect(isReshaped("candles")).toBe(false);
  });

  it("sizes bricks from the average true range, with a fallback", () => {
    expect(brickSize([k(1, 10, 12, 9, 11), k(2, 11, 14, 10, 13)])).toBe(4);
    expect(brickSize([k(1, 50, 50, 50, 50)])).toBe(0.5);
    const same = [k(1, 1, 2, 0, 1)];
    expect(displayCandles(same, "candles")).toBe(same);
  });
});

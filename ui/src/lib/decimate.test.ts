import { describe, expect, it } from "vitest";
import { columnPen, columns } from "./decimate";

function record() {
  const calls: [string, number, number][] = [];
  return { calls, sink: { moveTo: (x: number, y: number) => calls.push(["M", x, y]), lineTo: (x: number, y: number) => calls.push(["L", x, y]) } };
}

describe("columnPen", () => {
  it("passes points through when each has its own pixel column", () => {
    const { calls, sink } = record();
    const pen = columnPen(sink, 1);
    pen.to(0.5, 3);
    pen.to(1.5, 4);
    pen.lift();
    pen.to(3.5, 5);
    pen.to(4.5, 6);
    pen.lift();
    expect(calls).toEqual([["M", 0.5, 3], ["L", 1.5, 4], ["M", 3.5, 5], ["L", 4.5, 6]]);
  });

  it("collapses a column to its first, low, high and last values", () => {
    const { calls, sink } = record();
    const pen = columnPen(sink, 2);
    pen.to(1, 5);
    pen.to(1.1, 9);
    pen.to(1.2, 1);
    pen.to(1.3, 4);
    pen.to(2, 7);
    pen.lift();
    expect(calls).toEqual([["M", 1, 5], ["L", 1, 1], ["L", 1, 9], ["L", 1, 4], ["L", 2, 7]]);
  });
});

describe("columns", () => {
  const bar = (t: number, o: number, h: number, l: number, c: number, v: number) => ({ t, o, h, l, c, v });
  const candles = [bar(1, 10, 12, 9, 11, 100), bar(2, 11, 15, 10, 14, 300), bar(3, 14, 14, 8, 9, 200), bar(4, 9, 10, 7, 8, 50)];

  it("merges bars that share a pixel column", () => {
    expect(columns(candles, 0, 3, (i) => i * 0.4, 1)).toEqual([
      { t: 1, o: 10, h: 15, l: 8, c: 9, v: 300, x: 0.5 },
      { t: 4, o: 9, h: 10, l: 7, c: 8, v: 50, x: 1.5 },
    ]);
  });

  it("uses device pixels and the requested range", () => {
    expect(columns(candles, 1, 2, (i) => i * 0.4, 2).map((c) => c.x)).toEqual([0.25, 0.75]);
  });
});

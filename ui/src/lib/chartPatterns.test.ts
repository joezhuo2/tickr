import { describe, expect, it } from "vitest";
import { MIN_BARS, detectChartPatterns, pivots } from "./chartPatterns";
import type { Candle } from "./types";

function series(waypoints: number[], seg = 8): Candle[] {
  const closes = [waypoints[0]];
  for (let k = 1; k < waypoints.length; k++) for (let j = 1; j <= seg; j++) closes.push(waypoints[k - 1] + ((waypoints[k] - waypoints[k - 1]) * j) / seg);
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { t: 1000 + i * 60, o, h: Math.max(o, c) + 0.2, l: Math.min(o, c) - 0.2, c, v: 1000 };
  });
}

const mirror = (cs: Candle[]): Candle[] => cs.map((c) => ({ ...c, o: 200 - c.o, h: 200 - c.l, l: 200 - c.h, c: 200 - c.c }));
const kinds = (cs: Candle[]) => detectChartPatterns(cs).map((p) => `${p.kind}${p.confirmed ? "" : "?"}`);

const SHAPES: [string, string, number[]][] = [
  ["head_and_shoulders", "inverse_head_and_shoulders", [80, 100, 90, 110, 90, 100, 84]],
  ["double_top", "double_bottom", [80, 100, 88, 100.5, 84]],
  ["triple_top", "triple_bottom", [80, 100, 89, 100.4, 89.2, 99.8, 84]],
  ["ascending_triangle", "descending_triangle", [85, 100, 90, 100, 94, 100, 97, 104]],
  ["rising_wedge", "falling_wedge", [80, 100, 90, 104, 97, 107, 102, 94]],
  ["bull_flag", "bear_flag", [85, 80, 100, 95, 98, 94, 104]],
];

describe("chart patterns", () => {
  it.each(SHAPES)("finds a %s and its mirror %s", (top, bottom, waypoints) => {
    const cs = series(waypoints);
    expect(kinds(cs)).toEqual([top]);
    expect(kinds(mirror(cs))).toEqual([bottom]);
  });

  it("finds a symmetrical triangle", () => {
    expect(kinds(series([80, 110, 86, 105, 91, 100, 94, 88]))).toEqual(["symmetrical_triangle"]);
  });

  it("returns anchors, a neckline and a quality score", () => {
    const [p] = detectChartPatterns(series([80, 100, 90, 110, 90, 100, 84]));
    expect(p).toMatchObject({ kind: "head_and_shoulders", name: "Head and shoulders", bias: "bearish", confirmed: true });
    expect(p.points.map((q) => q.price)).toEqual([100.2, 89.8, 110.2, 89.8, 100.2]);
    expect(p.points.every((q, k) => k === 0 || q.i > p.points[k - 1].i)).toBe(true);
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0].map((q) => q.price)).toEqual([89.8, 89.8]);
    expect(p.end).toBeGreaterThan(p.points[4].i);
    expect(p.quality).toBeGreaterThan(0.9);
    expect(p.quality).toBeLessThanOrEqual(1);
  });

  it("leaves a pattern unconfirmed until a candle closes through the neckline", () => {
    const cs = series([80, 100, 88, 100.5, 84]);
    const [done] = detectChartPatterns(cs);
    const early = detectChartPatterns(cs.slice(0, done.end));
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({ kind: "double_top", confirmed: false });
    expect(early[0].end).toBeLessThan(done.end);
    expect(early[0].lines[0][1].i).toBe(done.end - 1);
  });

  it("drops a top that price later breaks above", () => {
    expect(kinds(series([80, 100, 88, 100.5, 95, 110]))).not.toContain("double_top");
  });

  it("only detects the kinds asked for", () => {
    const cs = series([80, 100, 90, 110, 90, 100, 84]);
    expect(detectChartPatterns(cs, ["double_top", "bull_flag"])).toEqual([]);
    expect(detectChartPatterns(cs, [])).toEqual([]);
  });

  it("is deterministic", () => {
    const cs = series([80, 100, 90, 110, 90, 100, 84]);
    expect(detectChartPatterns(cs)).toEqual(detectChartPatterns(cs));
  });

  it("finds nothing in noise, a plain trend or a short series", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const noise = series(Array.from({ length: 30 }, () => 100 + rand() - 0.5), 4);
    expect(kinds(noise)).toEqual([]);
    expect(kinds(series([80, 90, 86, 96, 92, 102, 98, 108, 104, 114]))).toEqual([]);
    expect(kinds(mirror(series([80, 90, 86, 96, 92, 102, 98, 108, 104, 114])))).toEqual([]);
    expect(detectChartPatterns(series([80, 100, 90], 5))).toEqual([]);
    expect(detectChartPatterns(series([80, 100, 90, 110, 90, 100, 84]).slice(0, MIN_BARS - 1))).toEqual([]);
  });

  it("alternates pivot highs and lows without looking past the last candle", () => {
    const cs = series([80, 100, 90, 110, 90, 100, 84]);
    const ps = pivots(cs, 3);
    expect(ps.every((p, k) => k === 0 || p.high !== ps[k - 1].high)).toBe(true);
    expect(ps.every((p) => p.i + 3 < cs.length)).toBe(true);
    expect(pivots(cs.slice(0, 20), 3).every((p) => p.i < 17)).toBe(true);
  });
});

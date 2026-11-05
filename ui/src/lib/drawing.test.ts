import { describe, expect, it } from "vitest";
import { PEN_MAX_POINTS, hitPolyline, hitTest, indexToTime, pathBounds, polylineDistance, rulerMeasurement, segmentDistance, simplifyPath, timeToIndex, undoReducer, type History } from "./drawing";
import { forward, inverse, scaleLabel } from "./scale";
import type { Drawing } from "./types";

const times = [100, 160, 280, 340];
const level: Drawing = { id: 1, kind: "hline", points: [{ t: 190, price: 125 }], text: "" };

describe("drawing anchors", () => {
  it("interpolates irregular bars and extrapolates with average spacing", () => {
    expect(timeToIndex(times, 190)).toBe(1.25);
    expect(timeToIndex(times, 20)).toBe(-1);
    expect(timeToIndex(times, 420)).toBe(4);
    for (const t of [20, 100, 160, 190, 280, 340, 500]) expect(indexToTime(times, timeToIndex(times, t))).toBeCloseTo(t);
    expect(timeToIndex([], 10)).toBe(0);
    expect(indexToTime([], 1)).toBe(0);
    expect(indexToTime([100], timeToIndex([100], 130))).toBe(130);
  });
  it("keeps real prices through scales and percent rebasing", () => {
    for (const scale of ["linear", "log", "percent"] as const) {
      expect(inverse(forward(125, 50, 200, scale), 50, 200, scale)).toBeCloseTo(125);
    }
    expect(scaleLabel(125, "percent", 100)).toBe("+25.0%");
    expect(scaleLabel(125, "percent", 125)).toBe("0%");
    expect(indexToTime([100, 220, 340], timeToIndex([100, 220, 340], level.points[0].t))).toBe(190);
  });
});

it("hits levels and bounded segments within six pixels", () => {
  const a = { x: 10, y: 10 }, b = { x: 20, y: 10 };
  expect(hitTest({ x: 1000, y: 16 }, a)).toBe(true);
  expect(hitTest({ x: 15, y: 16 }, a, b)).toBe(true);
  expect(hitTest({ x: 15, y: 16.01 }, a, b)).toBe(false);
  expect(hitTest({ x: 30, y: 10 }, a, b)).toBe(false);
  expect(segmentDistance({ x: 13, y: 14 }, a, a)).toBe(5);
});

it("undoes and redoes immutable lists and drops redo after an edit", () => {
  const empty: History = { past: [], present: [], future: [] };
  expect(undoReducer(empty, "undo")).toBe(empty);
  const added = undoReducer(empty, [level]);
  const removed = undoReducer(added, []);
  const undone = undoReducer(removed, "undo");
  expect(undone.present).toEqual([level]);
  expect(undoReducer(undone, "redo").present).toEqual([]);
  expect(undoReducer(undone, [level, { ...level, id: 2 }]).future).toEqual([]);
  expect(empty.present).toEqual([]);
});

it("measures signed price and percent with absolute bars and elapsed time", () => {
  const a = { t: 0, price: 100 }, b = { t: 10800, price: 101.25 };
  const bars = Array.from({ length: 13 }, (_, i) => i * 900);
  expect(rulerMeasurement(a, b, bars)).toEqual({ delta: 1.25, percent: 1.25, bars: 12, elapsed: "3h", label: "+1.25 (+1.25%) · 12 bars · 3h" });
  expect(rulerMeasurement(b, a, bars).delta).toBe(-1.25);
  expect(rulerMeasurement(a, a, bars).elapsed).toBe("0s");
  expect(rulerMeasurement(a, { ...b, t: 90 }, bars).elapsed).toBe("1.5m");
  expect(rulerMeasurement(a, { ...b, t: 172800 }, bars).elapsed).toBe("2d");
});

describe("freehand pen", () => {
  const id = (p: { x: number; y: number }) => p;

  it("drops near-duplicate points but keeps the endpoints", () => {
    const stroke = [{ x: 0, y: 0 }, { x: 0.4, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 10, y: 0 }, { x: 10.3, y: 0.1 }, { x: 20, y: 5 }, { x: 20.2, y: 5 }];
    expect(simplifyPath(stroke, id)).toEqual([stroke[0], stroke[3], stroke[5], stroke[6]]);
    expect(simplifyPath(stroke, id, 0)).toEqual(stroke);
  });
  it("leaves short strokes alone and returns a copy", () => {
    const two = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    expect(simplifyPath(two, id)).toEqual(two);
    expect(simplifyPath(two, id)).not.toBe(two);
    expect(simplifyPath([], id)).toEqual([]);
  });
  it("keeps the original items, not copies", () => {
    const stroke = [{ t: 1, price: 1 }, { t: 2, price: 1 }, { t: 3, price: 1 }, { t: 100, price: 1 }];
    const kept = simplifyPath(stroke, (p) => ({ x: p.t, y: p.price }));
    expect(kept).toHaveLength(3);
    expect(kept[0]).toBe(stroke[0]);
    expect(kept[1]).toBe(stroke[2]);
    expect(kept[2]).toBe(stroke[3]);
  });
  it("thins dense strokes to the point limit", () => {
    const stroke = Array.from({ length: 5000 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 20) * 50 }));
    const out = simplifyPath(stroke, id);
    expect(out.length).toBeLessThanOrEqual(PEN_MAX_POINTS);
    expect(out.length).toBeGreaterThan(100);
    expect(out[0]).toBe(stroke[0]);
    expect(out[out.length - 1]).toBe(stroke[4999]);
    expect(simplifyPath(stroke, id, 1.5, 10).length).toBeLessThanOrEqual(10);
  });
  it("measures distance to the nearest part of a polyline", () => {
    const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(polylineDistance({ x: 5, y: 3 }, path)).toBe(3);
    expect(polylineDistance({ x: 13, y: 5 }, path)).toBe(3);
    expect(polylineDistance({ x: 13, y: 14 }, [{ x: 10, y: 10 }])).toBe(5);
    expect(polylineDistance({ x: 0, y: 0 }, [])).toBe(Infinity);
  });
  it("hits a polyline within six pixels of any segment", () => {
    const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(hitPolyline({ x: 4, y: 6 }, path)).toBe(true);
    expect(hitPolyline({ x: 16, y: 5 }, path)).toBe(true);
    expect(hitPolyline({ x: 16.01, y: 5 }, path)).toBe(false);
    expect(hitPolyline({ x: 3, y: -6.01 }, path)).toBe(false);
    expect(hitPolyline({ x: 5, y: 5 }, [])).toBe(false);
  });
  it("bounds a path", () => {
    expect(pathBounds([{ x: 3, y: 9 }, { x: -2, y: 4 }, { x: 8, y: 12 }])).toEqual({ minX: -2, maxX: 8, minY: 4, maxY: 12 });
  });
  it("round-trips pen anchors through bar indexes", () => {
    const stroke = [{ t: 100, price: 10 }, { t: 190, price: 12 }, { t: 400, price: 11 }];
    for (const p of stroke) expect(Math.round(indexToTime(times, timeToIndex(times, p.t)))).toBe(p.t);
  });
});
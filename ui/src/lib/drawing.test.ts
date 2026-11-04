import { describe, expect, it } from "vitest";
import { hitTest, indexToTime, rulerMeasurement, segmentDistance, timeToIndex, undoReducer, type History } from "./drawing";
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

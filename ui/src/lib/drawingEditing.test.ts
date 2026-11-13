import { describe, expect, it } from "vitest";
import { INTERVAL_CLASSES, MAX_WIDTH, WIDTHS, clampWidth, cleanStyle, copyDrawing, intervalClass, nextDrawingId, toggleVisible, visibleOn } from "./drawing";
import type { Drawing } from "./types";

const times = [100, 200, 300, 400];
const trend: Drawing = { id: 0, kind: "trend", points: [{ t: 100, price: 50 }, { t: 300, price: 60 }], text: "", color: "#ef4444", width: 5, locked: true, hidden: true, visible: ["days"] };

describe("copy, paste and clone", () => {
  it("gives copies the lowest free id", () => {
    expect(nextDrawingId([])).toBe(0);
    expect(nextDrawingId([{ ...trend, id: 0 }, { ...trend, id: 1 }, { ...trend, id: 3 }])).toBe(2);
  });

  it("shifts copies a few bars right and slightly down, unlocked and shown", () => {
    const list = [trend, { ...trend, id: 1 }];
    const copy = copyDrawing(trend, list, times);
    expect(copy.id).toBe(2);
    expect(copy.points.map((p) => p.t)).toEqual([400, 600]);
    expect(copy.points[0].price).toBeCloseTo(49.5);
    expect(copy.points[1].price).toBeCloseTo(59.4);
    expect(copy.locked).toBe(false);
    expect(copy.hidden).toBe(false);
    expect({ ...copy, id: 0, points: trend.points, locked: true, hidden: true }).toEqual(trend);
    expect(trend.points[0]).toEqual({ t: 100, price: 50 });
    const pasted = copyDrawing(trend, [], [1000, 1060, 1120], 1, 0.05);
    expect(pasted.id).toBe(0);
    expect(pasted.points[0]).toEqual({ t: 160, price: 47.5 });
  });
});

describe("line width", () => {
  it("clamps widths to 1 to 8 px", () => {
    expect(MAX_WIDTH).toBe(8);
    expect(WIDTHS).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([0, 1, 4.4, 8, 12, -3, NaN].map(clampWidth)).toEqual([1, 1, 4, 8, 8, 1, 1]);
    expect(cleanStyle({ width: 8 }).width).toBe(8);
    expect(cleanStyle({ width: 6 }).width).toBe(6);
    expect(cleanStyle({ width: 9 }).width).toBe(1);
  });
});

describe("per-interval visibility", () => {
  it("classifies candle intervals", () => {
    expect(["1m", "5m", "45m", "60m", "4h", "1d", "3d", "1wk", "1mo", "auto", ""].map(intervalClass)).toEqual(["minutes", "minutes", "minutes", "hours", "hours", "days", "days", "weeks", "weeks", null, null]);
  });

  it("shows drawings on every interval by default and filters restricted ones", () => {
    const plain = { visible: undefined };
    for (const { cls } of INTERVAL_CLASSES) expect(visibleOn(plain, cls)).toBe(true);
    expect(visibleOn({ visible: [] }, "minutes")).toBe(true);
    const daily = { visible: ["days", "weeks"] as Drawing["visible"] };
    expect(visibleOn(daily, "days")).toBe(true);
    expect(visibleOn(daily, "weeks")).toBe(true);
    expect(visibleOn(daily, "minutes")).toBe(false);
    expect(visibleOn(daily, null)).toBe(true);
    const list: Drawing[] = [{ ...trend, visible: undefined }, trend, { ...trend, id: 2, visible: ["minutes"] }];
    expect(list.filter((d) => visibleOn(d, "minutes")).map((d) => d.id)).toEqual([0, 2]);
  });

  it("toggles interval classes and falls back to all", () => {
    expect(toggleVisible(undefined, "hours")).toEqual(["hours"]);
    expect(toggleVisible(["weeks"], "minutes")).toEqual(["minutes", "weeks"]);
    expect(toggleVisible(["hours"], "hours")).toBeUndefined();
    expect(toggleVisible(["minutes", "hours", "days"], "weeks")).toBeUndefined();
  });
});

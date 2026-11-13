import { describe, expect, it } from "vitest";
import { DRAWING_NAMES, ICONS, POINT_COUNT, brushWidth, drawingSummary, dropRepeats, ellipsePath, fibFanRays, fibTimeZones, gannFanRays, hitBrush, hitEllipse, hitPolyline, iconBounds, iconShape, inBounds } from "./drawing";
import type { Drawing } from "./types";

describe("new drawing tools", () => {
  it("places Gann fan rays by price/time ratio with 1x1 through the second point", () => {
    const rays = gannFanRays({ x: 0, y: 100 }, { x: 10, y: 80 });
    expect(rays.map((r) => r.label)).toEqual(["1x8", "1x4", "1x3", "1x2", "1x1", "2x1", "3x1", "4x1", "8x1"]);
    expect(rays.every((r) => r.through.x === 10)).toBe(true);
    expect(rays.find((r) => r.label === "1x1")!.through.y).toBe(80);
    expect(rays.find((r) => r.label === "1x2")!.through.y).toBe(90);
    expect(rays.find((r) => r.label === "1x8")!.through.y).toBe(97.5);
    expect(rays.find((r) => r.label === "2x1")!.through.y).toBe(60);
    expect(rays.find((r) => r.label === "8x1")!.through.y).toBe(-60);
  });

  it("aims Fib fan rays at the retracement levels of the move at the second point", () => {
    const rays = fibFanRays({ x: 0, y: 200 }, { x: 50, y: 100 });
    expect(rays.map((r) => r.ratio)).toEqual([0.236, 0.382, 0.5, 0.618, 0.786]);
    expect(rays.every((r) => r.through.x === 50)).toBe(true);
    expect(rays[2].through.y).toBe(150);
    expect(rays[0].through.y).toBeCloseTo(123.6);
    expect(rays[4].through.y).toBeCloseTo(178.6);
  });

  it("spaces Fib time zones by Fibonacci multiples of the unit width", () => {
    expect(fibTimeZones(10, 12).map((z) => z.index)).toEqual([10, 12, 14, 16, 20, 26, 36, 52, 78, 120, 188]);
    expect(fibTimeZones(10, 12).map((z) => z.step)).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
    expect(fibTimeZones(20, 19)[4].index).toBe(15);
  });

  it("hits the ellipse outline but not its centre or far outside", () => {
    const a = { x: 0, y: 0 }, b = { x: 100, y: 40 };
    const path = ellipsePath(a, b);
    expect(path[0]).toEqual({ x: 100, y: 20 });
    expect(path[16].x).toBeCloseTo(50);
    expect(path[16].y).toBeCloseTo(40);
    expect(hitEllipse({ x: 0, y: 20 }, a, b)).toBe(true);
    expect(hitEllipse({ x: 50, y: 3 }, a, b)).toBe(true);
    expect(hitEllipse({ x: 50, y: 20 }, a, b)).toBe(false);
    expect(hitEllipse({ x: 110, y: 20 }, a, b)).toBe(false);
    expect(hitEllipse({ x: 100, y: 0 }, a, b)).toBe(false);
  });

  it("hits polylines along every leg and drops repeated clicks", () => {
    const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(hitPolyline({ x: 5, y: 4 }, path)).toBe(true);
    expect(hitPolyline({ x: 14, y: 5 }, path)).toBe(true);
    expect(hitPolyline({ x: 0, y: 10 }, path)).toBe(false);
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 11, y: 1 }, { x: 11, y: 1 }, { x: 20, y: 5 }];
    expect(dropRepeats(pts, (p) => p)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }]);
    expect(dropRepeats([], (p) => p)).toEqual([]);
  });

  it("hits the wide brush stroke within its width", () => {
    const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(brushWidth()).toBe(10);
    expect(brushWidth(3)).toBe(18);
    expect(hitBrush({ x: 50, y: 7 }, path)).toBe(true);
    expect(hitBrush({ x: 50, y: 8 }, path)).toBe(false);
    expect(hitBrush({ x: 50, y: 11 }, path, 3)).toBe(true);
  });

  it("draws every icon from paths or plain glyphs inside its bounds", () => {
    expect(ICONS).toHaveLength(8);
    const at = { x: 50, y: 50 };
    for (const { icon } of ICONS) {
      const s = iconShape(icon, at);
      expect(s.fill.length + s.stroke.length + (s.text ? 1 : 0)).toBeGreaterThan(0);
      for (const p of [...s.fill, ...s.stroke].flat()) expect(inBounds(p, iconBounds(at), 0.01)).toBe(true);
    }
    expect(iconShape("question", at).text).toBe("?");
    expect(iconShape("exclamation", at).text).toBe("!");
    expect(iconShape("star", at).fill[0]).toHaveLength(10);
  });

  it("names, counts and summarises the new kinds", () => {
    for (const kind of ["gannfan", "fibfan", "fibtime", "ellipse"] as const) expect(POINT_COUNT[kind]).toBe(2);
    expect(POINT_COUNT.icon).toBe(1);
    for (const kind of ["gannfan", "fibfan", "fibtime", "ellipse", "polyline", "brush", "icon"] as const) expect(DRAWING_NAMES[kind]).toBeTruthy();
    const icon: Drawing = { id: 1, kind: "icon", icon: "star", points: [{ t: 1, price: 12 }], text: "" };
    expect(drawingSummary(icon)).toBe("Star 12.00");
    expect(drawingSummary({ ...icon, kind: "polyline", points: [icon.points[0], icon.points[0], icon.points[0]] })).toBe("3 points");
  });
});

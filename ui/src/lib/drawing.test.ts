import { describe, expect, it } from "vitest";
import { DRAWING_NAMES, MAX_TEMPLATES, PEN_MAX_POINTS, POINT_COUNT, SHAPE_LABELS, calloutGeometry, cleanDrawingStyles, drawingSummary, harmonicRatios, hitCallout, inBounds, markerPath, necklineEnds, pointLabel, saveTemplate, shapeSegments, arrowHead, channelLines, fibExtLevels, pitchforkLines, snapPrice, hitPolyline, hitTest, indexToTime, pathBounds, polylineDistance, rulerMeasurement, segmentDistance, simplifyPath, timeToIndex, undoReducer, type History } from "./drawing";
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
describe("box, ray, Fibonacci, position and anchored VWAP helpers", () => {
  it("computes retracement levels from the end of the move", async () => {
    const { fibLevels } = await import("./drawing");
    const levels = fibLevels(100, 200);
    expect(levels.map((l) => l.price)).toEqual([200, 176.4, 161.8, 150, 138.2, 121.4, 100].map((p) => expect.closeTo(p, 6)));
    expect(fibLevels(200, 100)[4].price).toBeCloseTo(161.8);
  });

  it("derives a long or short position with its reward target", async () => {
    const { positionLevels } = await import("./drawing");
    expect(positionLevels(50, 49)).toEqual({ long: true, risk: 1, riskPct: 2, target: 52, reward: 2 });
    expect(positionLevels(50, 52, 3)).toMatchObject({ long: false, risk: 2, target: 44 });
  });

  it("clamps the configured reward multiple", async () => {
    const { clampReward } = await import("./drawing");
    expect([1.55, 0, -3, NaN, 99, 0.01].map(clampReward)).toEqual([1.6, 2, 2, 2, 20, 0.1]);
  });

  it("anchors VWAP at the first candle on or after the anchor time", async () => {
    const { anchoredVwap } = await import("./drawing");
    const bar = (t: number, p: number, v: number) => ({ t, o: p, h: p, l: p, c: p, v });
    expect(anchoredVwap([bar(0, 5, 9), bar(10, 10, 0), bar(20, 10, 1), bar(30, 20, 3)], 5)).toEqual([null, null, 10, 17.5]);
  });

  it("extends rays to the plot edge and hits box outlines only", async () => {
    const { rayEnd, hitBox } = await import("./drawing");
    expect(rayEnd({ x: 10, y: 10 }, { x: 20, y: 15 }, 0, 110)).toEqual({ x: 110, y: 60 });
    expect(rayEnd({ x: 50, y: 10 }, { x: 40, y: 20 }, 0, 110)).toEqual({ x: 0, y: 60 });
    expect(rayEnd({ x: 50, y: 10 }, { x: 50, y: 20 }, 0, 110)).toEqual({ x: 50, y: 20 });
    expect(hitBox({ x: 10, y: 52 }, { x: 10, y: 10 }, { x: 100, y: 100 })).toBe(true);
    expect(hitBox({ x: 55, y: 55 }, { x: 10, y: 10 }, { x: 100, y: 100 })).toBe(false);
  });
});

describe("snapPrice", () => {
  it("snaps to the nearest OHLC value within the tolerance", () => {
    const candle = { o: 10, h: 12, l: 9, c: 11 };
    expect(snapPrice(11.8, candle, 0.5)).toBe(12);
    expect(snapPrice(10.4, candle, 0.5)).toBe(10);
    expect(snapPrice(10.5, candle, 0.2)).toBe(10.5);
    expect(snapPrice(10.5, undefined, 5)).toBe(10.5);
  });
});

describe("multi-point drawings", () => {
  it("projects Fibonacci extensions of the first move from the third point", () => {
    const levels = fibExtLevels(100, 110, 105);
    expect(levels[0]).toEqual({ ratio: 0, price: 105 });
    expect(levels[2]).toEqual({ ratio: 1, price: 115 });
    expect(fibExtLevels(110, 100, 105)[2].price).toBe(95);
  });

  it("offsets the channel's second line to pass through the third point", () => {
    const [base, other] = channelLines({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 15 });
    expect(base).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    expect(other).toEqual([{ x: 0, y: 10 }, { x: 10, y: 20 }]);
    expect(channelLines({ x: 3, y: 0 }, { x: 3, y: 10 }, { x: 8, y: 4 })[1]).toEqual([{ x: 8, y: 0 }, { x: 8, y: 10 }]);
  });

  it("runs the pitchfork median through the midpoint and keeps the tines parallel", () => {
    const [median, upper, lower] = pitchforkLines({ x: 0, y: 50 }, { x: 10, y: 40 }, { x: 10, y: 60 }, 0, 100);
    expect(median[1]).toEqual({ x: 100, y: 50 });
    expect(upper[1]).toEqual({ x: 100, y: 40 });
    expect(lower[1]).toEqual({ x: 100, y: 60 });
  });

  it("puts the arrow head wings behind the tip", () => {
    const [l, r] = arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 10);
    expect(l.x).toBeLessThan(10);
    expect(l.y).toBeCloseTo(-r.y);
    expect(POINT_COUNT.pitchfork).toBe(3);
  });
});

describe("pattern and annotation tools", () => {
  it("computes harmonic ratios from the five prices", () => {
    const [ab, bc, cd, ad] = harmonicRatios([100, 200, 138.2, 176.4, 121.4]);
    expect(ab).toMatchObject({ from: 0, to: 2, label: "AB/XA" });
    expect(ab.ratio).toBeCloseTo(0.618);
    expect(bc.ratio).toBeCloseTo(0.618);
    expect(cd.ratio).toBeCloseTo(1.44, 2);
    expect(ad.ratio).toBeCloseTo(0.786);
    expect(harmonicRatios([100, 100, 90, 95, 92])[0].ratio).toBe(0);
  });

  it("labels peaks above and troughs below", () => {
    const path = [{ x: 0, y: 50 }, { x: 10, y: 10 }, { x: 20, y: 40 }, { x: 30, y: 0 }];
    expect(pointLabel(path, 0)).toEqual({ x: 0, y: 56, above: false });
    expect(pointLabel(path, 1)).toEqual({ x: 10, y: 4, above: true });
    expect(pointLabel(path, 2).above).toBe(false);
    expect(pointLabel(path, 3).above).toBe(true);
    expect(SHAPE_LABELS.impulse).toHaveLength(POINT_COUNT.impulse!);
    expect(SHAPE_LABELS.corrective).toHaveLength(POINT_COUNT.corrective!);
    expect(SHAPE_LABELS.xabcd).toHaveLength(POINT_COUNT.xabcd!);
    expect(SHAPE_LABELS.headshoulders).toEqual(["LS", "", "H", "", "RS"]);
  });

  it("hit-tests legs, harmonic connectors and the extended neckline", () => {
    const pts = [{ x: 0, y: 50 }, { x: 20, y: 0 }, { x: 40, y: 30 }, { x: 60, y: 10 }, { x: 80, y: 40 }];
    const hits = (kind: Drawing["kind"], p: { x: number; y: number }) => shapeSegments(kind, pts).some(([a, b]) => hitTest(p, a, b));
    expect(hits("impulse", { x: 10, y: 25 })).toBe(true);
    expect(hits("impulse", { x: 20, y: 40 })).toBe(false);
    expect(hits("xabcd", { x: 20, y: 40 })).toBe(true);
    expect(shapeSegments("xabcd", pts)).toHaveLength(8);
    expect(necklineEnds(pts)).toEqual([{ x: 0, y: -5 }, { x: 80, y: 15 }]);
    expect(hits("headshoulders", { x: 78, y: 14.5 })).toBe(true);
    expect(hits("impulse", { x: 78, y: 14.5 })).toBe(false);
    expect(necklineEnds([pts[0], { x: 5, y: 5 }, pts[2], { x: 5, y: 9 }, pts[4]])).toEqual([{ x: 5, y: 5 }, { x: 5, y: 9 }]);
  });

  it("places markers on the right side of the point and wires callouts to the box edge", () => {
    const up = markerPath({ x: 50, y: 50 }, true);
    expect(up[0]).toEqual({ x: 50, y: 52 });
    expect(Math.min(...up.map((p) => p.y))).toBeGreaterThan(50);
    expect(Math.max(...markerPath({ x: 50, y: 50 }, false).map((p) => p.y))).toBeLessThan(50);
    expect(inBounds({ x: 53, y: 60 }, pathBounds(up))).toBe(true);
    expect(inBounds({ x: 60, y: 45 }, pathBounds(up), 3)).toBe(false);
    const { box, tail } = calloutGeometry({ x: 0, y: 0 }, { x: 40, y: 50 }, 30);
    expect(box).toEqual({ minX: 40, maxX: 82, minY: 40, maxY: 60 });
    expect(tail).toEqual({ x: 40, y: 40 });
    expect(hitCallout({ x: 80, y: 58 }, { x: 0, y: 0 }, { x: 40, y: 50 }, 30)).toBe(true);
    expect(hitCallout({ x: 20, y: 20 }, { x: 0, y: 0 }, { x: 40, y: 50 }, 30)).toBe(true);
    expect(hitCallout({ x: 20, y: 40 }, { x: 0, y: 0 }, { x: 40, y: 50 }, 30)).toBe(false);
  });

  it("names and summarizes every kind", () => {
    expect(drawingSummary({ id: 1, kind: "callout", points: [], text: "Breakout\nline two" })).toBe("Breakout");
    expect(drawingSummary({ id: 1, kind: "trend", points: [{ t: 1, price: 10 }, { t: 2, price: 12.5 }], text: "" })).toBe("10.00 → 12.50");
    expect(drawingSummary(level)).toBe("125.00");
    expect(drawingSummary({ id: 1, kind: "pen", points: [level.points[0], level.points[0]], text: "" })).toBe("2 points");
    for (const kind of Object.keys(POINT_COUNT)) expect(DRAWING_NAMES[kind as Drawing["kind"]]).toBeTruthy();
  });

  it("cleans saved styles and keeps template names unique and capped", () => {
    const s = cleanDrawingStyles({ defaults: { trend: { color: "#ABCDEF", width: 3, dashed: true }, toString: {}, bogus: {}, rect: { color: "red", width: 9 } }, templates: [{ name: " Red ", color: "#ff0000", width: 2 }, { name: "Red" }, { name: "" }, null] });
    expect(s.defaults).toEqual({ trend: { color: "#ABCDEF", width: 3, dashed: true }, rect: { color: "", width: 1, dashed: false } });
    expect(s.templates).toEqual([{ name: "Red", color: "#ff0000", width: 2, dashed: false }]);
    expect(cleanDrawingStyles(null)).toEqual({ defaults: {}, templates: [] });
    const blue = { color: "#0000ff", width: 1, dashed: false };
    expect(saveTemplate(s.templates, "Red", blue)).toEqual([{ name: "Red", ...blue }]);
    let many = s.templates;
    for (let i = 0; i < 30; i++) many = saveTemplate(many, `T${i}`, blue);
    expect(many).toHaveLength(MAX_TEMPLATES);
    expect(saveTemplate(many, "  ", blue)).toBe(many);
  });
});

import { describe, expect, it } from "vitest";
import { HEAT_CLAMP, heatColor, heatWeights, layoutHeatmap, tileDetail, type HeatTile } from "./heatmap";

const area = (t: HeatTile) => t.w * t.h;
const overlap = (a: HeatTile, b: HeatTile) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;

describe("heatColor", () => {
  it("is neutral for flat, missing and non-finite moves", () => {
    for (const v of [0, null, undefined, NaN, Infinity, 0.001]) expect(heatColor(v)).toBe("var(--surface)");
  });

  it("mixes the theme up color for gains and the down color for losses", () => {
    expect(heatColor(2)).toContain("var(--up)");
    expect(heatColor(-2)).toContain("var(--down)");
    expect(heatColor(2)).toContain("var(--surface)");
  });

  it("grows stronger with the size of the move", () => {
    const mix = (v: number) => Number(/ (\d+)%/.exec(heatColor(v))![1]);
    expect(mix(1)).toBeLessThan(mix(2));
    expect(mix(-1)).toBeLessThan(mix(-3));
    expect(mix(1)).toBe(mix(-1));
  });

  it("clamps at the scale limit", () => {
    expect(heatColor(HEAT_CLAMP)).toBe(heatColor(HEAT_CLAMP * 10));
    expect(heatColor(-HEAT_CLAMP)).toBe(heatColor(-100));
    expect(heatColor(8, 10)).not.toBe(heatColor(10, 10));
    expect(heatColor(10, 10)).toBe(heatColor(50, 10));
  });

  it("falls back to neutral for an unusable clamp", () => {
    expect(heatColor(3, 0)).toBe("var(--surface)");
    expect(heatColor(3, -1)).toBe("var(--surface)");
  });
});

describe("heatWeights", () => {
  it("uses absolute change", () => {
    expect(heatWeights([4, -2, 2])).toEqual([4, 2, 2]);
  });

  it("gives equal weights when no move is known", () => {
    expect(heatWeights([null, undefined, NaN])).toEqual([1, 1, 1]);
    expect(heatWeights([0, 0])).toEqual([1, 1]);
    expect(heatWeights([])).toEqual([]);
  });

  it("keeps flat and unknown symbols visible next to big movers", () => {
    const w = heatWeights([20, 0, null, 0.1]);
    expect(w[0]).toBe(20);
    for (const v of w.slice(1)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeCloseTo(3);
    }
  });
});

describe("tileDetail", () => {
  it("drops text as tiles shrink", () => {
    expect(tileDetail(120, 80)).toBe("full");
    expect(tileDetail(40, 24)).toBe("ticker");
    expect(tileDetail(120, 12)).toBe("none");
    expect(tileDetail(20, 80)).toBe("none");
  });
});

describe("layoutHeatmap", () => {
  const items = [
    { id: "A", weight: 6 },
    { id: "B", weight: 6 },
    { id: "C", weight: 4 },
    { id: "D", weight: 3 },
    { id: "E", weight: 2 },
    { id: "F", weight: 1 },
  ];

  it("returns nothing for no items or no space", () => {
    expect(layoutHeatmap([], 100, 100)).toEqual([]);
    expect(layoutHeatmap(items, 0, 100)).toEqual([]);
    expect(layoutHeatmap(items, 100, -5)).toEqual([]);
    expect(layoutHeatmap(items, NaN, 100)).toEqual([]);
  });

  it("fills a single item completely", () => {
    expect(layoutHeatmap([{ id: "A", weight: 3 }], 200, 100)).toEqual([{ id: "A", weight: 3, x: 0, y: 0, w: 200, h: 100 }]);
  });

  it("covers the whole area with no overlap and nothing out of bounds", () => {
    const tiles = layoutHeatmap(items, 300, 200);
    expect(tiles).toHaveLength(items.length);
    expect(tiles.reduce((s, t) => s + area(t), 0)).toBeCloseTo(300 * 200, 6);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9);
      expect(t.y).toBeGreaterThanOrEqual(-1e-9);
      expect(t.x + t.w).toBeLessThanOrEqual(300 + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(200 + 1e-9);
    }
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) expect(overlap(tiles[i], tiles[j])).toBe(false);
  });

  it("sizes tiles in proportion to weight", () => {
    const tiles = layoutHeatmap(items, 300, 200);
    const total = items.reduce((s, i) => s + i.weight, 0);
    for (const t of tiles) expect(area(t) / (300 * 200)).toBeCloseTo(t.weight / total, 9);
  });

  it("makes equal weights equal tiles", () => {
    const tiles = layoutHeatmap(
      ["A", "B", "C", "D"].map((id) => ({ id, weight: 1 })),
      200,
      200,
    );
    for (const t of tiles) expect(area(t)).toBeCloseTo(10000, 6);
  });

  it("keeps tiles reasonably square", () => {
    const tiles = layoutHeatmap(items, 300, 200);
    for (const t of tiles) expect(Math.max(t.w / t.h, t.h / t.w)).toBeLessThan(4);
  });

  it("is deterministic and stable for ties", () => {
    const a = layoutHeatmap(items, 300, 200);
    expect(layoutHeatmap([...items], 300, 200)).toEqual(a);
    expect(a.slice(0, 2).map((t) => t.id)).toEqual(["A", "B"]);
  });

  it("works in tall and wide containers", () => {
    for (const [w, h] of [
      [100, 600],
      [600, 100],
    ]) {
      const tiles = layoutHeatmap(items, w, h);
      expect(tiles.reduce((s, t) => s + area(t), 0)).toBeCloseTo(w * h, 6);
    }
  });

  it("skips items without a usable positive weight", () => {
    const tiles = layoutHeatmap(
      [
        { id: "A", weight: 2 },
        { id: "B", weight: 0 },
        { id: "C", weight: -1 },
        { id: "D", weight: NaN },
        { id: "E", weight: 2 },
      ],
      100,
      100,
    );
    expect(tiles.map((t) => t.id).sort()).toEqual(["A", "E"]);
    expect(tiles.reduce((s, t) => s + area(t), 0)).toBeCloseTo(10000, 6);
  });

  it("handles many tiles", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `S${i}`, weight: 1 + (i % 7) }));
    const tiles = layoutHeatmap(many, 640, 360);
    expect(tiles).toHaveLength(80);
    expect(tiles.reduce((s, t) => s + area(t), 0)).toBeCloseTo(640 * 360, 4);
  });
});

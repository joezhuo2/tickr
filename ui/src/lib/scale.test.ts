import { describe, expect, it } from "vitest";
import { fitScale, forward, inverse, scaleLabel, scaleTicks, shiftRange, stretchRange } from "./scale";
import { niceTicks } from "./format";

describe("price scales", () => {
  it("preserves linear geometry and ticks", () => {
    const fit = fitScale([100, 200], [80, 220], "linear", 100);
    expect(fit).toEqual({ lo: 71.6, hi: 228.4, scale: "linear" });
    expect(forward(125, 100, 200, "linear")).toBe(0.25);
    expect(scaleTicks(100, 200, "linear", 100)).toEqual(niceTicks(100, 200));
  });

  it.each(["linear", "log", "percent"] as const)("round trips %s positions", (scale) => {
    for (const position of [-0.06, 0, 0.25, 0.5, 1, 1.06]) {
      expect(forward(inverse(position, 10, 1000, scale), 10, 1000, scale)).toBeCloseTo(position, 12);
    }
  });

  it("spaces equal ratios evenly and uses price levels for log ticks", () => {
    expect(forward(10, 1, 100, "log")).toBeCloseTo(0.5);
    expect(scaleTicks(1, 100, "log", 1)).toEqual([1, 2, 5, 10, 20, 50, 100]);
    const ticks = scaleTicks(100, 110, "log", 100);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.every((v) => v >= 100 && v <= 110)).toBe(true);
  });

  it("excludes non-positive overlays and falls back without positive candles", () => {
    const fit = fitScale([10, 100], [-20, 0, 200], "log", 10);
    expect(fit.scale).toBe("log");
    expect(fit.lo).toBeGreaterThan(0);
    expect(forward(10, fit.lo, fit.hi, fit.scale)).toBeCloseTo(0.06 / 1.12);
    expect(fitScale([-10, 0], [200], "log", 0).scale).toBe("linear");
    expect(Number.isFinite(forward(0, fit.lo, fit.hi, fit.scale))).toBe(true);
  });

  it("rebases percent ticks and labels to the first visible close", () => {
    expect(scaleLabel(112.5, "percent", 100)).toBe("+12.5%");
    expect(scaleLabel(97, "percent", 100)).toBe("-3.0%");
    expect(scaleLabel(100, "percent", 100)).toBe("0%");
    expect(scaleLabel(100, "percent", 125)).toBe("-20.0%");
    expect(scaleTicks(90, 110, "percent", 100)).toEqual([90, 95, 100, 105, 110]);
    expect(fitScale([0, 10], [], "percent", 0).scale).toBe("linear");
  });

  it("keeps empty and flat fits finite", () => {
    for (const values of [[], [5, 5]]) {
      for (const mode of ["linear", "log", "percent"] as const) {
        const fit = fitScale(values, [], mode, 5);
        expect(Number.isFinite(fit.lo)).toBe(true);
        expect(fit.hi).toBeGreaterThan(fit.lo);
      }
    }
  });
});

describe("manual price range", () => {
  it("stretches around the middle and shifts by a fraction of the range", () => {
    expect(stretchRange(100, 200, "linear", 2)).toEqual({ lo: 50, hi: 250 });
    expect(shiftRange(100, 200, "linear", 0.1)).toEqual({ lo: 110, hi: 210 });
    const log = stretchRange(10, 1000, "log", 0.5);
    expect(log.lo).toBeCloseTo(10 ** 1.5);
    expect(log.hi).toBeCloseTo(10 ** 2.5);
  });
});

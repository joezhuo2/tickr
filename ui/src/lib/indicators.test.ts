import { describe, expect, it } from "vitest";
import { alertLevels, chartPatternKinds, clampPanel, legendText, orSignals, overlayVisibility, paneLayout, valueArea, volumeProfile, shouldAnalyze, toggleChartPattern, toggleOverlay } from "./indicators";
import { CHART_PATTERN_KINDS } from "./patternInfo";
import type { IndicatorConfig, Overlays } from "./types";

const config = (): IndicatorConfig => ({
  sma: [{ length: 20, color: "#123456", visible: true }, { length: 50, color: "", visible: false }],
  ema: [{ length: 9, color: "", visible: true }],
  bollinger: { length: 20, k: 2, color: "", visible: true },
  vwap: { color: "", visible: true }, vwap_bands: 0, volume_profile: false, opening_range: { minutes: 15, extension: 1, color: "", visible: false }, levels: { color: "", visible: false }, volume_ma: { length: 20, color: "", visible: true }, rsi: { length: 14, color: "", visible: true },
  macd: { fast: 12, slow: 26, signal: 9, color: "", signal_color: "", visible: false },
  fib: true, targets: true, patterns: true, keep_analysis: false, chart_patterns: true, chart_patterns_off: [],
});

describe("opening range signals", () => {
  const bar = (l: number, h: number, c: number) => ({ l, h, c });
  const run = (bars: { l: number; h: number; c: number }[], nulls = 0) => {
    const level = (v: number) => bars.map((_, i) => (i < nulls ? null : v));
    return orSignals(bars, level(110), level(100));
  };
  const inside = bar(101, 109, 105);
  const breakout = bar(108, 114, 113);
  const away = bar(115, 120, 118);

  it("flags a close back inside within three bars as a failed breakout", () => {
    expect(run([inside, inside, breakout, away, away, bar(108, 116, 109)])).toEqual([{ i: 5, kind: "failed", side: "up" }]);
    expect(run([inside, inside, bar(96, 102, 97), bar(98, 103, 102)])).toEqual([{ i: 3, kind: "failed", side: "down" }]);
  });

  it("ignores a close back inside after the window and ends the sequence", () => {
    expect(run([inside, inside, breakout, away, away, away, bar(108, 116, 109), breakout, bar(110.5, 115, 114)])).toEqual([]);
  });

  it("flags a wick back to the level that closes beyond it as a held retest", () => {
    expect(run([inside, inside, breakout, away, bar(110.9, 116, 115), bar(110, 116, 115)])).toEqual([{ i: 4, kind: "retest", side: "up" }]);
    expect(run([inside, inside, bar(96, 102, 97), bar(92, 99.5, 94)])).toEqual([{ i: 3, kind: "retest", side: "down" }]);
    expect(run([inside, inside, breakout, bar(111.1, 116, 115)])).toEqual([]);
  });

  it("starts over when the range changes and skips bars without a range", () => {
    expect(run([breakout, inside, breakout, bar(108, 112, 109)], 1)).toEqual([{ i: 3, kind: "failed", side: "up" }]);
    expect(orSignals([inside, breakout, bar(108, 112, 109)], [110, 110, 120], [100, 100, 100])).toEqual([]);
  });
});

it("toggles all moving averages without changing lengths, colors or the saved input", () => {
  const saved = config();
  const off = toggleOverlay(saved, "mas", false);
  expect(overlayVisibility(off).mas).toBe(false);
  expect(saved.sma[0].visible).toBe(true);
  const on = toggleOverlay(off, "mas", true);
  expect([...on.sma, ...on.ema].every((l) => l.visible)).toBe(true);
  expect(on.sma[0]).toEqual({ length: 20, color: "#123456", visible: true });
  expect(on.macd).toEqual(saved.macd);
  expect(overlayVisibility({ ...saved, sma: [], ema: [] }).mas).toBe(false);
});

it("persists each group toggle without changing the other settings", () => {
  for (const key of ["bollinger", "vwap", "opening_range", "levels", "volume_ma", "rsi", "macd", "fib", "targets", "patterns", "chart_patterns", "volume_profile"] as (keyof Overlays)[]) {
    const saved = config();
    const next = toggleOverlay(saved, key, !overlayVisibility(saved)[key]);
    expect(overlayVisibility(next)).toEqual({ ...overlayVisibility(saved), [key]: !overlayVisibility(saved)[key] });
    expect(next.sma).toEqual(saved.sma);
  }
});

it("turns single chart patterns off and back on", () => {
  const saved = config();
  expect(chartPatternKinds(saved)).toEqual([...CHART_PATTERN_KINDS]);
  const off = toggleChartPattern(toggleChartPattern(saved, "bull_flag", false), "bull_flag", false);
  expect(off.chart_patterns_off).toEqual(["bull_flag"]);
  expect(chartPatternKinds(off)).toHaveLength(CHART_PATTERN_KINDS.length - 1);
  expect(chartPatternKinds(off)).not.toContain("bull_flag");
  expect(toggleChartPattern(off, "bull_flag", true).chart_patterns_off).toEqual([]);
  expect(saved.chart_patterns_off).toEqual([]);
});

it("spreads each candle's volume over the price bins it touches", () => {
  const bar = (l: number, h: number, v: number) => ({ t: 0, o: l, h, l, c: h, v });
  const candles = [bar(0, 4, 400), bar(0, 1, 100), bar(3, 4, 50), bar(9, 99, 1)];
  expect(volumeProfile(candles, 0, 2, 4)).toEqual({ lo: 0, step: 1, volumes: [150, 150, 100, 150] });
  expect(volumeProfile(candles, 1, 1, 4)?.volumes.reduce((a, b) => a + b)).toBe(100);
  expect(volumeProfile([bar(5, 5, 10)], 0, 0)).toBeNull();
  expect(volumeProfile([], 0, 0)).toBeNull();
});

describe("valueArea", () => {
  it("extends from the POC toward the heavier side", () => {
    expect(valueArea([5, 10, 30, 20, 5, 2, 28], 60)).toEqual({ poc: 2, lo: 1, hi: 3 });
    expect(valueArea([5, 10, 30, 20, 5, 2, 28], 70)).toEqual({ poc: 2, lo: 0, hi: 4 });
    expect(valueArea([5, 10, 30, 20, 5, 2, 28], 90)).toEqual({ poc: 2, lo: 0, hi: 6 });
  });
  it("breaks ties toward the first peak and the upper side", () => {
    expect(valueArea([10, 10, 10], 50)).toEqual({ poc: 0, lo: 0, hi: 1 });
    expect(valueArea([10, 40, 10, 10, 10, 10, 10], 50)).toEqual({ poc: 1, lo: 1, hi: 2 });
  });
  it("handles single bins and empty input", () => {
    expect(valueArea([7], 70)).toEqual({ poc: 0, lo: 0, hi: 0 });
    expect(valueArea([], 70)).toBeNull();
    expect(valueArea([0, 0], 70)).toBeNull();
  });
  it("keeps the percent within 50 to 95 and stops at the edges", () => {
    expect(valueArea([10, 10, 10, 10], 0)).toEqual({ poc: 0, lo: 0, hi: 1 });
    expect(valueArea([10, 10, 10, 10], 100)).toEqual({ poc: 0, lo: 0, hi: 3 });
    expect(valueArea([0, 10, 0], 95)).toEqual({ poc: 1, lo: 1, hi: 1 });
  });
});

it("lists the latest known breakout levels with their alert direction", () => {
  const line = (key: string, values: (number | null)[]) => ({ key, label: key, color: "", visible: true, period: 1, full_from: 0, values });
  const series = {
    opening_range: [line("or_high", [null, 104, 104]), line("or_low", [null, 98, 98]), line("or_mid", [null, 101, 101])],
    levels: [line("pd_high", [110, 110, null]), line("pd_low", [null, null, null]), line("pm_high", [0, 0, 0]), line("pm_low", [97, 96, 95])],
  };
  expect(alertLevels(series)).toEqual([
    { label: "OR high", level: 104, direction: "above" },
    { label: "OR low", level: 98, direction: "below" },
    { label: "PDH", level: 110, direction: "above" },
    { label: "PML", level: 95, direction: "below" },
  ]);
  expect(alertLevels({ opening_range: [], levels: [] })).toEqual([]);
});

it("keeps a dragged panel between its minimum and 85% of the space", () => {
  expect([clampPanel(10, 600), clampPanel(300.4, 600), clampPanel(900, 600), clampPanel(50, 100)]).toEqual([92, 300, 510, 92]);
});

it("recalculates only when results are shown or keep analysis is enabled", () => {
  expect(shouldAnalyze(false, false)).toBe(false);
  expect(shouldAnalyze(true, false)).toBe(true);
  expect(shouldAnalyze(false, true)).toBe(true);
  expect(shouldAnalyze(true, true)).toBe(true);
});

describe("lower pane layout", () => {
  for (const rsi of [false, true]) for (const macd of [false, true]) {
    it(`fits price, volume, RSI=${rsi}, MACD=${macd} without overlap`, () => {
      const p = paneLayout(400, rsi, macd);
      expect(p.priceH).toBeGreaterThan(0);
      expect(p.volTop).toBeGreaterThan(p.priceH);
      if (rsi) {
        expect(p.rsiTop).toBeGreaterThan(p.volTop + p.volH);
        expect(p.rsiTop + p.rsiH).toBeLessThanOrEqual(400);
      }
      if (macd) {
        expect(p.macdTop).toBeGreaterThan(rsi ? p.rsiTop + p.rsiH : p.volTop + p.volH);
        expect(p.macdTop + p.macdH).toBeLessThanOrEqual(400);
      }
    });
  }
});

describe("legendText", () => {
  it("appends the values that exist and keeps the bare label otherwise", () => {
    expect(legendText("SMA 20", [101.5])).toBe("SMA 20  101.50");
    expect(legendText("BB 20", [110, null, 90], 1)).toBe("BB 20  110.0 / 90.0");
    expect(legendText("VWAP", [null, NaN])).toBe("VWAP");
  });
});

describe("paneLayout with study panes", () => {
  for (const [rsi, macd, extra] of [[false, false, 1], [true, false, 1], [true, true, 1], [true, true, 2], [false, false, 2]] as const) {
    it(`stacks RSI=${rsi}, MACD=${macd} and ${extra} study panes inside the chart`, () => {
      const p = paneLayout(400, rsi, macd, extra);
      const tops = [...(rsi ? [p.rsiTop] : []), ...(macd ? [p.macdTop] : []), ...p.extraTops];
      expect(p.volTop).toBeGreaterThan(p.priceH);
      expect(tops[0]).toBeGreaterThan(p.volTop + p.volH);
      tops.forEach((t, i) => { if (i) expect(t).toBeGreaterThan(tops[i - 1] + p.rsiH); });
      expect(tops[tops.length - 1] + p.rsiH).toBeLessThanOrEqual(400.0001);
      expect(p.priceH).toBeGreaterThan(100);
    });
  }
});

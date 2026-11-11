import { describe, expect, it } from "vitest";
import { clampPanel, overlayVisibility, paneLayout, shouldAnalyze, toggleOverlay } from "./indicators";
import type { IndicatorConfig, Overlays } from "./types";

const config = (): IndicatorConfig => ({
  sma: [{ length: 20, color: "#123456", visible: true }, { length: 50, color: "", visible: false }],
  ema: [{ length: 9, color: "", visible: true }],
  bollinger: { length: 20, k: 2, color: "", visible: true },
  vwap: { color: "", visible: true }, opening_range: { minutes: 15, extension: 1, color: "", visible: false }, levels: { color: "", visible: false }, volume_ma: { length: 20, color: "", visible: true }, rsi: { length: 14, color: "", visible: true },
  macd: { fast: 12, slow: 26, signal: 9, color: "", signal_color: "", visible: false },
  fib: true, targets: true, patterns: true, keep_analysis: false,
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
  for (const key of ["bollinger", "vwap", "opening_range", "levels", "volume_ma", "rsi", "macd", "fib", "targets", "patterns"] as (keyof Overlays)[]) {
    const saved = config();
    const next = toggleOverlay(saved, key, !overlayVisibility(saved)[key]);
    expect(overlayVisibility(next)).toEqual({ ...overlayVisibility(saved), [key]: !overlayVisibility(saved)[key] });
    expect(next.sma).toEqual(saved.sma);
  }
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

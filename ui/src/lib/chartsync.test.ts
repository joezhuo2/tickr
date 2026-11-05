import { describe, expect, it } from "vitest";
import { barAt, barSpan, secondaryDefaults, viewWindow, windowView } from "./chartsync";
import { MIN_BARS } from "./viewport";

const DAY = 86400;
const MON = 1_767_623_400;
const daily = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18].map((d) => MON + d * DAY);
const fiveMin = (open: number, bars: number) => Array.from({ length: bars }, (_, i) => open + i * 300);
const intraday = [...fiveMin(MON, 78), ...fiveMin(MON + DAY, 78)];

describe("barSpan", () => {
  it("is the typical gap between bars, ignoring weekends and overnight gaps", () => {
    expect(barSpan(daily)).toBe(DAY);
    expect(barSpan(intraday)).toBe(300);
    expect(barSpan([MON])).toBe(0);
    expect(barSpan([])).toBe(0);
  });
});

describe("barAt", () => {
  it("finds the bar that contains a time", () => {
    expect(barAt(intraday, MON)).toBe(0);
    expect(barAt(intraday, MON + 299)).toBe(0);
    expect(barAt(intraday, MON + 300)).toBe(1);
    expect(barAt(daily, MON + DAY + 3600)).toBe(1);
    expect(barAt(intraday, MON + DAY + 600)).toBe(80);
  });
  it("maps an intraday time to its daily bar and a daily bar to its first intraday bar", () => {
    const t = intraday[100];
    expect(daily[barAt(daily, t)]).toBe(MON + DAY);
    expect(barAt(intraday, daily[1])).toBe(78);
  });
  it("returns -1 when the time does not exist in the series", () => {
    expect(barAt(intraday, MON - 1)).toBe(-1);
    expect(barAt(intraday, MON + 78 * 300 + 60)).toBe(-1);
    expect(barAt(intraday, MON + 2 * DAY)).toBe(-1);
    expect(barAt(daily, MON + 5 * DAY)).toBe(-1);
    expect(barAt(daily, daily[daily.length - 1] + DAY)).toBe(-1);
    expect(barAt([], MON)).toBe(-1);
    expect(barAt(daily, NaN)).toBe(-1);
  });
  it("accepts the last bar within one bar span", () => {
    expect(barAt(daily, daily[daily.length - 1] + DAY - 1)).toBe(daily.length - 1);
    expect(barAt([MON], MON)).toBe(0);
    expect(barAt([MON], MON + 1)).toBe(-1);
  });
});

describe("viewWindow and windowView", () => {
  it("round-trips a view through its time window", () => {
    for (const view of [{ start: 0, count: intraday.length }, { start: 20, count: 40 }, { start: 100.5, count: 30.25 }]) {
      const back = windowView(intraday, viewWindow(intraday, view)!)!;
      expect(back.start).toBeCloseTo(view.start, 6);
      expect(back.count).toBeCloseTo(view.count, 6);
    }
  });
  it("spans the visible bars edge to edge", () => {
    expect(viewWindow(intraday, { start: 10, count: 20 })).toEqual({ from: intraday[10] - 150, to: intraday[29] + 150 });
    expect(viewWindow([], { start: 0, count: 1 })).toBeNull();
  });
  it("translates a daily window onto an intraday series", () => {
    const w = viewWindow(daily, { start: 1, count: 1 })!;
    const v = windowView(intraday, w)!;
    expect(intraday[Math.ceil(v.start)]).toBe(MON + DAY);
    expect(v.start + v.count).toBe(intraday.length);
  });
  it("widens a narrow window to the minimum bars around its centre", () => {
    const w = viewWindow(intraday, { start: 0, count: 156 })!;
    const v = windowView(daily, w)!;
    expect(v.count).toBe(MIN_BARS);
    expect(v.start).toBe(0);
    const mid = windowView(daily, { from: daily[7] - 1, to: daily[7] + 1 })!;
    expect(mid.count).toBe(MIN_BARS);
    expect(mid.start).toBeCloseTo(7.5 - MIN_BARS / 2, 0);
  });
  it("returns null when the window misses the series", () => {
    expect(windowView(daily, { from: MON - 10 * DAY, to: MON - 5 * DAY })).toBeNull();
    expect(windowView(daily, { from: daily[daily.length - 1] + 2 * DAY, to: daily[daily.length - 1] + 5 * DAY })).toBeNull();
    expect(windowView(daily, { from: MON + DAY, to: MON })).toBeNull();
    expect(windowView([], { from: MON, to: MON + DAY })).toBeNull();
  });
  it("clamps a window wider than the series to the full series", () => {
    expect(windowView(daily, { from: MON - 100 * DAY, to: MON + 100 * DAY })).toEqual({ start: 0, count: daily.length });
  });
});

describe("secondaryDefaults", () => {
  it("picks daily candles when the main chart is intraday", () => {
    for (const range of ["1d", "5d", "1mo"]) expect(secondaryDefaults(range, "auto")).toEqual({ range: "1y", interval: "1d" });
    expect(secondaryDefaults("1y", "60m")).toEqual({ range: "1y", interval: "1d" });
  });
  it("picks intraday candles when the main chart is daily or longer", () => {
    for (const range of ["6mo", "ytd", "1y", "5y", "max"]) expect(secondaryDefaults(range, "auto")).toEqual({ range: "5d", interval: "auto" });
    expect(secondaryDefaults("1mo", "1d")).toEqual({ range: "5d", interval: "auto" });
  });
});

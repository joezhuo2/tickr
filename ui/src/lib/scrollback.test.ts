import { describe, expect, it } from "vitest";
import { axisRange, loadUntil, mergeOlder, olderWindow, ownCandles, rangeFor, withSeries } from "./scrollback";
import { RANGES, baseFor, intervalsFor, pickerIntervals, type Candle } from "./types";

const DAY = 86_400;
const k = (t: number): Candle => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });

describe("scroll-back history", () => {
  it("keeps the range when it supports the interval and otherwise moves to the nearest that does", () => {
    expect(rangeFor("1y", "1d")).toBe("1y");
    expect(rangeFor("1y", "auto")).toBe("1y");
    expect(rangeFor("1y", "5m")).toBe("1mo");
    expect(rangeFor("1d", "1wk")).toBe("6mo");
    expect(rangeFor("max", "1m")).toBe("5d");
    for (const r of RANGES) for (const i of pickerIntervals(["7m", "90m", "5h", "10d", "3wk", "6mo"])) expect(intervalsFor(rangeFor(r.id, i))).toContain(baseFor(i, rangeFor(r.id, i)));
    expect(rangeFor("5d", "2d")).toBe("ytd");
    expect(rangeFor("1d", "4h")).toBe("1d");
    expect(rangeFor("5y", "4h")).toBe("1y");
    expect(rangeFor("1y", "45m")).toBe("1mo");
    expect(rangeFor("1y", "7m")).toBe("5d");
  });

  it("asks for one loaded span of older candles, within the provider's limit per interval", () => {
    const first = 100 * DAY;
    expect(olderWindow("1d", first, first + 30 * DAY)).toEqual({ start: 70 * DAY, end: first });
    expect(olderWindow("1m", first, first + 30 * DAY)).toEqual({ start: 93 * DAY, end: first });
    expect(olderWindow("5m", first, first + DAY)).toEqual({ start: 95 * DAY, end: first });
    expect(olderWindow("1d", 3 * DAY, 400 * DAY)).toEqual({ start: 1, end: 3 * DAY });
    expect(olderWindow("1d", 0, 10)).toBeNull();
  });

  it("prepends only candles older than the first one loaded", () => {
    const current = [k(30), k(40)];
    expect(mergeOlder([k(10), k(20), k(30), k(35)], current).map((c) => c.t)).toEqual([10, 20, 30, 40]);
    expect(mergeOlder([k(30)], current)).toBe(current);
    expect(mergeOlder([k(1)], [])).toEqual([]);
  });

  it("widens axis labels once the visible span outgrows the range", () => {
    expect(axisRange("1d", "5m", 0.3 * DAY)).toBe("1d");
    expect(axisRange("1d", "5m", 4 * DAY)).toBe("5d");
    expect(axisRange("1d", "5m", 30 * DAY)).toBe("1y");
    expect(axisRange("1mo", "1d", 300 * DAY)).toBe("1mo");
    expect(axisRange("1mo", "1d", 900 * DAY)).toBe("max");
    expect(axisRange("max", "1mo", 9000 * DAY)).toBe("max");
    expect(axisRange("1mo", "4h", 300 * DAY)).toBe("1y");
    expect(axisRange("1y", "2d", 900 * DAY)).toBe("max");
  });
});

describe("go to date history loading", () => {
  const run = async (target: number, times: number[], more: number[][], alive = () => true) => {
    let calls = 0;
    const result = await loadUntil(
      target,
      () => times[0] ?? null,
      async () => {
        const add = more[calls++];
        if (!add?.length) return false;
        times.unshift(...add);
        return true;
      },
      alive,
    );
    return { result, calls, times };
  };

  it("stops at once when the date is already covered", async () => {
    expect(await run(10, [5, 20], [])).toMatchObject({ result: "reached", calls: 0 });
  });

  it("loads steps until the first candle reaches the date", async () => {
    expect(await run(10, [50], [[30], [20], [8], [1]])).toMatchObject({ result: "reached", calls: 3, times: [8, 20, 30, 50] });
  });

  it("reports exhausted when history runs out or the cap stops the step", async () => {
    expect(await run(1, [50], [[30], []])).toMatchObject({ result: "exhausted", calls: 2 });
  });

  it("is cancelled before or during a step and never loads again", async () => {
    expect(await run(1, [50], [[30]], () => false)).toMatchObject({ result: "cancelled", calls: 0 });
    let live = true;
    expect(await loadUntil(1, () => 50, async () => ((live = false), true), () => live)).toBe("cancelled");
    live = true;
    expect(await loadUntil(1, () => 50, async () => ((live = false), false), () => live)).toBe("cancelled");
  });
});

describe("analysis over scrolled-back candles", () => {
  it("scores the range's own candles and draws series over all of them", () => {
    const all = [k(1), k(2), k(3), k(4)];
    expect(ownCandles(all, 3).map((c) => c.t)).toEqual([3, 4]);
    expect(ownCandles(all, undefined)).toBe(all);
    const own = { score: 5, series: { t: [3, 4] } };
    const full = { score: 9, series: { t: [1, 2, 3, 4] } };
    expect(withSeries(own, full)).toEqual({ score: 5, series: { t: [1, 2, 3, 4] } });
  });
});

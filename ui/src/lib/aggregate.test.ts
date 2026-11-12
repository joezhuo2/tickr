import { describe, expect, it } from "vitest";
import { aggregate, aggregateChart, type Frame } from "./aggregate";
import { indexToTime, timeToIndex } from "./drawing";
import { futureTimes, type Clock, type TradingPeriods } from "./session";
import type { Candle, Chart } from "./types";

const utc = (iso: string) => Date.parse(iso) / 1000;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16);
const period = (start: string, end: string) => ({ start: utc(start), end: utc(end) });

const NY: Clock = { timezone: "America/New_York", gmtoffset: -18000 };
const NY_WINTER: TradingPeriods = {
  pre: period("2026-01-05T09:00:00Z", "2026-01-05T14:30:00Z"),
  regular: period("2026-01-05T14:30:00Z", "2026-01-05T21:00:00Z"),
  post: period("2026-01-05T21:00:00Z", "2026-01-06T01:00:00Z"),
};
const REGULAR: Frame = { clock: NY, periods: NY_WINTER };
const EXTENDED: Frame = { clock: NY, periods: NY_WINTER, extended: true };
const UTC_24H: Frame = { clock: { timezone: "UTC", gmtoffset: 0 }, periods: null };

let seq = 0;
function bar(t: number): Candle {
  seq++;
  return { t, o: seq, h: seq + 0.5, l: seq - 0.5, c: seq + 0.25, v: seq };
}
function bars(start: string, count: number, minutes: number): Candle[] {
  return Array.from({ length: count }, (_, i) => bar(utc(start) + i * minutes * 60));
}
function days(dates: string[], time = "14:30"): Candle[] {
  return dates.map((d) => bar(utc(`${d}T${time}:00Z`)));
}
function weekdays(from: string, to: string): Candle[] {
  const out: Candle[] = [];
  for (let t = utc(`${from}T14:30:00Z`); t <= utc(`${to}T14:30:00Z`); t += 86_400) {
    const day = new Date(t * 1000).getUTCDay();
    if (day > 0 && day < 6) out.push(bar(t));
  }
  return out;
}
function merged(group: Candle[]): Candle {
  return {
    t: group[0].t,
    o: group[0].o,
    h: Math.max(...group.map((c) => c.h)),
    l: Math.min(...group.map((c) => c.l)),
    c: group[group.length - 1].c,
    v: group.reduce((s, c) => s + c.v, 0),
  };
}

describe("aggregate", () => {
  it.each([
    ["4h from 30m, regular hours: 09:30 and a short 13:30", "4h", bars("2026-01-05T14:30:00Z", 13, 30), REGULAR, [8, 5], ["2026-01-05T14:30", "2026-01-05T18:30"]],
    ["2h from 60m session bars: last bucket 15:30 is short", "2h", bars("2026-01-05T14:30:00Z", 7, 60), REGULAR, [2, 2, 2, 1], ["2026-01-05T14:30", "2026-01-05T16:30", "2026-01-05T18:30", "2026-01-05T20:30"]],
    ["45m from 15m does not divide 6.5h: nine buckets, the last two bars", "45m", bars("2026-01-05T14:30:00Z", 26, 15), REGULAR, [3, 3, 3, 3, 3, 3, 3, 3, 2], null],
    ["3m from 1m divides evenly", "3m", bars("2026-01-05T14:30:00Z", 9, 1), REGULAR, [3, 3, 3], ["2026-01-05T14:30", "2026-01-05T14:33", "2026-01-05T14:36"]],
    ["4h from 30m with extended hours anchors at 04:00", "4h", bars("2026-01-05T09:00:00Z", 32, 30), EXTENDED, [8, 8, 8, 8], ["2026-01-05T09:00", "2026-01-05T13:00", "2026-01-05T17:00", "2026-01-05T21:00"]],
    ["2h from 30m with extended hours: 09:30 bar joins the 08:00 bucket", "2h", bars("2026-01-05T13:00:00Z", 6, 30), EXTENDED, [4, 2], ["2026-01-05T13:00", "2026-01-05T15:00"]],
    ["24h market without sessions anchors at midnight", "4h", bars("2026-01-05T02:00:00Z", 6, 60), UTC_24H, [2, 4], ["2026-01-05T00:00", "2026-01-05T04:00"]],
    ["24h covers a whole session", "24h", bars("2026-01-05T14:30:00Z", 13, 30), REGULAR, [13], ["2026-01-05T14:30"]],
  ])("%s", (_, interval, base, frame, sizes, starts) => {
    const out = aggregate(base, interval, frame);
    expect(out).toHaveLength(sizes.length);
    let at = 0;
    out.forEach((c, i) => {
      const group = base.slice(at, (at += sizes[i]));
      expect({ ...c, t: 0 }).toEqual({ ...merged(group), t: 0 });
    });
    if (starts) expect(out.map((c) => iso(c.t))).toEqual(starts);
  });

  it("anchors each trading day at its own session open, across days and a DST change", () => {
    const friday = bars("2026-03-06T14:30:00Z", 7, 60);
    const monday = bars("2026-03-09T13:30:00Z", 7, 60);
    const out = aggregate([...friday, ...monday], "2h", REGULAR);
    expect(out.map((c) => iso(c.t))).toEqual([
      "2026-03-06T14:30", "2026-03-06T16:30", "2026-03-06T18:30", "2026-03-06T20:30",
      "2026-03-09T13:30", "2026-03-09T15:30", "2026-03-09T17:30", "2026-03-09T19:30",
    ]);
    expect(out[3]).toEqual(merged([friday[6]]));
    expect(out[4]).toEqual(merged(monday.slice(0, 2)));
  });

  it("skips gaps: missing base bars shrink a bucket and empty buckets are not drawn", () => {
    const day = bars("2026-01-05T14:30:00Z", 26, 15);
    const gappy = day.filter((_, i) => i !== 1 && !(i >= 3 && i < 6));
    const out = aggregate(gappy, "45m", REGULAR);
    expect(out.map((c) => iso(c.t)).slice(0, 2)).toEqual(["2026-01-05T14:30", "2026-01-05T16:00"]);
    expect(out[0]).toEqual({ ...merged([day[0], day[2]]), t: day[0].t });
    expect(out).toHaveLength(8);
  });

  it("updates the forming last bucket as new base bars arrive", () => {
    const day = bars("2026-01-05T14:30:00Z", 6, 30);
    const before = aggregate(day.slice(0, 5), "4h", REGULAR);
    const after = aggregate(day, "4h", REGULAR);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(merged(day));
    expect(after[0].c).not.toBe(before[0].c);
    expect(after[0].v).toBe(before[0].v + day[5].v);
  });

  it("gives the same intraday buckets whatever older history is loaded", () => {
    const two = [...bars("2026-01-05T14:30:00Z", 26, 15), ...bars("2026-01-06T14:30:00Z", 26, 15)];
    const full = aggregate(two, "45m", REGULAR);
    const recent = aggregate(two.slice(26), "45m", REGULAR);
    expect(full.slice(-recent.length)).toEqual(recent);
  });

  it("counts trading bars for N-day buckets from the first trading day of each year", () => {
    const base = days(["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12"]);
    expect(aggregate(base, "3d", REGULAR)).toEqual([merged(base.slice(0, 3)), merged(base.slice(3, 6)), merged(base.slice(6))]);
    const yearEnd = days(["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-02", "2026-01-05", "2026-01-06"]);
    expect(aggregate(yearEnd, "2d", REGULAR)).toEqual([merged(yearEnd.slice(0, 1)), merged(yearEnd.slice(1, 3)), merged(yearEnd.slice(3, 5)), merged(yearEnd.slice(5))]);
  });

  it("estimates a partly loaded year's earlier trading days, so buckets match a full load when there are no holidays", () => {
    const full = weekdays("2026-01-02", "2026-03-31");
    const all = aggregate(full, "3d", REGULAR);
    const fromFeb = full.findIndex((c) => c.t >= utc("2026-02-10T00:00:00Z"));
    const part = aggregate(full.slice(fromFeb), "3d", REGULAR);
    expect(all.slice(-part.length + 1)).toEqual(part.slice(1));
  });

  it("does not advance the day count for a second bar on the same date", () => {
    const base = days(["2026-01-02", "2026-01-05"]);
    const live = [...base, bar(utc("2026-01-05T19:00:00Z")), ...days(["2026-01-06"])];
    expect(aggregate(live, "2d", REGULAR)).toEqual([merged(live.slice(0, 3)), merged(live.slice(3))]);
  });

  it("anchors N-week buckets on Monday 5 January 1970 and N-month buckets on January", () => {
    const weeks = days(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"], "05:00");
    expect(aggregate(weeks, "2wk", REGULAR)).toEqual([merged(weeks.slice(0, 2)), merged(weeks.slice(2))]);
    expect(aggregate(weeks.slice(1), "2wk", REGULAR)).toEqual([merged(weeks.slice(1, 2)), merged(weeks.slice(2))]);
    const months = days(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"], "05:00");
    expect(aggregate(months, "3mo", REGULAR)).toEqual([merged(months.slice(0, 2)), merged(months.slice(2, 5)), merged(months.slice(5))]);
  });

  it("leaves native intervals, unknown intervals and mismatched bases alone", () => {
    const base = bars("2026-01-05T14:30:00Z", 4, 15);
    const chart = { meta: { timezone: "America/New_York", gmtoffset: -18000, periods: NY_WINTER }, interval: "15m", extended: false, candles: base } as unknown as Chart;
    expect(aggregateChart(chart, "15m")).toBe(chart);
    expect(aggregateChart(chart, "auto")).toBe(chart);
    expect(aggregateChart(chart, "4h")).toBe(chart);
    const custom = aggregateChart(chart, "45m");
    expect(custom.interval).toBe("45m");
    expect(custom.candles).toEqual([merged(base.slice(0, 3)), merged(base.slice(3))]);
    expect(chart.candles).toBe(base);
    expect(aggregate(base, "auto", REGULAR)).toEqual(base);
  });

  it("keeps drawing anchors, which are timestamps, in place across custom and native intervals", () => {
    const base = bars("2026-01-05T14:30:00Z", 26, 15);
    const custom = aggregate(base, "45m", REGULAR).map((c) => c.t);
    const native = base.map((c) => c.t);
    for (const t of [base[4].t, base[7].t + 300, base[25].t + 3600]) {
      expect(indexToTime(custom, timeToIndex(custom, t))).toBeCloseTo(t, 6);
      expect(indexToTime(native, timeToIndex(native, t))).toBeCloseTo(t, 6);
    }
  });

  const UTC: Clock = { timezone: "UTC", gmtoffset: 0 };
  function session(from: string, days: number, open: string, count: number, minutes: number): Candle[] {
    const out: Candle[] = [];
    for (let d = 0, t0 = utc(`${from}T00:00:00Z`); out.length < days * count; d++) {
      const date = new Date((t0 + d * 86_400) * 1000).toISOString().slice(0, 10);
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) continue;
      const start = utc(`${date}T00:00:00Z`) + (utc(`1970-01-01T${open}:00Z`) - nyOffset(date));
      out.push(...Array.from({ length: count }, (_, i) => bar(start + i * minutes * 60)));
    }
    return out;
  }
  function nyOffset(date: string): number {
    return new Date(`${date}T12:00:00Z`).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" }).endsWith("EDT") ? -4 * 3600 : -5 * 3600;
  }
  function calendar(dates: string[]): Candle[] {
    return dates.map((d) => bar(utc(`${d}T00:00:00Z`)));
  }
  const dailyNoNewYear = weekdays("2025-11-03", "2026-02-27").filter((c) => !iso(c.t).startsWith("2026-01-01"));
  const mondays = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10));
  const firsts = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2024, i, 1)).toISOString().slice(0, 10));

  it.each([
    ["45m regular hours, cut mid-day and across a weekend", "45m", session("2026-01-05", 10, "09:30", 26, 15), REGULAR, 7 * 26 + 10, 20],
    ["45m across the March DST change", "45m", session("2026-03-02", 10, "09:30", 26, 15), REGULAR, 4 * 26 + 20, 20],
    ["4h regular hours with the short 13:30 bucket", "4h", session("2026-01-05", 10, "09:30", 13, 30), REGULAR, 6 * 13 + 3, 7],
    ["4h with extended hours from 04:00", "4h", session("2026-01-05", 10, "04:00", 32, 30), EXTENDED, 6 * 32 + 9, 14],
    ["2D across the new year, restarting the count on 2 January", "2d", dailyNoNewYear, REGULAR, dailyNoNewYear.findIndex((c) => iso(c.t).startsWith("2025-12-19")), 20],
    ["3D mid-year", "3d", dailyNoNewYear, REGULAR, dailyNoNewYear.findIndex((c) => iso(c.t).startsWith("2026-01-20")), 8],
    ["2W anchored on the epoch week", "2wk", calendar(mondays), { clock: UTC }, 3, 4],
    ["5M restarting in January", "5mo", calendar(firsts), { clock: UTC }, 4, 5],
  ])("future slots for %s land where the aggregated bars later start", (_, interval, base, frame, cut, ahead) => {
    const full = aggregate(base, interval, frame).map((c) => c.t);
    const known = aggregate(base.slice(0, cut), interval, frame).map((c) => c.t);
    const later = full.slice(known.length, known.length + ahead);
    expect(later).toHaveLength(ahead);
    expect(known).toEqual(full.slice(0, known.length));
    expect(futureTimes(known, interval, frame.clock, ahead).map(iso)).toEqual(later.map(iso));
  });
});

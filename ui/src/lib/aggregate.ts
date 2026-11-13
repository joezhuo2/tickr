import { exchangeOffset, scheduleFor, type Clock, type TradingPeriods } from "./session";
import { intervalSpec, isCustom, type Candle, type Chart, type IntervalSpec } from "./types";

const DAY = 86_400;

export interface Frame {
  clock: Clock;
  periods?: TradingPeriods | null;
  extended?: boolean;
}

function localDay(t: number, clock: Clock): number {
  return Math.floor((t + exchangeOffset(t, clock)) / DAY);
}

function dateOf(day: number): Date {
  return new Date(day * DAY * 1000);
}

function sessionBuckets(candles: readonly Candle[], seconds: number, { clock, periods, extended }: Frame): number[] {
  const schedule = scheduleFor(periods, clock);
  const anchor = schedule ? (extended ? schedule.preStart : schedule.regularStart) : 0;
  return candles.map(({ t }) => {
    const since = t + exchangeOffset(t, clock) - anchor;
    const into = since - Math.floor(since / DAY) * DAY;
    return t - into + Math.floor(into / seconds) * seconds;
  });
}

// shortcut: trading days before the first loaded bar of its year are estimated as weekdays, so that year's buckets can shift by its holidays once scroll-back loads them; use an exchange holiday calendar to make them exact
function weekdaysBefore(day: number): number {
  const jan2 = Date.UTC(dateOf(day).getUTCFullYear(), 0, 2) / 1000 / DAY;
  if (day - jan2 < 6) return 0;
  let n = 0;
  for (let d = jan2; d < day; d++) {
    const weekday = (((d + 4) % 7) + 7) % 7;
    if (weekday > 0 && weekday < 6) n++;
  }
  return n;
}

function yearBuckets(candles: readonly Candle[], count: number, clock: Clock): number[] {
  let year = NaN;
  let last = NaN;
  let n = 0;
  return candles.map(({ t }, i) => {
    const day = localDay(t, clock);
    const y = dateOf(day).getUTCFullYear();
    if (y !== year) {
      year = y;
      n = i === 0 ? weekdaysBefore(day) : 0;
    } else if (day !== last) n++;
    last = day;
    return y * 1000 + Math.floor(n / count);
  });
}

function weekBuckets(candles: readonly Candle[], count: number, clock: Clock): number[] {
  return candles.map(({ t }) => Math.floor(Math.floor((localDay(t, clock) - 4) / 7) / count));
}

function monthBuckets(candles: readonly Candle[], count: number, clock: Clock): number[] {
  return candles.map(({ t }) => {
    const d = dateOf(localDay(t, clock));
    return d.getUTCFullYear() * 1000 + Math.floor(d.getUTCMonth() / count);
  });
}

function bucketsFor(candles: readonly Candle[], { count, unit, seconds }: IntervalSpec, frame: Frame): number[] {
  if (unit === "d") return yearBuckets(candles, count, frame.clock);
  if (unit === "wk") return weekBuckets(candles, count, frame.clock);
  if (unit === "mo") return monthBuckets(candles, count, frame.clock);
  return sessionBuckets(candles, seconds, frame);
}

export function aggregate(candles: readonly Candle[], interval: string, frame: Frame): Candle[] {
  const spec = intervalSpec(interval);
  if (!spec) return candles.slice();
  const intraday = spec.unit === "m" || spec.unit === "h";
  const keys = bucketsFor(candles, spec, frame);
  const out: Candle[] = [];
  candles.forEach((c, i) => {
    const bar = out[out.length - 1];
    if (bar && i > 0 && keys[i] === keys[i - 1]) {
      bar.h = Math.max(bar.h, c.h);
      bar.l = Math.min(bar.l, c.l);
      bar.c = c.c;
      bar.v += c.v;
    } else out.push({ t: intraday ? keys[i] : c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
  });
  return out;
}

export function bucketIndex(candles: readonly Candle[], interval: string, frame: Frame): number[] {
  const spec = intervalSpec(interval);
  if (!spec) return candles.map((_, i) => i);
  const keys = bucketsFor(candles, spec, frame);
  let b = -1;
  return keys.map((k, i) => (i > 0 && k === keys[i - 1] ? b : ++b));
}

export function aggregateChart(chart: Chart, interval: string): Chart {
  if (!isCustom(interval) || !intervalSpec(interval)?.bases.includes(chart.interval)) return chart;
  const frame = { clock: { timezone: chart.meta.timezone, gmtoffset: chart.meta.gmtoffset }, periods: chart.meta.periods, extended: chart.extended };
  return { ...chart, interval, candles: aggregate(chart.candles, interval, frame) };
}

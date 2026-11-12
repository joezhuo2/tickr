import { localOffset } from "./freshness";
import { intervalSpec, type ChartTimeZone, type Period } from "./types";

export type Session = "pre" | "regular" | "post" | "closed";

export interface Clock {
  timezone?: string | null;
  gmtoffset: number;
}

export interface TradingPeriods {
  pre: Period;
  regular: Period;
  post: Period;
}

export interface Schedule {
  preStart: number;
  regularStart: number;
  regularEnd: number;
  postEnd: number;
}

const DAY = 86_400;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

const wallClocks = new Map<string, Intl.DateTimeFormat | null>();

function wallClock(zone: string): Intl.DateTimeFormat | null {
  let f = wallClocks.get(zone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      f = null;
    }
    wallClocks.set(zone, f);
  }
  return f;
}

export function offsetAt(t: number, timezone: string | null | undefined, fallback: number): number {
  const f = timezone ? wallClock(timezone) : null;
  if (!f || !Number.isFinite(t)) return fallback;
  const whole = Math.floor(t);
  const parts: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(whole * 1000))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second) / 1000;
  return Number.isFinite(wall) ? wall - whole : fallback;
}

export function exchangeOffset(t: number, clock: Clock): number {
  return offsetAt(t, clock.timezone, clock.gmtoffset);
}

export function isIntraday(interval: string): boolean {
  const unit = intervalSpec(interval)?.unit;
  return unit === "m" || unit === "h";
}

export function displayOffset(t: number, zone: ChartTimeZone, clock: Clock, interval: string, localZone?: string): number {
  if (zone === "local" && isIntraday(interval)) return offsetAt(t, localZone, localOffset(t));
  return exchangeOffset(t, clock);
}

const abbreviations = new Map<string, Intl.DateTimeFormat | null>();

function abbreviation(t: number, zone: string | undefined): string | null {
  const key = zone ?? "";
  let f = abbreviations.get(key);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-US", { ...(zone ? { timeZone: zone } : {}), timeZoneName: "short" });
    } catch {
      f = null;
    }
    abbreviations.set(key, f);
  }
  if (!f || !Number.isFinite(t)) return null;
  return f.formatToParts(new Date(Math.floor(t) * 1000)).find((p) => p.type === "timeZoneName")?.value ?? null;
}

export function offsetLabel(offset: number): string {
  if (offset === 0) return "UTC";
  const minutes = Math.round(Math.abs(offset) / 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `UTC${offset < 0 ? "-" : "+"}${hh}:${mm}`;
}

export function zoneLabel(t: number, zone: ChartTimeZone, clock: Clock, interval: string, localZone?: string): string {
  const local = zone === "local" && isIntraday(interval);
  const name = local ? localZone : (clock.timezone ?? undefined);
  const short = local || name ? abbreviation(t, name) : null;
  return short ?? offsetLabel(displayOffset(t, zone, clock, interval, localZone));
}

export function scheduleFor(periods: TradingPeriods | null | undefined, clock: Clock): Schedule | null {
  if (!periods) return null;
  const { pre, regular, post } = periods;
  if (!(regular.end > regular.start) || regular.end - regular.start >= DAY - 1) return null;
  const at = (t: number) => mod(t + exchangeOffset(t, clock), DAY);
  const regularStart = at(regular.start);
  const regularEnd = at(regular.end);
  return {
    preStart: pre.end > pre.start ? at(pre.start) : regularStart,
    regularStart,
    regularEnd,
    postEnd: post.end > post.start ? at(post.end) : regularEnd,
  };
}

function within(s: number, from: number, to: number): boolean {
  return from <= to ? s >= from && s < to : s >= from || s < to;
}

export function classifySession(t: number, clock: Clock, schedule: Schedule | null): Session {
  if (!schedule) return "regular";
  const s = mod(t + exchangeOffset(t, clock), DAY);
  if (within(s, schedule.regularStart, schedule.regularEnd)) return "regular";
  if (within(s, schedule.preStart, schedule.regularStart)) return "pre";
  if (within(s, schedule.regularEnd, schedule.postEnd)) return "post";
  return "closed";
}

export function classifyBars(times: readonly number[], clock: Clock, periods: TradingPeriods | null | undefined, interval: string): Session[] {
  const schedule = isIntraday(interval) ? scheduleFor(periods, clock) : null;
  return times.map((t) => classifySession(t, clock, schedule));
}

export function isExtendedSession(session: Session): boolean {
  return session !== "regular";
}

function yearOf(day: number): number {
  return new Date(day * DAY * 1000).getUTCFullYear();
}

export function futureTimes(times: readonly number[], interval: string, clock: Clock, count: number): number[] {
  const n = times.length;
  const spec = intervalSpec(interval);
  if (!n || !spec || !(count > 0)) return [];
  const size = spec.count;
  const offsets = new Map<number, number>();
  const off = (t: number) => {
    const hour = Math.floor(t / 3600);
    let o = offsets.get(hour);
    if (o === undefined) offsets.set(hour, (o = exchangeOffset(hour * 3600, clock)));
    return o;
  };
  const last = times[n - 1];
  let open = DAY;
  let close = 0;
  const weekdays = new Set<number>();
  for (let i = n - 1; i >= 0 && times[i] > last - 14 * DAY; i--) {
    const w = times[i] + off(times[i]);
    const tod = mod(w, DAY);
    open = Math.min(open, tod);
    close = Math.max(close, tod);
    weekdays.add(mod(Math.floor(w / DAY) + 4, 7));
  }
  // shortcut: only weekends with no recent bars are skipped, not holidays or early closes; upgrade with an exchange holiday calendar
  const skip = (day: number) => {
    const dow = mod(day + 4, 7);
    return (dow === 0 || dow === 6) && !weekdays.has(dow);
  };
  const lastOffset = off(last);
  let w = last + lastOffset;
  const out: number[] = [];
  while (out.length < count) {
    if (spec.unit === "m" || spec.unit === "h") {
      w += spec.seconds;
      let day = Math.floor(w / DAY);
      let tod = w - day * DAY;
      if (tod > close) { day++; tod = open; }
      else if (tod < open) tod = open;
      while (skip(day)) { day++; tod = open; }
      w = day * DAY + tod;
    } else if (spec.unit === "d") {
      let day = Math.floor(w / DAY);
      const tod = w - day * DAY;
      const year = yearOf(day);
      for (let k = 0; k < size; k++) do day++; while (skip(day));
      if (size > 1 && yearOf(day) !== year) {
        day = Date.UTC(yearOf(day), 0, 2) / 1000 / DAY;
        while (skip(day)) day++;
      }
      w = day * DAY + tod;
    } else if (spec.unit === "wk") {
      const day = Math.floor(w / DAY);
      w = size === 1 ? w + 7 * DAY : ((Math.floor(Math.floor((day - 4) / 7) / size) + 1) * size * 7 + 4 - day) * DAY + w;
    } else {
      const d = new Date(w * 1000);
      const month = Math.floor(d.getUTCMonth() / size) * size + size;
      if (month >= 12) d.setUTCFullYear(d.getUTCFullYear() + 1, 0);
      else d.setUTCMonth(month);
      w = d.getTime() / 1000;
    }
    out.push(w - off(w - lastOffset));
  }
  return out;
}

/** Time left in the candle that started at `lastBar`, as m:ss; null when that candle is not forming now. */
export function candleCountdown(interval: string, lastBar: number | undefined, now: number): string | null {
  const length = intervalSpec(interval)?.seconds;
  if (!isIntraday(interval) || lastBar == null || !length) return null;
  const left = Math.ceil(lastBar + length - now);
  if (!(left > 0 && left <= length)) return null;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

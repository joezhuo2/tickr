import { localOffset } from "./freshness";
import type { ChartTimeZone, Period } from "./types";

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
  return /\dm$/.test(interval);
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

/** Time left in the candle that started at `lastBar`, as m:ss; null when that candle is not forming now. */
export function candleCountdown(interval: string, lastBar: number | undefined, now: number): string | null {
  if (!isIntraday(interval) || lastBar == null) return null;
  const length = parseInt(interval) * 60;
  const left = Math.ceil(lastBar + length - now);
  if (!(left > 0 && left <= length)) return null;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

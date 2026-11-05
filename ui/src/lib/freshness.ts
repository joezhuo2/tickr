import type { Chart, Quote, Session } from "./types";

export type FreshnessState = "fresh" | "stale" | "closed" | "unknown";
export type StatusKind = "live" | "delayed" | "recent" | "stale" | "closed" | "unknown" | "offline" | "loading";

export interface Reading {
  state: FreshnessState;
  time: number | null;
  age: number | null;
  limit: number | null;
}

export interface Status {
  kind: StatusKind;
  text: string;
}

export interface Segment {
  text: string;
  stale: boolean;
}

export interface StaleContext {
  source: string;
  error?: string | null;
  stream?: string | null;
  lowPower?: boolean;
  delay?: number | null;
}

export const LIVE_SECS = 90;
export const QUOTE_LIMIT_SECS = { regular: 300, extended: 900 };
export const UNKNOWN_DELAY_SECS = 900;
export const CHART_GRACE_SECS = 120;

const DAY = 86400;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UNITS: Record<string, number> = { m: 60, h: 3600, d: DAY, wk: 7 * DAY, mo: 30 * DAY };

export function knownDelay(delay: number | null | undefined): number | null {
  return typeof delay === "number" && Number.isFinite(delay) && delay >= 0 ? delay : null;
}

export function formatAge(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "unknown";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < DAY) {
    const m = Math.floor((s % 3600) / 60);
    return m ? `${Math.floor(s / 3600)} h ${m} min` : `${Math.floor(s / 3600)} h`;
  }
  return `${Math.floor(s / DAY)} d`;
}

export function delayLabel(delay: number | null | undefined): string {
  const d = knownDelay(delay);
  if (d === null) return "delay unknown";
  return d === 0 ? "real time" : `~${formatAge(d)} delayed`;
}

export function sourceName(source: string): string {
  if (source === "alpaca-iex") return "Alpaca IEX";
  if (source === "alpaca-sip") return "Alpaca SIP";
  return "Yahoo";
}

export function localOffset(t: number): number {
  return -new Date(t * 1000).getTimezoneOffset() * 60;
}

export function intervalSeconds(interval: string): number | null {
  const m = /^(\d+)(m|h|d|wk|mo)$/.exec(interval);
  return m ? Number(m[1]) * UNITS[m[2]] : null;
}

function validTime(t: number | null | undefined): t is number {
  return typeof t === "number" && Number.isFinite(t) && t > 0;
}

export function quoteTime(quote: Pick<Quote, "market_time" | "extended">): number | null {
  const times = [quote.market_time, quote.extended?.t].filter(validTime);
  return times.length ? Math.max(...times) : null;
}

export function chartTime(chart: Pick<Chart, "candles" | "last_bar_time">): number | null {
  if (validTime(chart.last_bar_time)) return chart.last_bar_time;
  const last = chart.candles.at(-1)?.t;
  return validTime(last) ? last : null;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

export function clock(t: number, offset: number, seconds = false): string {
  const d = new Date((t + offset) * 1000);
  const hm = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  return seconds ? `${hm}:${two(d.getUTCSeconds())}` : hm;
}

export function asOf(t: number, now: number, offset: number, seconds = false): string {
  const days = Math.floor((now + offset) / DAY) - Math.floor((t + offset) / DAY);
  const time = clock(t, offset, seconds);
  if (days <= 0) return time;
  const d = new Date((t + offset) * 1000);
  if (days < 7) return `${DAYS[d.getUTCDay()]} ${time}`;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${time}`;
}

function make(time: number | null, now: number, state: FreshnessState, limit: number | null): Reading {
  return { state, time, age: time === null ? null : Math.max(0, now - time), limit };
}

export interface QuoteInput {
  time: number | null;
  session: Session | null;
  now: number;
  delay?: number | null;
}

export function classifyQuote({ time, session, now, delay }: QuoteInput): Reading {
  if (session === null) return make(time, now, "unknown", null);
  if (session === "closed") return make(time, now, "closed", null);
  const limit = QUOTE_LIMIT_SECS[session === "regular" ? "regular" : "extended"] + (knownDelay(delay) ?? UNKNOWN_DELAY_SECS);
  if (time === null) return make(time, now, "unknown", limit);
  return make(time, now, now - time > limit ? "stale" : "fresh", limit);
}

export interface ChartInput {
  time: number | null;
  interval: string;
  session: Session | null;
  now: number;
  delay?: number | null;
}

export function classifyChart({ time, interval, session, now, delay }: ChartInput): Reading {
  if (session === null) return make(time, now, "unknown", null);
  if (session !== "regular") return make(time, now, "closed", null);
  const step = intervalSeconds(interval);
  if (step === null) return make(time, now, "unknown", null);
  const limit = step < DAY ? 2 * step + (knownDelay(delay) ?? UNKNOWN_DELAY_SECS) + CHART_GRACE_SECS : step + DAY;
  if (time === null) return make(time, now, "unknown", limit);
  return make(time, now, now - time > limit ? "stale" : "fresh", limit);
}

export interface StatusInput {
  hasQuote: boolean;
  error: string | null;
  reading: Reading | null;
  session: Session | null;
  delay?: number | null;
  now: number;
  offset: number;
}

export function quoteStatus({ hasQuote, error, reading, session, delay, now, offset }: StatusInput): Status {
  if (error && !hasQuote) return { kind: "offline", text: `Offline: ${error}` };
  if (!hasQuote || !reading) return { kind: "loading", text: "Loading…" };
  if (error) return { kind: "stale", text: `Stale: ${error}` };
  switch (reading.state) {
    case "closed":
      return { kind: "closed", text: reading.time === null ? "Closed" : `Closed, as of ${asOf(reading.time, now, offset)}` };
    case "unknown":
      return { kind: "unknown", text: "Quote time unknown" };
    case "stale":
      return { kind: "stale", text: `Stale: quote ${formatAge(reading.age)} old` };
  }
  const d = knownDelay(delay);
  if (d === null) return { kind: "recent", text: `Last trade ${formatAge(reading.age)} ago` };
  if (d > 0) return { kind: "delayed", text: `Delayed ~${formatAge(d)}` };
  if (session === "regular" && (reading.age ?? Infinity) <= LIVE_SECS) return { kind: "live", text: "Live" };
  return { kind: "recent", text: `Last trade ${formatAge(reading.age)} ago` };
}

export function quoteSegment(r: Reading | null, now: number, offset: number): Segment | null {
  if (!r) return null;
  if (r.time === null) return { text: "Quote time unknown", stale: false };
  const stale = r.state === "stale";
  return { text: `Quote ${asOf(r.time, now, offset, true)}${stale ? " (stale)" : ""}`, stale };
}

export function chartSegment(r: Reading | null, interval: string, now: number, offset: number, via: string | null = null): Segment | null {
  if (!r) return null;
  const suffix = via ? ` (${via})` : "";
  if (r.time === null) return { text: `Chart time unknown${suffix}`, stale: false };
  const stale = r.state === "stale";
  return { text: `Chart ${chartLabel(r.time, interval, now, offset)}${stale ? " (stale)" : ""}${suffix}`, stale };
}

function chartLabel(t: number, interval: string, now: number, offset: number): string {
  const step = intervalSeconds(interval);
  if (step === null || step < DAY) return asOf(t, now, offset);
  const d = new Date((t + offset) * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function reason(kind: "quote" | "chart", ctx: StaleContext): string {
  if (ctx.error) return `Last refresh failed: ${ctx.error}.`;
  if (ctx.source.startsWith("alpaca") && ctx.stream && ctx.stream !== "live") return `The Alpaca stream is ${ctx.stream}.`;
  if (kind === "chart" && ctx.lowPower) return "Low-power mode refreshes the chart less often.";
  const d = knownDelay(ctx.delay);
  const delay = d === null ? "Delay unknown." : d > 0 ? `Source is ${delayLabel(d)}.` : "";
  return `${sourceName(ctx.source)} has not reported a newer ${kind === "quote" ? "trade" : "bar"}.${delay ? ` ${delay}` : ""}`;
}

export function quoteNote(r: Reading | null, now: number, offset: number, ctx: StaleContext): string | null {
  if (!r || r.state !== "stale" || r.time === null) return null;
  return `Quote is ${formatAge(r.age)} old (last trade ${asOf(r.time, now, offset, true)}). ${reason("quote", ctx)}`;
}

export function chartNote(r: Reading | null, interval: string, now: number, offset: number, ctx: StaleContext): string | null {
  if (!r || r.state !== "stale" || r.time === null) return null;
  return `Chart is stale: latest bar ${chartLabel(r.time, interval, now, offset)}, ${formatAge(r.age)} old. ${reason("chart", ctx)}`;
}

import type { EventFilter, EventImportance, MarketEvent, WatchDates } from "./types";

export const DEFAULT_EVENT_FILTER: EventFilter = { countries: ["US"], importance: "all" };

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function dayMs(day: string): number | null {
  if (!DAY_PATTERN.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(day) ? ms : null;
}

export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(day: string, days: number): string {
  const ms = dayMs(day);
  if (ms === null) throw new RangeError(`Invalid day ${day}`);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysUntil(day: string, today: string): number | null {
  const at = dayMs(day);
  const from = dayMs(today);
  if (at === null || from === null || at < from) return null;
  return Math.round((at - from) / DAY_MS);
}

export interface WeekRange {
  start: string;
  last: string;
  end: string;
}

const REACH_DAYS = 360;

export function canShift(start: string, today: string, weeks: number): boolean {
  const target = dayMs(addDays(start, weeks * 7));
  const now = dayMs(today);
  return target !== null && now !== null && Math.abs(target - now) <= REACH_DAYS * DAY_MS;
}

export function weekRange(today: string, offset: number): WeekRange {
  const start = addDays(today, offset * 7);
  return { start, last: addDays(start, 6), end: addDays(start, 7) };
}

export function formatDay(day: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }, locale?: string): string {
  const ms = dayMs(day);
  return ms === null ? day : new Date(ms).toLocaleDateString(locale, { ...options, timeZone: "UTC" });
}

export function rangeLabel(range: WeekRange, locale?: string): string {
  const withYear = range.start.slice(0, 4) !== range.last.slice(0, 4);
  const first = formatDay(range.start, withYear ? { month: "short", day: "numeric", year: "numeric" } : undefined, locale);
  const last = formatDay(range.last, withYear ? { month: "short", day: "numeric", year: "numeric" } : undefined, locale);
  return `${first} – ${last}`;
}

const KEY_RELEASES: RegExp[] = [
  /\bnon-?farm payrolls?\b/i,
  /\b(unemployment|jobless) rate\b/i,
  /^initial jobless clm/i,
  /\b(cpi|hicp)\b/i,
  /\bpce\b/i,
  /^gdp\b/i,
  /^retail sales\b/i,
  /rate decision|\bbank rate\b|fed funds|^interest rate\b|^fomc\b|^riksbank rate/i,
  /\bpmi\b/i,
  /\bppi\b|producer price/i,
  /^(consumer confidence|consumer sentiment|u mich sentiment)/i,
  /\bjolts\b|job openings/i,
];

const NOT_KEY = /^cleveland\b|\bfcst\b|\bsvy\b|capital|external|consmp/i;

export function isKeyRelease(name: string): boolean {
  const clean = name.replace(/\*/g, "").trim();
  return !NOT_KEY.test(clean) && KEY_RELEASES.some((p) => p.test(clean));
}

export function filterEvents(events: MarketEvent[], filter: EventFilter): MarketEvent[] {
  const countries = new Set(filter.countries);
  return events.filter((e) => (countries.size === 0 || countries.has(e.country)) && (filter.importance === "all" || isKeyRelease(e.name)));
}

export function countryOptions(events: MarketEvent[], selected: string[]): string[] {
  return [...new Set([...events.map((e) => e.country), ...selected].filter(Boolean))].sort();
}

export function toggleCountry(filter: EventFilter, code: string, options: string[]): EventFilter {
  const base = filter.countries.length === 0 ? options : filter.countries;
  if (!base.includes(code)) return { ...filter, countries: [...base, code].sort() };
  const countries = base.filter((c) => c !== code);
  return countries.length === 0 ? filter : { ...filter, countries };
}

export function setCountries(filter: EventFilter, countries: string[]): EventFilter {
  return { ...filter, countries: [...new Set(countries)].sort() };
}

export function setImportance(filter: EventFilter, importance: EventImportance): EventFilter {
  return { ...filter, importance };
}

export function sameFilter(a: EventFilter, b: EventFilter): boolean {
  return a.importance === b.importance && a.countries.length === b.countries.length && a.countries.every((c, i) => c === b.countries[i]);
}

export function countrySummary(filter: EventFilter): string {
  const n = filter.countries.length;
  if (n === 0) return "All countries";
  return n <= 3 ? filter.countries.join(", ") : `${n} countries`;
}

export function countryName(code: string, locale?: string): string {
  try {
    return new Intl.DisplayNames(locale, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface DayGroup<T> {
  key: string;
  items: T[];
}

export function groupByDay<T extends { at: number }>(items: T[], offsetFor: (t: number) => number): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const item of [...items].sort((a, b) => a.at - b.at)) {
    const key = new Date((item.at + offsetFor(item.at)) * 1000).toISOString().slice(0, 10);
    if (out.at(-1)?.key !== key) out.push({ key, items: [] });
    out[out.length - 1].items.push(item);
  }
  return out;
}

export type WatchKind = "earnings" | "dividend";
export type WatchKindFilter = "all" | WatchKind;

export interface WatchEntry {
  id: string;
  symbol: string;
  kind: WatchKind;
  date: string;
  estimated: boolean;
  eps: number | null;
}

export function watchEntries(dates: WatchDates[], today: string): WatchEntry[] {
  const out: WatchEntry[] = [];
  for (const d of dates) {
    const e = d.earnings;
    if (e && dayMs(e.date) !== null && e.date >= today) {
      out.push({ id: `${d.symbol}-earnings-${e.date}`, symbol: d.symbol, kind: "earnings", date: e.date, estimated: !!e.estimated, eps: e.eps_estimate ?? null });
    }
    if (d.ex_dividend && dayMs(d.ex_dividend) !== null && d.ex_dividend >= today) {
      out.push({ id: `${d.symbol}-dividend-${d.ex_dividend}`, symbol: d.symbol, kind: "dividend", date: d.ex_dividend, estimated: false, eps: null });
    }
  }
  const rank = (k: WatchKind) => (k === "earnings" ? 0 : 1);
  return out.sort((a, b) => a.date.localeCompare(b.date) || rank(a.kind) - rank(b.kind) || a.symbol.localeCompare(b.symbol));
}

export function filterKind(entries: WatchEntry[], kind: WatchKindFilter): WatchEntry[] {
  return kind === "all" ? entries : entries.filter((e) => e.kind === kind);
}

export function groupByDate(entries: WatchEntry[]): DayGroup<WatchEntry>[] {
  const out: DayGroup<WatchEntry>[] = [];
  for (const e of entries) {
    if (out.at(-1)?.key !== e.date) out.push({ key: e.date, items: [] });
    out[out.length - 1].items.push(e);
  }
  return out;
}

export function failedSymbols(dates: WatchDates[]): string[] {
  return dates.filter((d) => d.error).map((d) => d.symbol);
}

export type EventsTab = "economic" | "watchlist" | "calendar";

export type CalendarItem = { kind: "macro"; id: string; event: MarketEvent } | { kind: "watch"; id: string; entry: WatchEntry };

export function mergeCalendar(
  events: MarketEvent[],
  entries: WatchEntry[],
  range: WeekRange,
  filter: EventFilter,
  offsetFor: (t: number) => number,
): DayGroup<CalendarItem>[] {
  const macro = groupByDay(filterEvents(events, filter), offsetFor);
  const watch = groupByDate(entries.filter((e) => e.date >= range.start && e.date < range.end));
  const keys = [...new Set([...macro, ...watch].map((g) => g.key))].sort();
  return keys.map((key) => ({
    key,
    items: [
      ...(watch.find((g) => g.key === key)?.items ?? []).map((entry): CalendarItem => ({ kind: "watch", id: entry.id, entry })),
      ...(macro.find((g) => g.key === key)?.items ?? []).map((event): CalendarItem => ({ kind: "macro", id: event.id, event })),
    ],
  }));
}

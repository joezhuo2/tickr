import { describe, expect, it } from "vitest";
import {
  asOf,
  chartNote,
  chartSegment,
  chartTime,
  classifyChart,
  classifyQuote,
  clock,
  delayLabel,
  formatAge,
  intervalSeconds,
  knownDelay,
  quoteNote,
  quoteSegment,
  quoteStatus,
  quoteTime,
  sourceName,
  type Reading,
} from "./freshness";

const at = (h: number, m: number, s = 0, day = 4) => Date.UTC(2026, 10, day, h, m, s) / 1000;
const now = at(14, 40);
const ctx = { source: "yahoo" };

describe("age formatting", () => {
  it("formats seconds, minutes, hours and days", () => {
    expect(formatAge(0)).toBe("0 s");
    expect(formatAge(59.9)).toBe("59 s");
    expect(formatAge(60)).toBe("1 min");
    expect(formatAge(900)).toBe("15 min");
    expect(formatAge(3600)).toBe("1 h");
    expect(formatAge(3900)).toBe("1 h 5 min");
    expect(formatAge(86400 * 3 + 5)).toBe("3 d");
  });

  it("clamps negatives and reports unknown values", () => {
    expect(formatAge(-30)).toBe("0 s");
    expect(formatAge(null)).toBe("unknown");
    expect(formatAge(undefined)).toBe("unknown");
    expect(formatAge(Number.NaN)).toBe("unknown");
  });
});

describe("known delay", () => {
  it("treats missing or invalid delays as unknown", () => {
    for (const d of [null, undefined, -1, Number.NaN]) {
      expect(knownDelay(d)).toBeNull();
      expect(delayLabel(d)).toBe("delay unknown");
    }
  });

  it("labels real time and delayed sources", () => {
    expect(delayLabel(0)).toBe("real time");
    expect(delayLabel(900)).toBe("~15 min delayed");
    expect(delayLabel(1200)).toBe("~20 min delayed");
  });

  it("names the sources", () => {
    expect(sourceName("yahoo")).toBe("Yahoo");
    expect(sourceName("alpaca-iex")).toBe("Alpaca IEX");
    expect(sourceName("alpaca-sip")).toBe("Alpaca SIP");
  });
});

describe("timestamps", () => {
  it("uses the later of the trade and extended-hours times", () => {
    expect(quoteTime({ market_time: at(14, 0), extended: null })).toBe(at(14, 0));
    expect(quoteTime({ market_time: at(14, 0), extended: { label: "", price: 1, change: 0, change_pct: 0, t: at(14, 5) } })).toBe(at(14, 5));
    expect(quoteTime({ market_time: 0, extended: { label: "", price: 1, change: 0, change_pct: 0, t: at(14, 5) } })).toBe(at(14, 5));
  });

  it("returns null for missing quote times", () => {
    expect(quoteTime({ market_time: 0, extended: null })).toBeNull();
    expect(quoteTime({ market_time: Number.NaN, extended: null })).toBeNull();
  });

  it("reads the last bar, falling back to the candles for older payloads", () => {
    const candle = (t: number) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });
    expect(chartTime({ candles: [candle(5)], last_bar_time: 9 })).toBe(9);
    expect(chartTime({ candles: [candle(5), candle(7)] })).toBe(7);
    expect(chartTime({ candles: [], last_bar_time: null })).toBeNull();
    expect(chartTime({ candles: [], last_bar_time: 0 })).toBeNull();
  });

  it("parses chart intervals", () => {
    expect(intervalSeconds("1m")).toBe(60);
    expect(intervalSeconds("60m")).toBe(3600);
    expect(intervalSeconds("1d")).toBe(86400);
    expect(intervalSeconds("1wk")).toBe(604800);
    expect(intervalSeconds("auto")).toBeNull();
  });

  it("formats clock times in the given offset", () => {
    expect(clock(at(14, 32, 5), 0, true)).toBe("14:32:05");
    expect(clock(at(14, 32, 5), 0)).toBe("14:32");
    expect(clock(at(14, 32, 5), -4 * 3600)).toBe("10:32");
  });

  it("adds the day only when the time is not today", () => {
    expect(asOf(at(14, 32, 5), now, 0, true)).toBe("14:32:05");
    expect(asOf(at(20, 0, 0, 2), now, 0)).toBe("Mon 20:00");
    expect(asOf(at(20, 0, 0, 2) - 20 * 86400, now, 0)).toBe("Oct 13 20:00");
    expect(asOf(now + 600, now, 0)).toBe("14:50");
  });
});

describe("quote freshness", () => {
  it("is fresh within the regular-session limit and stale after it", () => {
    expect(classifyQuote({ time: at(14, 38), session: "regular", now, delay: 0 })).toEqual({ state: "fresh", time: at(14, 38), age: 120, limit: 300 });
    expect(classifyQuote({ time: at(14, 35), session: "regular", now, delay: 0 }).state).toBe("fresh");
    expect(classifyQuote({ time: at(14, 34, 59), session: "regular", now, delay: 0 }).state).toBe("stale");
  });

  it("allows for the source delay, known or assumed", () => {
    expect(classifyQuote({ time: at(14, 20), session: "regular", now, delay: 900 }).state).toBe("fresh");
    expect(classifyQuote({ time: at(14, 10), session: "regular", now, delay: 900 }).state).toBe("stale");
    expect(classifyQuote({ time: at(14, 20), session: "regular", now, delay: null })).toMatchObject({ state: "fresh", limit: 1200 });
    expect(classifyQuote({ time: at(14, 10), session: "regular", now }).state).toBe("stale");
  });

  it("uses a looser limit in extended hours", () => {
    expect(classifyQuote({ time: at(14, 30), session: "pre", now, delay: 0 })).toMatchObject({ state: "fresh", limit: 900 });
    expect(classifyQuote({ time: at(14, 20), session: "post", now, delay: 0 }).state).toBe("stale");
  });

  it("never reports stale while the market is closed", () => {
    expect(classifyQuote({ time: at(10, 0, 0, 2), session: "closed", now, delay: 0 })).toMatchObject({ state: "closed", limit: null });
    expect(classifyQuote({ time: null, session: "closed", now }).state).toBe("closed");
  });

  it("is unknown without a timestamp or session", () => {
    expect(classifyQuote({ time: null, session: "regular", now, delay: 0 })).toMatchObject({ state: "unknown", time: null, age: null });
    expect(classifyQuote({ time: at(14, 39), session: null, now }).state).toBe("unknown");
  });

  it("treats a timestamp ahead of the clock as zero age", () => {
    expect(classifyQuote({ time: now + 30, session: "regular", now, delay: 0 })).toMatchObject({ state: "fresh", age: 0 });
  });
});

describe("chart freshness", () => {
  it("allows two missed bars plus grace and delay", () => {
    expect(classifyChart({ time: at(14, 30), interval: "5m", session: "regular", now, delay: 0 })).toEqual({ state: "fresh", time: at(14, 30), age: 600, limit: 720 });
    expect(classifyChart({ time: at(14, 27), interval: "5m", session: "regular", now, delay: 0 }).state).toBe("stale");
    expect(classifyChart({ time: at(14, 27), interval: "5m", session: "regular", now, delay: 900 }).state).toBe("fresh");
  });

  it("assumes the longer allowance when the delay is unknown", () => {
    expect(classifyChart({ time: at(14, 22), interval: "1m", session: "regular", now, delay: null })).toMatchObject({ state: "fresh", limit: 1140 });
    expect(classifyChart({ time: at(14, 22), interval: "1m", session: "regular", now, delay: 0 }).state).toBe("stale");
  });

  it("measures daily and longer bars in days", () => {
    expect(classifyChart({ time: at(13, 30), interval: "1d", session: "regular", now, delay: 0 }).state).toBe("fresh");
    expect(classifyChart({ time: at(13, 30, 0, 2), interval: "1d", session: "regular", now, delay: 0 }).state).toBe("stale");
    expect(classifyChart({ time: at(13, 30, 0, 2), interval: "1wk", session: "regular", now, delay: 0 }).state).toBe("fresh");
  });

  it("is closed outside the regular session", () => {
    for (const session of ["pre", "post", "closed"] as const) {
      expect(classifyChart({ time: at(10, 0, 0, 2), interval: "5m", session, now, delay: 0 }).state).toBe("closed");
    }
  });

  it("is unknown without a timestamp, session or known interval", () => {
    expect(classifyChart({ time: null, interval: "5m", session: "regular", now }).state).toBe("unknown");
    expect(classifyChart({ time: at(14, 30), interval: "5m", session: null, now }).state).toBe("unknown");
    expect(classifyChart({ time: at(14, 30), interval: "auto", session: "regular", now }).state).toBe("unknown");
  });
});

const fresh = (age: number): Reading => ({ state: "fresh", time: now - age, age, limit: 300 });

describe("status", () => {
  const base = { hasQuote: true, error: null, session: "regular" as const, delay: 0, now, offset: 0 };

  it("is live only for a recent real-time quote in the regular session", () => {
    expect(quoteStatus({ ...base, reading: fresh(10) })).toEqual({ kind: "live", text: "Live" });
    expect(quoteStatus({ ...base, reading: fresh(90) }).kind).toBe("live");
    expect(quoteStatus({ ...base, reading: fresh(91) })).toEqual({ kind: "recent", text: "Last trade 1 min ago" });
    expect(quoteStatus({ ...base, session: "pre", reading: fresh(10) }).kind).toBe("recent");
  });

  it("is never live for delayed or unknown-delay sources", () => {
    expect(quoteStatus({ ...base, delay: 900, reading: fresh(10) })).toEqual({ kind: "delayed", text: "Delayed ~15 min" });
    expect(quoteStatus({ ...base, delay: null, reading: fresh(10) })).toEqual({ kind: "recent", text: "Last trade 10 s ago" });
    expect(quoteStatus({ ...base, delay: undefined, reading: fresh(10) }).kind).toBe("recent");
  });

  it("is not live just because a fetch succeeded", () => {
    const stale: Reading = { state: "stale", time: now - 1800, age: 1800, limit: 300 };
    expect(quoteStatus({ ...base, reading: stale })).toEqual({ kind: "stale", text: "Stale: quote 30 min old" });
  });

  it("shows when the market closed", () => {
    const closed: Reading = { state: "closed", time: at(20, 0, 0, 3), age: 100000, limit: null };
    expect(quoteStatus({ ...base, session: "closed", reading: closed })).toEqual({ kind: "closed", text: "Closed, as of Tue 20:00" });
    const today: Reading = { state: "closed", time: at(13, 0), age: 100, limit: null };
    expect(quoteStatus({ ...base, session: "closed", reading: today }).text).toBe("Closed, as of 13:00");
    expect(quoteStatus({ ...base, session: "closed", reading: { state: "closed", time: null, age: null, limit: null } }).text).toBe("Closed");
  });

  it("reports unknown timestamps", () => {
    expect(quoteStatus({ ...base, reading: { state: "unknown", time: null, age: null, limit: 300 } })).toEqual({ kind: "unknown", text: "Quote time unknown" });
  });

  it("reports errors and loading", () => {
    expect(quoteStatus({ ...base, hasQuote: false, error: "rate limited", reading: null })).toEqual({ kind: "offline", text: "Offline: rate limited" });
    expect(quoteStatus({ ...base, hasQuote: false, reading: null })).toEqual({ kind: "loading", text: "Loading…" });
    expect(quoteStatus({ ...base, error: "network", reading: fresh(10) })).toEqual({ kind: "stale", text: "Stale: network" });
  });
});

describe("footer segments", () => {
  it("shows the quote and chart times separately", () => {
    const quote = classifyQuote({ time: at(14, 32, 5), session: "regular", now, delay: 900 });
    const chart = classifyChart({ time: at(14, 30), interval: "5m", session: "regular", now, delay: 900 });
    expect(quoteSegment(quote, now, 0)).toEqual({ text: "Quote 14:32:05", stale: false });
    expect(chartSegment(chart, "5m", now, 0)).toEqual({ text: "Chart 14:30", stale: false });
  });

  it("marks each one stale on its own", () => {
    const quote = classifyQuote({ time: at(14, 39), session: "regular", now, delay: 0 });
    const chart = classifyChart({ time: at(14, 0), interval: "5m", session: "regular", now, delay: 0 });
    expect(quoteSegment(quote, now, 0)).toEqual({ text: "Quote 14:39:00", stale: false });
    expect(chartSegment(chart, "5m", now, 0)).toEqual({ text: "Chart 14:00 (stale)", stale: true });
    const oldQuote = classifyQuote({ time: at(14, 0), session: "regular", now, delay: 0 });
    const freshChart = classifyChart({ time: at(14, 40), interval: "5m", session: "regular", now, delay: 0 });
    expect(quoteSegment(oldQuote, now, 0)).toEqual({ text: "Quote 14:00:00 (stale)", stale: true });
    expect(chartSegment(freshChart, "5m", now, 0)?.stale).toBe(false);
  });

  it("does not mark anything stale while closed", () => {
    const quote = classifyQuote({ time: at(21, 0, 0, 3), session: "closed", now, delay: 0 });
    const chart = classifyChart({ time: at(20, 55, 0, 3), interval: "5m", session: "closed", now, delay: 0 });
    expect(quoteSegment(quote, now, 0)).toEqual({ text: "Quote Tue 21:00:00", stale: false });
    expect(chartSegment(chart, "5m", now, 0)).toEqual({ text: "Chart Tue 20:55", stale: false });
  });

  it("handles unknown timestamps, daily bars and a differing chart source", () => {
    expect(quoteSegment(classifyQuote({ time: null, session: "regular", now }), now, 0)).toEqual({ text: "Quote time unknown", stale: false });
    expect(chartSegment(classifyChart({ time: null, interval: "5m", session: "regular", now }), "5m", now, 0, "Yahoo")).toEqual({ text: "Chart time unknown (Yahoo)", stale: false });
    expect(chartSegment(classifyChart({ time: at(13, 30), interval: "1d", session: "regular", now, delay: 0 }), "1d", now, 0)).toEqual({ text: "Chart Nov 4", stale: false });
    expect(quoteSegment(null, now, 0)).toBeNull();
    expect(chartSegment(null, "5m", now, 0)).toBeNull();
  });
});

describe("stale notes", () => {
  const staleQuote = classifyQuote({ time: at(14, 10), session: "regular", now, delay: 0 });
  const staleChart = classifyChart({ time: at(14, 0), interval: "5m", session: "regular", now, delay: 0 });

  it("explains a stale quote and the reason", () => {
    expect(quoteNote(staleQuote, now, 0, { ...ctx, delay: 0 })).toBe("Quote is 30 min old (last trade 14:10:00). Yahoo has not reported a newer trade.");
    expect(quoteNote(staleQuote, now, 0, { ...ctx, delay: null })).toBe("Quote is 30 min old (last trade 14:10:00). Yahoo has not reported a newer trade. Delay unknown.");
    expect(quoteNote(staleQuote, now, 0, { ...ctx, delay: 900 })).toContain("Source is ~15 min delayed.");
  });

  it("prefers a failed refresh or a down stream as the reason", () => {
    expect(quoteNote(staleQuote, now, 0, { ...ctx, error: "network" })).toContain("Last refresh failed: network.");
    expect(quoteNote(staleQuote, now, 0, { source: "alpaca-iex", stream: "retrying", delay: 0 })).toContain("The Alpaca stream is retrying.");
    expect(quoteNote(staleQuote, now, 0, { source: "alpaca-iex", stream: "live", delay: 0 })).toContain("Alpaca IEX has not reported a newer trade.");
  });

  it("explains a stale chart", () => {
    expect(chartNote(staleChart, "5m", now, 0, { ...ctx, delay: 0 })).toBe("Chart is stale: latest bar 14:00, 40 min old. Yahoo has not reported a newer bar.");
    expect(chartNote(staleChart, "5m", now, 0, { ...ctx, lowPower: true })).toContain("Low-power mode refreshes the chart less often.");
  });

  it("has no note unless the reading is stale", () => {
    expect(quoteNote(fresh(10), now, 0, ctx)).toBeNull();
    expect(quoteNote(null, now, 0, ctx)).toBeNull();
    expect(quoteNote(classifyQuote({ time: at(10, 0, 0, 2), session: "closed", now }), now, 0, ctx)).toBeNull();
    expect(chartNote(classifyChart({ time: at(10, 0, 0, 2), interval: "5m", session: "closed", now }), "5m", now, 0, ctx)).toBeNull();
    expect(chartNote(classifyChart({ time: null, interval: "5m", session: "regular", now }), "5m", now, 0, ctx)).toBeNull();
  });
});

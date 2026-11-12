import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENT_FILTER,
  addDays,
  canShift,
  countryName,
  countryOptions,
  countrySummary,
  dayMs,
  daysUntil,
  failedSymbols,
  filterEvents,
  filterKind,
  formatDay,
  groupByDate,
  groupByDay,
  importanceOf,
  mergeCalendar,
  localDay,
  rangeLabel,
  sameFilter,
  setCountries,
  setImportance,
  toggleCountry,
  watchEntries,
  weekRange,
} from "./calendar";
import type { EventFilter, MarketEvent, WatchDates } from "./types";

const event = (name: string, country: string, at = 1_793_631_600): MarketEvent => ({
  id: `${at}-${country}-${name}`,
  name,
  country,
  at,
  period: null,
  actual: null,
  expected: null,
  prior: null,
  revised: null,
});

const dates = (symbol: string, p: Partial<WatchDates> = {}): WatchDates => ({ symbol, earnings: null, ex_dividend: null, error: null, ...p });

describe("days", () => {
  it("validates YYYY-MM-DD", () => {
    expect(dayMs("2026-11-04")).toBe(Date.UTC(2026, 10, 4));
    expect(dayMs("2024-02-29")).toBe(Date.UTC(2024, 1, 29));
    for (const bad of ["", "soon", "2026-02-30", "2026-13-01", "2026-1-01", "20261104", "2026-11-04T00:00", "2025-02-29"]) {
      expect(dayMs(bad), bad).toBeNull();
    }
  });

  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-11-04", 7)).toBe("2026-11-11");
    expect(addDays("2026-11-04", -7)).toBe("2026-10-28");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDays("2026-11-04", 0)).toBe("2026-11-04");
  });

  it("rejects an invalid day", () => {
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });

  it("formats the local day with padding", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDay(new Date(2026, 10, 14, 0, 0))).toBe("2026-11-14");
  });

  it("formats days in UTC and tolerates junk", () => {
    expect(formatDay("2026-11-04", undefined, "en-US")).toBe("Nov 4");
    expect(formatDay("2026-11-04", { weekday: "short", month: "short", day: "numeric" }, "en-US")).toBe("Wed, Nov 4");
    expect(formatDay("junk")).toBe("junk");
  });
});

describe("daysUntil", () => {
  it("counts calendar days ahead and is blank for past or bad dates", () => {
    expect(daysUntil("2026-11-10", "2026-11-10")).toBe(0);
    expect(daysUntil("2026-11-11", "2026-11-10")).toBe(1);
    expect(daysUntil("2027-01-05", "2026-12-30")).toBe(6);
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
    expect(daysUntil("2026-11-09", "2026-11-10")).toBeNull();
    expect(daysUntil("2026-02-30", "2026-02-01")).toBeNull();
    expect(daysUntil("soon", "2026-11-10")).toBeNull();
  });
});

describe("canShift", () => {
  it("allows moving about a year either way", () => {
    expect(canShift("2026-11-04", "2026-11-04", 1)).toBe(true);
    expect(canShift("2026-11-04", "2026-11-04", -1)).toBe(true);
    expect(canShift("2027-10-20", "2026-11-04", 1)).toBe(true);
    expect(canShift("2027-10-27", "2026-11-04", 1)).toBe(false);
    expect(canShift("2026-01-01", "2026-11-04", -1)).toBe(true);
    expect(canShift("2025-11-14", "2026-11-04", -1)).toBe(false);
  });
});

describe("weekRange", () => {
  it("starts today at offset 0 and spans seven days", () => {
    expect(weekRange("2026-11-04", 0)).toEqual({ start: "2026-11-04", last: "2026-11-10", end: "2026-11-11" });
  });

  it("moves by whole weeks in both directions", () => {
    expect(weekRange("2026-11-04", 1)).toEqual({ start: "2026-11-11", last: "2026-11-17", end: "2026-11-18" });
    expect(weekRange("2026-11-04", -1)).toEqual({ start: "2026-10-28", last: "2026-11-03", end: "2026-11-04" });
    expect(weekRange("2026-11-04", -2).end).toBe(weekRange("2026-11-04", -1).start);
  });

  it("labels the range, adding years only when they differ", () => {
    expect(rangeLabel(weekRange("2026-11-04", 0), "en-US")).toBe("Nov 4 – Nov 10");
    expect(rangeLabel(weekRange("2026-12-28", 0), "en-US")).toBe("Dec 28, 2026 – Jan 3, 2027");
  });
});

describe("importanceOf", () => {
  const cases: [string, string, number][] = [
    ["FOMC Decision Fed Funds Tgt Rate", "US", 3],
    ["FOMC Minutes", "US", 3],
    ["FOMC Press Conference", "US", 3],
    ["Non-Farm Payrolls", "US", 3],
    ["Unemployment Rate", "US", 3],
    ["Initial Jobless Clm *", "US", 3],
    ["Core CPI YY, NSA", "US", 3],
    ["CPI MM, SA", "US", 3],
    ["Core PCE Price Index MM", "US", 3],
    ["GDP Advance QQ", "US", 3],
    ["GDP Final QQ", "US", 3],
    ["Retail Sales MM", "US", 3],
    ["ISM Manufacturing PMI", "US", 3],
    ["ISM Services PMI", "US", 3],
    ["PPI Final Demand MM", "US", 3],
    ["JOLTS Job Openings", "US", 2],
    ["ADP National Employment", "US", 2],
    ["Durable Goods Orders", "US", 2],
    ["Consumer Confidence", "US", 2],
    ["U Mich Sentiment Prelim", "US", 2],
    ["Housing Starts", "US", 2],
    ["Building Permits", "US", 2],
    ["Existing Home Sales", "US", 2],
    ["New Home Sales", "US", 2],
    ["Industrial Production MM", "US", 2],
    ["Trade Balance", "US", 2],
    ["S&P Global Mfg PMI Final", "US", 2],
    ["Fed Chair Powell Speaks", "US", 2],
    ["Average Hourly Earnings MM", "US", 2],
    ["Empire State Manufacturing", "US", 2],
    ["Philly Fed Manufacturing", "US", 2],
    ["Redbook YY *", "US", 1],
    ["Cont Jobless Clm *", "US", 1],
    ["Cleveland Fed CPI*", "US", 1],
    ["EndYear CPI Fcst/Cb Svy", "US", 1],
    ["Fiscal Balance/GDP", "US", 1],
    ["GDP QQ Capital Expend.", "US", 1],
    ["BRC Retail Sales YY", "GB", 1],
    ["Mystery", "US", 1],
    ["", "US", 1],
    ["CPI YY", "EU", 2],
    ["BOE Bank Rate", "GB", 2],
    ["BoC Rate Decision", "CA", 2],
    ["ILO Unemployment Rate", "GB", 2],
    ["Trade Balance", "JP", 1],
    ["Redbook YY *", "JP", 1],
    ["CPI YY", "", 3],
    ["Trade Balance", "", 2],
  ];

  it.each(cases)("%s (%s) is %i", (name, country, level) => {
    expect(importanceOf({ name, country })).toBe(level);
  });
});

describe("filterEvents", () => {
  const list = [event("CPI YY", "US"), event("Redbook YY", "US"), event("CPI YY", "EU"), event("Bank Rate", "GB"), event("Mystery", "")];

  it("keeps everything for all countries and all releases", () => {
    expect(filterEvents(list, { countries: [], importance: "all" })).toEqual(list);
  });

  it("filters by country", () => {
    expect(filterEvents(list, { countries: ["US"], importance: "all" }).map((e) => e.name)).toEqual(["CPI YY", "Redbook YY"]);
    expect(filterEvents(list, { countries: ["EU", "GB"], importance: "all" }).map((e) => e.country)).toEqual(["EU", "GB"]);
    expect(filterEvents(list, { countries: ["JP"], importance: "all" })).toEqual([]);
  });

  it("filters by importance", () => {
    expect(filterEvents(list, { countries: [], importance: "medium" }).map((e) => e.name)).toEqual(["CPI YY", "CPI YY", "Bank Rate"]);
    expect(filterEvents(list, { countries: [], importance: "high" }).map((e) => e.country)).toEqual(["US"]);
  });

  it("combines both filters and leaves the input alone", () => {
    const before = [...list];
    expect(filterEvents(list, { countries: ["US"], importance: "high" })).toEqual([list[0]]);
    expect(list).toEqual(before);
  });

  it("drops events without a country when countries are chosen", () => {
    expect(filterEvents(list, { countries: ["US"], importance: "all" }).some((e) => e.country === "")).toBe(false);
    expect(filterEvents(list, DEFAULT_EVENT_FILTER)).toHaveLength(2);
  });
});

describe("country choice", () => {
  const f = (countries: string[], importance: EventFilter["importance"] = "all"): EventFilter => ({ countries, importance });

  it("lists the codes in the data plus chosen ones, sorted and unique", () => {
    const events = [event("a", "US"), event("b", "EU"), event("c", "US"), event("d", "")];
    expect(countryOptions(events, ["GB", "US"])).toEqual(["EU", "GB", "US"]);
    expect(countryOptions([], [])).toEqual([]);
  });

  const options = ["EU", "GB", "US"];

  it("excludes one country when all are shown", () => {
    expect(toggleCountry(f([]), "GB", options).countries).toEqual(["EU", "US"]);
  });

  it("adds and removes from a chosen set", () => {
    expect(toggleCountry(f(["US"]), "GB", options).countries).toEqual(["GB", "US"]);
    expect(toggleCountry(f(["GB", "US"]), "GB", options).countries).toEqual(["US"]);
    expect(toggleCountry(f(["US"]), "JP", options).countries).toEqual(["JP", "US"]);
  });

  it("keeps at least one country", () => {
    const only = f(["US"]);
    expect(toggleCountry(only, "US", options)).toBe(only);
    const none = f([]);
    expect(toggleCountry(none, "US", ["US"])).toBe(none);
  });

  it("keeps the importance when toggling", () => {
    expect(toggleCountry(f(["US"], "high"), "EU", options)).toEqual({ countries: ["EU", "US"], importance: "high" });
  });

  it("sets countries sorted without duplicates, and importance", () => {
    expect(setCountries(f([], "high"), ["US", "EU", "US"])).toEqual({ countries: ["EU", "US"], importance: "high" });
    expect(setImportance(f(["US"]), "high")).toEqual({ countries: ["US"], importance: "high" });
  });

  it("does not mutate the previous filter", () => {
    const before = f(["US"]);
    toggleCountry(before, "EU", options);
    setCountries(before, ["JP"]);
    expect(before).toEqual(f(["US"]));
  });

  it("compares filters", () => {
    expect(sameFilter(f(["US"]), f(["US"]))).toBe(true);
    expect(sameFilter(f(["US"]), f(["US"], "high"))).toBe(false);
    expect(sameFilter(f(["US"]), f(["EU"]))).toBe(false);
    expect(sameFilter(f([]), f(["US"]))).toBe(false);
  });

  it("summarizes the choice", () => {
    expect(countrySummary(f([]))).toBe("All countries");
    expect(countrySummary(f(["US"]))).toBe("US");
    expect(countrySummary(f(["EU", "GB", "US"]))).toBe("EU, GB, US");
    expect(countrySummary(f(["EU", "GB", "JP", "US"]))).toBe("4 countries");
  });

  it("names countries and falls back to the code", () => {
    expect(countryName("US", "en-US")).toMatch(/United States/);
    expect(countryName("EU", "en-US")).toMatch(/European Union/);
    expect(countryName("not a code", "en-US")).toBe("not a code");
  });
});

describe("groupByDay", () => {
  const utc = () => 0;

  it("groups by day in time order", () => {
    const a = event("a", "US", Date.UTC(2026, 10, 4, 13) / 1000);
    const b = event("b", "US", Date.UTC(2026, 10, 4, 20) / 1000);
    const c = event("c", "US", Date.UTC(2026, 10, 5, 1) / 1000);
    const groups = groupByDay([c, a, b], utc);
    expect(groups.map((g) => [g.key, g.items.map((e) => e.name)])).toEqual([
      ["2026-11-04", ["a", "b"]],
      ["2026-11-05", ["c"]],
    ]);
  });

  it("uses the local offset to pick the day", () => {
    const late = event("late", "US", Date.UTC(2026, 10, 5, 1) / 1000);
    expect(groupByDay([late], () => -5 * 3600)[0].key).toBe("2026-11-04");
    expect(groupByDay([late], () => 9 * 3600)[0].key).toBe("2026-11-05");
  });

  it("handles an empty list and does not reorder the input", () => {
    expect(groupByDay([], utc)).toEqual([]);
    const items = [event("b", "US", 2), event("a", "US", 1)];
    groupByDay(items, utc);
    expect(items.map((e) => e.name)).toEqual(["b", "a"]);
  });
});

describe("watchEntries", () => {
  const today = "2026-11-04";

  it("lists upcoming earnings and ex-dividend dates in date order", () => {
    const list = watchEntries(
      [
        dates("KO", { earnings: { date: "2026-12-10", estimated: true, eps_estimate: 0.6 }, ex_dividend: "2026-12-01" }),
        dates("AAPL", { earnings: { date: "2026-11-05", estimated: false, eps_estimate: 1.9 } }),
        dates("JNJ", { ex_dividend: "2026-11-05" }),
      ],
      today,
    );
    expect(list.map((e) => [e.date, e.symbol, e.kind])).toEqual([
      ["2026-11-05", "AAPL", "earnings"],
      ["2026-11-05", "JNJ", "dividend"],
      ["2026-12-01", "KO", "dividend"],
      ["2026-12-10", "KO", "earnings"],
    ]);
    expect(list[0]).toMatchObject({ estimated: false, eps: 1.9 });
    expect(list[3]).toMatchObject({ estimated: true, eps: 0.6 });
    expect(list[1]).toMatchObject({ estimated: false, eps: null });
  });

  it("includes today and drops past dates", () => {
    const list = watchEntries(
      [dates("A", { earnings: { date: today, estimated: false, eps_estimate: null }, ex_dividend: "2026-11-03" }), dates("B", { earnings: { date: "2026-10-27", estimated: false, eps_estimate: null } })],
      today,
    );
    expect(list.map((e) => e.id)).toEqual(["A-earnings-2026-11-04"]);
  });

  it("orders earnings before dividends and symbols alphabetically on one day", () => {
    const d = "2026-11-10";
    const list = watchEntries(
      [dates("MSFT", { ex_dividend: d }), dates("ZZZ", { earnings: { date: d, estimated: false, eps_estimate: null } }), dates("AAA", { earnings: { date: d, estimated: false, eps_estimate: null } })],
      today,
    );
    expect(list.map((e) => `${e.symbol}:${e.kind}`)).toEqual(["AAA:earnings", "ZZZ:earnings", "MSFT:dividend"]);
  });

  it("skips malformed dates and symbols without any", () => {
    const list = watchEntries(
      [dates("A", { earnings: { date: "soon", estimated: false, eps_estimate: null }, ex_dividend: "2026-02-30" }), dates("B"), dates("C", { error: "rate limited" }), dates("D", { ex_dividend: "" })],
      today,
    );
    expect(list).toEqual([]);
  });

  it("filters by kind and groups by date", () => {
    const list = watchEntries(
      [
        dates("A", { earnings: { date: "2026-11-05", estimated: false, eps_estimate: null }, ex_dividend: "2026-11-05" }),
        dates("B", { ex_dividend: "2026-11-09" }),
      ],
      today,
    );
    expect(filterKind(list, "all")).toHaveLength(3);
    expect(filterKind(list, "earnings").map((e) => e.symbol)).toEqual(["A"]);
    expect(filterKind(list, "dividend").map((e) => e.symbol)).toEqual(["A", "B"]);
    expect(groupByDate(list).map((g) => [g.key, g.items.length])).toEqual([
      ["2026-11-05", 2],
      ["2026-11-09", 1],
    ]);
    expect(groupByDate([])).toEqual([]);
  });

  it("names the symbols that failed", () => {
    expect(failedSymbols([dates("A"), dates("B", { error: "x" }), dates("C", { error: "y" })])).toEqual(["B", "C"]);
  });
});

describe("mergeCalendar", () => {
  const range = weekRange("2026-11-02", 0);
  const noon = (day: string, h = 12) => Date.parse(`${day}T${String(h).padStart(2, "0")}:00:00Z`) / 1000;
  const utc = () => 0;
  const all: EventFilter = { countries: [], importance: "all" };
  const entries = watchEntries(
    [
      dates("MSFT", { earnings: { date: "2026-11-04", estimated: false, eps_estimate: 1 }, ex_dividend: "2026-11-04" }),
      dates("AAPL", { earnings: { date: "2026-11-04", estimated: true, eps_estimate: null } }),
      dates("LATE", { earnings: { date: "2026-11-20", estimated: false, eps_estimate: null } }),
    ],
    "2026-11-02",
  );
  const events = [event("GDP", "US", noon("2026-11-04", 14)), event("CPI", "US", noon("2026-11-04", 9)), event("CPI", "GB", noon("2026-11-03")), event("Housing", "US", noon("2026-11-06"))];

  it("orders days, then watch rows before macro rows by time", () => {
    const days = mergeCalendar(events, entries, range, all, utc);
    expect(days.map((d) => d.key)).toEqual(["2026-11-03", "2026-11-04", "2026-11-06"]);
    expect(days[1].items.map((i) => (i.kind === "watch" ? `${i.entry.symbol}-${i.entry.kind}` : i.event.name))).toEqual([
      "AAPL-earnings",
      "MSFT-earnings",
      "MSFT-dividend",
      "CPI",
      "GDP",
    ]);
  });

  it("keeps only watch dates inside the week", () => {
    const days = mergeCalendar([], entries, range, all, utc);
    expect(days.flatMap((d) => d.items).some((i) => i.kind === "watch" && i.entry.symbol === "LATE")).toBe(false);
    expect(mergeCalendar([], entries, weekRange("2026-11-02", 2), all, utc).map((d) => d.key)).toEqual(["2026-11-20"]);
  });

  it("applies country and key filters to macro rows only", () => {
    const us = mergeCalendar(events, entries, range, { countries: ["US"], importance: "all" }, utc);
    expect(us.map((d) => d.key)).toEqual(["2026-11-04", "2026-11-06"]);
    const key = mergeCalendar(events, entries, range, { countries: ["US"], importance: "high" }, utc);
    expect(key.map((d) => d.key)).toEqual(["2026-11-04"]);
    expect(key[0].items.filter((i) => i.kind === "watch")).toHaveLength(3);
  });

  it("is empty with nothing to show", () => {
    expect(mergeCalendar([], [], range, all, utc)).toEqual([]);
    expect(mergeCalendar(events, [], range, { countries: ["JP"], importance: "all" }, utc)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { fullTime } from "./format";
import { localOffset } from "./freshness";
import {
  classifyBars,
  classifySession,
  displayOffset,
  exchangeOffset,
  isExtendedSession,
  isIntraday,
  offsetAt,
  offsetLabel,
  scheduleFor,
  zoneLabel,
  type Clock,
  type Session,
  type TradingPeriods,
} from "./session";

const utc = (iso: string) => Date.parse(iso) / 1000;
const period = (start: string, end: string) => ({ start: utc(start), end: utc(end) });

const NY: Clock = { timezone: "America/New_York", gmtoffset: -18000 };
const NY_WINTER: TradingPeriods = {
  pre: period("2026-01-05T09:00:00Z", "2026-01-05T14:30:00Z"),
  regular: period("2026-01-05T14:30:00Z", "2026-01-05T21:00:00Z"),
  post: period("2026-01-05T21:00:00Z", "2026-01-06T01:00:00Z"),
};
const NY_SUMMER: TradingPeriods = {
  pre: period("2026-06-01T08:00:00Z", "2026-06-01T13:30:00Z"),
  regular: period("2026-06-01T13:30:00Z", "2026-06-01T20:00:00Z"),
  post: period("2026-06-01T20:00:00Z", "2026-06-02T00:00:00Z"),
};

const LONDON: Clock = { timezone: "Europe/London", gmtoffset: 0 };
const LONDON_WINTER: TradingPeriods = {
  pre: period("2026-01-05T05:00:00Z", "2026-01-05T08:00:00Z"),
  regular: period("2026-01-05T08:00:00Z", "2026-01-05T16:30:00Z"),
  post: period("2026-01-05T16:30:00Z", "2026-01-05T17:00:00Z"),
};

const KOLKATA: Clock = { timezone: "Asia/Kolkata", gmtoffset: 19800 };
const KOLKATA_DAY: TradingPeriods = {
  pre: period("2026-01-05T03:30:00Z", "2026-01-05T03:45:00Z"),
  regular: period("2026-01-05T03:45:00Z", "2026-01-05T10:00:00Z"),
  post: period("2026-01-05T10:00:00Z", "2026-01-05T10:30:00Z"),
};

const TOKYO: Clock = { timezone: "Asia/Tokyo", gmtoffset: 32400 };
const TOKYO_DAY: TradingPeriods = {
  pre: period("2026-01-05T00:00:00Z", "2026-01-05T00:00:00Z"),
  regular: period("2026-01-05T00:00:00Z", "2026-01-05T06:00:00Z"),
  post: period("2026-01-05T06:00:00Z", "2026-01-05T06:00:00Z"),
};

const CRYPTO: Clock = { timezone: "UTC", gmtoffset: 0 };
const CRYPTO_DAY: TradingPeriods = {
  pre: period("2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"),
  regular: period("2026-06-01T00:00:00Z", "2026-06-01T23:59:59Z"),
  post: period("2026-06-01T23:59:59Z", "2026-06-01T23:59:59Z"),
};

const kind = (iso: string, clock: Clock, periods: TradingPeriods) => classifySession(utc(iso), clock, scheduleFor(periods, clock));

describe("utc offsets", () => {
  it("follows the New York DST transitions", () => {
    expect(offsetAt(utc("2026-03-08T06:59:59Z"), "America/New_York", 0)).toBe(-18000);
    expect(offsetAt(utc("2026-03-08T07:00:00Z"), "America/New_York", 0)).toBe(-14400);
    expect(offsetAt(utc("2026-11-01T05:59:59Z"), "America/New_York", 0)).toBe(-14400);
    expect(offsetAt(utc("2026-11-01T06:00:00Z"), "America/New_York", 0)).toBe(-18000);
  });

  it("follows the London transitions", () => {
    expect(offsetAt(utc("2026-03-29T00:59:59Z"), "Europe/London", 99)).toBe(0);
    expect(offsetAt(utc("2026-03-29T01:00:00Z"), "Europe/London", 99)).toBe(3600);
    expect(offsetAt(utc("2026-10-25T00:59:59Z"), "Europe/London", 99)).toBe(3600);
    expect(offsetAt(utc("2026-10-25T01:00:00Z"), "Europe/London", 99)).toBe(0);
  });

  it("follows southern hemisphere DST", () => {
    expect(offsetAt(utc("2026-10-03T15:59:59Z"), "Australia/Sydney", 0)).toBe(36000);
    expect(offsetAt(utc("2026-10-03T16:00:00Z"), "Australia/Sydney", 0)).toBe(39600);
  });

  it("handles zones without DST and half-hour offsets", () => {
    expect(offsetAt(utc("2026-06-01T00:00:00Z"), "Asia/Kolkata", 0)).toBe(19800);
    expect(offsetAt(utc("2026-06-01T00:00:00Z"), "Asia/Tokyo", 0)).toBe(32400);
    expect(offsetAt(utc("2026-01-01T00:00:00Z"), "Asia/Tokyo", 0)).toBe(32400);
  });

  it("ignores fractional seconds", () => {
    expect(offsetAt(utc("2026-03-08T06:59:59Z") + 0.9, "America/New_York", 0)).toBe(-18000);
  });

  it("falls back to the payload offset without a usable zone", () => {
    for (const zone of [undefined, null, "", "Mars/Olympus", "not a zone"]) {
      expect(offsetAt(utc("2026-06-01T00:00:00Z"), zone, -14400)).toBe(-14400);
    }
    expect(offsetAt(Number.NaN, "America/New_York", -14400)).toBe(-14400);
    expect(exchangeOffset(utc("2026-06-01T00:00:00Z"), { gmtoffset: 3600 })).toBe(3600);
    expect(exchangeOffset(utc("2026-06-01T00:00:00Z"), { timezone: "America/New_York", gmtoffset: 0 })).toBe(-14400);
  });
});

describe("session schedule", () => {
  it("reads exchange wall-clock times from the trading periods", () => {
    const winter = scheduleFor(NY_WINTER, NY)!;
    const summer = scheduleFor(NY_SUMMER, NY)!;
    const expected = { preStart: 4 * 3600, regularStart: 9.5 * 3600, regularEnd: 16 * 3600, postEnd: 20 * 3600 };
    expect(winter).toEqual(expected);
    expect(summer).toEqual(expected);
    expect(scheduleFor(KOLKATA_DAY, KOLKATA)).toEqual({ preStart: 9 * 3600, regularStart: 9.25 * 3600, regularEnd: 15.5 * 3600, postEnd: 16 * 3600 });
  });

  it("uses the regular edges when pre or post is empty", () => {
    expect(scheduleFor(TOKYO_DAY, TOKYO)).toEqual({ preStart: 9 * 3600, regularStart: 9 * 3600, regularEnd: 15 * 3600, postEnd: 15 * 3600 });
  });

  it("has no schedule for missing or 24 hour periods", () => {
    expect(scheduleFor(null, NY)).toBeNull();
    expect(scheduleFor(undefined, NY)).toBeNull();
    expect(scheduleFor(CRYPTO_DAY, CRYPTO)).toBeNull();
    expect(scheduleFor({ ...NY_WINTER, regular: { start: 5, end: 5 } }, NY)).toBeNull();
  });
});

describe("US equity sessions", () => {
  it("splits the winter day at the session edges", () => {
    const cases: [string, string][] = [
      ["2026-01-05T08:59:00Z", "closed"],
      ["2026-01-05T09:00:00Z", "pre"],
      ["2026-01-05T14:29:00Z", "pre"],
      ["2026-01-05T14:30:00Z", "regular"],
      ["2026-01-05T20:59:00Z", "regular"],
      ["2026-01-05T21:00:00Z", "post"],
      ["2026-01-06T00:59:00Z", "post"],
      ["2026-01-06T01:00:00Z", "closed"],
    ];
    for (const [iso, expected] of cases) expect(kind(iso, NY, NY_WINTER), iso).toBe(expected);
  });

  it("splits the summer day at the session edges", () => {
    const cases: [string, string][] = [
      ["2026-06-01T07:59:00Z", "closed"],
      ["2026-06-01T08:00:00Z", "pre"],
      ["2026-06-01T13:29:00Z", "pre"],
      ["2026-06-01T13:30:00Z", "regular"],
      ["2026-06-01T19:59:00Z", "regular"],
      ["2026-06-01T20:00:00Z", "post"],
      ["2026-06-01T23:59:00Z", "post"],
      ["2026-06-02T00:00:00Z", "closed"],
    ];
    for (const [iso, expected] of cases) expect(kind(iso, NY, NY_SUMMER), iso).toBe(expected);
  });

  it("keeps the open at 09:30 local across the March change", () => {
    expect(kind("2026-03-06T14:29:00Z", NY, NY_WINTER)).toBe("pre");
    expect(kind("2026-03-06T14:30:00Z", NY, NY_WINTER)).toBe("regular");
    expect(kind("2026-03-09T13:29:00Z", NY, NY_WINTER)).toBe("pre");
    expect(kind("2026-03-09T13:30:00Z", NY, NY_WINTER)).toBe("regular");
    expect(kind("2026-03-09T14:30:00Z", NY, NY_WINTER)).toBe("regular");
    expect(kind("2026-03-09T19:59:00Z", NY, NY_WINTER)).toBe("regular");
    expect(kind("2026-03-09T20:00:00Z", NY, NY_WINTER)).toBe("post");
  });

  it("keeps the open at 09:30 local across the November change", () => {
    expect(kind("2026-10-30T13:29:00Z", NY, NY_SUMMER)).toBe("pre");
    expect(kind("2026-10-30T13:30:00Z", NY, NY_SUMMER)).toBe("regular");
    expect(kind("2026-11-02T14:29:00Z", NY, NY_SUMMER)).toBe("pre");
    expect(kind("2026-11-02T14:30:00Z", NY, NY_SUMMER)).toBe("regular");
    expect(kind("2026-11-02T20:59:00Z", NY, NY_SUMMER)).toBe("regular");
    expect(kind("2026-11-02T21:00:00Z", NY, NY_SUMMER)).toBe("post");
  });

  it("falls back to the payload offset without a zone name", () => {
    const fixed: Clock = { gmtoffset: -18000 };
    expect(kind("2026-01-05T14:30:00Z", fixed, NY_WINTER)).toBe("regular");
    expect(kind("2026-01-05T14:29:00Z", fixed, NY_WINTER)).toBe("pre");
  });
});

describe("non-US sessions", () => {
  it("classifies London across the BST change", () => {
    expect(kind("2026-01-05T07:59:00Z", LONDON, LONDON_WINTER)).toBe("pre");
    expect(kind("2026-01-05T08:00:00Z", LONDON, LONDON_WINTER)).toBe("regular");
    expect(kind("2026-01-05T16:30:00Z", LONDON, LONDON_WINTER)).toBe("post");
    expect(kind("2026-06-01T06:59:00Z", LONDON, LONDON_WINTER)).toBe("pre");
    expect(kind("2026-06-01T07:00:00Z", LONDON, LONDON_WINTER)).toBe("regular");
    expect(kind("2026-06-01T15:29:00Z", LONDON, LONDON_WINTER)).toBe("regular");
    expect(kind("2026-06-01T15:30:00Z", LONDON, LONDON_WINTER)).toBe("post");
  });

  it("classifies a half-hour offset exchange", () => {
    expect(kind("2026-01-05T03:44:00Z", KOLKATA, KOLKATA_DAY)).toBe("pre");
    expect(kind("2026-01-05T03:45:00Z", KOLKATA, KOLKATA_DAY)).toBe("regular");
    expect(kind("2026-01-05T09:59:00Z", KOLKATA, KOLKATA_DAY)).toBe("regular");
    expect(kind("2026-01-05T10:00:00Z", KOLKATA, KOLKATA_DAY)).toBe("post");
    expect(kind("2026-01-05T10:30:00Z", KOLKATA, KOLKATA_DAY)).toBe("closed");
  });

  it("treats an exchange without extended sessions as regular or closed", () => {
    expect(kind("2026-01-05T00:00:00Z", TOKYO, TOKYO_DAY)).toBe("regular");
    expect(kind("2026-01-05T05:59:00Z", TOKYO, TOKYO_DAY)).toBe("regular");
    expect(kind("2026-01-05T06:00:00Z", TOKYO, TOKYO_DAY)).toBe("closed");
    expect(kind("2026-01-04T23:59:00Z", TOKYO, TOKYO_DAY)).toBe("closed");
  });

  it("handles a session that crosses local midnight", () => {
    const futures: TradingPeriods = {
      pre: period("2026-01-05T22:00:00Z", "2026-01-05T22:00:00Z"),
      regular: period("2026-01-05T23:00:00Z", "2026-01-06T22:00:00Z"),
      post: period("2026-01-06T22:00:00Z", "2026-01-06T22:00:00Z"),
    };
    const clock: Clock = { timezone: "UTC", gmtoffset: 0 };
    expect(kind("2026-01-07T02:00:00Z", clock, futures)).toBe("regular");
    expect(kind("2026-01-07T12:00:00Z", clock, futures)).toBe("regular");
    expect(kind("2026-01-07T22:30:00Z", clock, futures)).toBe("closed");
    expect(kind("2026-01-07T23:00:00Z", clock, futures)).toBe("regular");
  });
});

describe("24 hour markets", () => {
  it("never shades crypto", () => {
    for (const iso of ["2026-06-01T00:00:00Z", "2026-06-01T04:00:00Z", "2026-06-01T13:29:00Z", "2026-06-01T20:00:00Z", "2026-06-01T23:59:00Z", "2026-06-02T03:00:00Z"]) {
      expect(kind(iso, CRYPTO, CRYPTO_DAY), iso).toBe("regular");
    }
    const times = ["2026-06-01T03:00:00Z", "2026-06-01T21:00:00Z"].map(utc);
    expect(classifyBars(times, CRYPTO, CRYPTO_DAY, "5m").some(isExtendedSession)).toBe(false);
  });

  it("never shades without trading periods", () => {
    expect(classifySession(utc("2026-06-01T03:00:00Z"), NY, null)).toBe("regular");
    expect(classifyBars([utc("2026-06-01T03:00:00Z")], NY, null, "5m")).toEqual(["regular"]);
  });
});

describe("classifying bars", () => {
  const times = ["2026-01-05T09:00:00Z", "2026-01-05T14:30:00Z", "2026-01-05T21:00:00Z"].map(utc);

  it("labels each intraday bar", () => {
    expect(classifyBars(times, NY, NY_WINTER, "5m")).toEqual(["pre", "regular", "post"]);
    expect(classifyBars(times, NY, NY_WINTER, "60m")).toEqual(["pre", "regular", "post"]);
  });

  it("treats daily and longer bars as regular", () => {
    for (const interval of ["1d", "1wk", "1mo"]) expect(classifyBars(times, NY, NY_WINTER, interval)).toEqual(["regular", "regular", "regular"]);
  });

  it("marks everything outside the regular session as extended", () => {
    const extended: Session[] = ["pre", "post", "closed"];
    expect(extended.map(isExtendedSession)).toEqual([true, true, true]);
    expect(isExtendedSession("regular")).toBe(false);
  });

  it("tells intraday intervals apart", () => {
    for (const i of ["1m", "5m", "15m", "30m", "60m"]) expect(isIntraday(i), i).toBe(true);
    for (const i of ["1d", "1wk", "1mo", "auto"]) expect(isIntraday(i), i).toBe(false);
  });
});

describe("display time zone", () => {
  const open = utc("2026-03-09T13:30:00Z");

  it("shows exchange time by default", () => {
    const offset = displayOffset(open, "exchange", NY, "5m");
    expect(offset).toBe(-14400);
    expect(fullTime(open, offset, "5m")).toBe("Mon Mar 9, 2026 09:30");
  });

  it("uses the exchange offset in force at each bar, not the latest one", () => {
    const winterBar = utc("2026-03-06T14:30:00Z");
    expect(fullTime(winterBar, displayOffset(winterBar, "exchange", NY, "5m"), "5m")).toBe("Fri Mar 6, 2026 09:30");
    expect(fullTime(open, displayOffset(open, "exchange", NY, "5m"), "5m")).toBe("Mon Mar 9, 2026 09:30");
  });

  it("shows local time for intraday bars", () => {
    const offset = displayOffset(open, "local", NY, "5m", "Asia/Tokyo");
    expect(offset).toBe(32400);
    expect(fullTime(open, offset, "5m")).toBe("Mon Mar 9, 2026 22:30");
    expect(displayOffset(open, "local", NY, "5m", "America/Los_Angeles")).toBe(-25200);
    expect(displayOffset(open, "local", NY, "5m", "Europe/London")).toBe(0);
  });

  it("follows DST changes of the local zone", () => {
    expect(displayOffset(utc("2026-03-08T07:59:59Z"), "local", NY, "5m", "America/Chicago")).toBe(-21600);
    expect(displayOffset(utc("2026-03-08T08:00:00Z"), "local", NY, "5m", "America/Chicago")).toBe(-18000);
  });

  it("uses the system zone when none is given", () => {
    expect(displayOffset(open, "local", NY, "5m")).toBe(localOffset(open));
  });

  it("keeps exchange dates for daily and longer bars", () => {
    const daily = utc("2026-03-09T13:30:00Z");
    for (const interval of ["1d", "1wk", "1mo"]) {
      expect(displayOffset(daily, "local", NY, interval, "Asia/Tokyo")).toBe(-14400);
    }
  });

  it("labels the zone in effect", () => {
    expect(zoneLabel(open, "exchange", NY, "5m")).toBe("EDT");
    expect(zoneLabel(utc("2026-01-05T14:30:00Z"), "exchange", NY, "5m")).toBe("EST");
    expect(zoneLabel(open, "local", NY, "5m", "America/Los_Angeles")).toBe("PDT");
    expect(zoneLabel(open, "local", NY, "1d", "America/Los_Angeles")).toBe("EDT");
    expect(zoneLabel(open, "local", NY, "5m", "Asia/Tokyo")).toMatch(/^(GMT\+9|JST)$/);
    expect(zoneLabel(open, "exchange", { gmtoffset: -14400 }, "5m")).toBe("UTC-04:00");
    expect(zoneLabel(open, "exchange", { timezone: "Mars/Olympus", gmtoffset: 19800 }, "5m")).toBe("UTC+05:30");
  });

  it("formats offsets", () => {
    expect(offsetLabel(0)).toBe("UTC");
    expect(offsetLabel(-14400)).toBe("UTC-04:00");
    expect(offsetLabel(19800)).toBe("UTC+05:30");
    expect(offsetLabel(-12600)).toBe("UTC-03:30");
  });
});

import { describe, expect, it } from "vitest";
import { baseFor, intervalHint, intervalLabel, intervalSpec, intervalsFor, isCustom, nextInterval, parseInterval, pickerIntervals, RANGES, validInterval } from "./types";

describe("candle intervals", () => {
  it("lists the supported resolutions for each range", () => {
    const expected = [
      ["1m", "5m", "15m", "30m", "60m"],
      ["1m", "5m", "15m", "30m", "60m"],
      ["5m", "15m", "30m", "60m", "1d"],
      ["60m", "1d", "1wk"],
      ["60m", "1d", "1wk"],
      ["60m", "1d", "1wk"],
      ["1d", "1wk", "1mo"],
      ["1d", "1wk", "1mo"],
    ];
    expect(RANGES.map((r) => intervalsFor(r.id))).toEqual(expected);
    expect(intervalsFor("unknown")).toEqual([]);
  });

  it("cycles from auto through each range's native and preset intervals and wraps back to auto", () => {
    expect(nextInterval("1d", "auto")).toBe("1m");
    expect(nextInterval("1d", "1m")).toBe("2m");
    expect(nextInterval("1d", "60m")).toBe("2h");
    expect(nextInterval("1d", "4h")).toBe("auto");
    expect(nextInterval("1y", "60m")).toBe("2h");
    expect(nextInterval("1y", "4h")).toBe("1d");
    expect(nextInterval("1y", "1d")).toBe("2d");
    expect(nextInterval("1y", "3d")).toBe("1wk");
    expect(nextInterval("1mo", "1d")).toBe("auto");
    expect(nextInterval("1d", "45m", ["7m"])).toBe("60m");
    expect(nextInterval("1d", "5m", ["7m"])).toBe("7m");
    for (const { id } of RANGES) {
      const cycle = ["auto", ...pickerIntervals().filter((i) => validInterval(id, i) === i)];
      expect(cycle.map((i) => nextInterval(id, i))).toEqual([...cycle.slice(1), "auto"]);
    }
  });

  it("starts at auto when the current interval is unavailable", () => {
    expect(nextInterval("1y", "5m")).toBe("auto");
    expect(nextInterval("1d", "invalid")).toBe("auto");
    expect(nextInterval("unknown", "1d")).toBe("auto");
    expect(nextInterval("unknown", "auto")).toBe("auto");
  });

  it("keeps compatible choices and resets incompatible choices to auto", () => {
    for (const { id } of RANGES) {
      expect(validInterval(id, "auto")).toBe("auto");
      expect(validInterval(id, "invalid")).toBe("auto");
      for (const interval of intervalsFor(id)) expect(validInterval(id, interval)).toBe(interval);
    }
    expect(validInterval("1y", "5m")).toBe("auto");
    expect(validInterval("1y", "60m")).toBe("60m");
    expect(validInterval("1d", "1wk")).toBe("auto");
    expect(validInterval("1y", "4h")).toBe("4h");
    expect(validInterval("5y", "4h")).toBe("auto");
    expect(validInterval("1y", "2d")).toBe("2d");
    expect(validInterval("1mo", "2d")).toBe("auto");
    expect(validInterval("6mo", "3d")).toBe("auto");
    expect(validInterval("1mo", "1d")).toBe("1d");
    expect(validInterval("5d", "7m")).toBe("7m");
    expect(validInterval("1mo", "7m")).toBe("auto");
  });
});

describe("intervalSpec", () => {
  it.each([
    ["1m", 1, "m", 60, ["1m"]],
    ["60m", 60, "m", 3600, ["60m"]],
    ["1d", 1, "d", 86_400, ["1d"]],
    ["1wk", 1, "wk", 604_800, ["1wk"]],
    ["1mo", 1, "mo", 2_592_000, ["1mo"]],
    ["2m", 2, "m", 120, ["1m"]],
    ["10m", 10, "m", 600, ["5m", "1m"]],
    ["45m", 45, "m", 2700, ["15m", "5m", "1m"]],
    ["90m", 90, "m", 5400, ["30m", "15m", "5m", "1m"]],
    ["120m", 120, "m", 7200, ["30m", "60m"]],
    ["4h", 4, "h", 14_400, ["30m", "60m"]],
    ["24h", 24, "h", 86_400, ["30m", "60m"]],
    ["2d", 2, "d", 172_800, ["1d"]],
    ["3wk", 3, "wk", 1_814_400, ["1wk"]],
    ["6mo", 6, "mo", 15_552_000, ["1mo"]],
  ] as const)("%s", (interval, count, unit, seconds, bases) => {
    expect(intervalSpec(interval)).toEqual({ count, unit, seconds, bases });
  });

  it("rejects anything else", () => {
    for (const bad of ["auto", "", "0m", "07m", "1441m", "25h", "31d", "9wk", "13mo", "2w", "2D", "2y", "m", "constructor", "1.5h"]) expect(intervalSpec(bad), bad).toBeNull();
  });

  it("tells native intervals from custom ones", () => {
    expect(["1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"].some(isCustom)).toBe(false);
    expect(["2m", "45m", "4h", "2d", "3wk", "2mo"].every(isCustom)).toBe(true);
    expect(isCustom("auto")).toBe(false);
  });

  it("picks the base each range can fetch", () => {
    expect(baseFor("45m", "5d")).toBe("15m");
    expect(baseFor("4h", "1d")).toBe("30m");
    expect(baseFor("4h", "1mo")).toBe("30m");
    expect(baseFor("4h", "1y")).toBe("60m");
    expect(baseFor("2h", "6mo")).toBe("60m");
    expect(baseFor("3m", "5d")).toBe("1m");
    expect(baseFor("3m", "1mo")).toBeNull();
    expect(baseFor("10m", "1mo")).toBe("5m");
    expect(baseFor("2d", "ytd")).toBe("1d");
    expect(baseFor("2d", "1mo")).toBeNull();
    expect(baseFor("2wk", "1y")).toBe("1wk");
    expect(baseFor("2wk", "5d")).toBeNull();
    expect(baseFor("3mo", "max")).toBe("1mo");
    expect(baseFor("15m", "1y")).toBeNull();
    expect(baseFor("auto", "1y")).toBeNull();
  });

  it("lists natives, presets and remembered intervals in length order", () => {
    expect(pickerIntervals()).toEqual(["1m", "2m", "3m", "5m", "10m", "15m", "30m", "45m", "60m", "2h", "3h", "4h", "1d", "2d", "3d", "1wk", "1mo"]);
    expect(pickerIntervals(["7m", "2wk", "garbage", "45m"])).toEqual(["1m", "2m", "3m", "5m", "7m", "10m", "15m", "30m", "45m", "60m", "2h", "3h", "4h", "1d", "2d", "3d", "1wk", "2wk", "1mo"]);
  });

  it("labels intervals the way the picker shows them", () => {
    expect(["1m", "45m", "60m", "4h", "1d", "2d", "1wk", "3wk", "1mo", "2mo", "auto"].map(intervalLabel)).toEqual(["1m", "45m", "1h", "4h", "1D", "2D", "1W", "3W", "1M", "2M", "auto"]);
  });
});

describe("parseInterval", () => {
  it.each([
    ["45m", "45m"],
    ["45M", "45m"],
    [" 4h ", "4h"],
    ["4 H", "4h"],
    ["2D", "2d"],
    ["3W", "3wk"],
    ["3wk", "3wk"],
    ["2mo", "2mo"],
    ["2MO", "2mo"],
    ["90min", "90m"],
    ["120m", "2h"],
    ["1440m", "24h"],
    ["60m", "60m"],
    ["1h", "60m"],
    ["1m", "1m"],
    ["1d", "1d"],
    ["1w", "1wk"],
    ["1mo", "1mo"],
    ["7m", "7m"],
    ["007m", "7m"],
  ])("%s becomes %s", (text, interval) => {
    const r = parseInterval(text);
    expect("interval" in r && r.interval).toBe(interval);
  });

  it.each([
    ["", "Type a number and a unit"],
    ["4", "Type a number and a unit"],
    ["h", "Type a number and a unit"],
    ["4x", "Type a number and a unit"],
    ["2y", "Type a number and a unit"],
    ["1.5h", "Type a number and a unit"],
    ["-2h", "Type a number and a unit"],
    ["4constructor", "Type a number and a unit"],
    ["0m", "Minutes go from 1 to 1440."],
    ["1441m", "Minutes go from 1 to 1440."],
    ["25h", "Hours go from 1 to 24."],
    ["31d", "Days go from 1 to 30."],
    ["9w", "Weeks go from 1 to 8."],
    ["13mo", "Months go from 1 to 12."],
  ])("%j is rejected", (text, error) => {
    const r = parseInterval(text);
    expect("error" in r && r.error).toContain(error);
  });

  it("warns that 1m-based intervals have short history and names the nearest longer ones", () => {
    const r = parseInterval("7m");
    expect("hint" in r && r.hint).toContain("Built from 1m bars, so history is short");
    expect("hint" in r && r.hint).toContain("5m or 10m reach further back");
    expect(intervalHint("2m")).toContain("Yahoo serves 1m bars for about the last 30 days. 5m reach further back");
    expect(intervalHint("58m")).toContain("55m or 1h reach further back");
    expect(intervalHint("45m")).toBe("Built from 15m bars.");
    expect(intervalHint("4h")).toContain("30m bars, or 60m bars");
    expect(intervalHint("2d")).toContain("each year's first trading day");
    expect(intervalHint("15m")).toBeNull();
    expect(intervalHint("auto")).toBeNull();
  });
});

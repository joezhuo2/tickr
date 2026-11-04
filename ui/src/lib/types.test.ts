import { describe, expect, it } from "vitest";
import { intervalsFor, nextInterval, RANGES, validInterval } from "./types";

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

  it("cycles from auto through each range's intervals and wraps back to auto", () => {
    for (const { id } of RANGES) {
      const intervals = ["auto", ...intervalsFor(id)];
      expect(intervals.map((interval) => nextInterval(id, interval))).toEqual([...intervals.slice(1), "auto"]);
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
  });
});

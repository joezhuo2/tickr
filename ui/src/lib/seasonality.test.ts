import { describe, expect, it } from "vitest";
import { seasonality } from "./seasonality";
import type { Candle } from "./types";

const bar = (y: number, m: number, o: number, c: number): Candle => ({ t: Date.UTC(y, m, 1) / 1000, o, h: c, l: c, c, v: 0 });
const NOW = Date.UTC(2024, 5, 15) / 1000;

describe("seasonality", () => {
  it("averages return by calendar month and counts positive years", () => {
    const s = seasonality([bar(2022, 0, 100, 110), bar(2022, 1, 110, 99), bar(2023, 0, 99, 99), bar(2023, 1, 99, 108.9)], 0, NOW)!;
    expect(s[0].avg).toBeCloseTo(5);
    expect(s[0].positive).toBe(50);
    expect(s[0].years).toBe(2);
    expect(s[1].avg).toBeCloseTo(0);
    expect(s[1].positive).toBe(50);
    expect(s[2].years).toBe(0);
  });

  it("ignores the month still in progress", () => {
    const s = seasonality([bar(2024, 4, 100, 110), bar(2024, 5, 110, 50)], 0, NOW)!;
    expect(s[5].years).toBe(0);
    expect(s[4].years).toBe(1);
  });

  it("uses the exchange offset to find the month", () => {
    const sydney = { t: Date.UTC(2023, 2, 31, 14) / 1000, o: 1, h: 1, l: 1, c: 2, v: 0 };
    expect(seasonality([sydney], 36000, NOW)![3].years).toBe(1);
  });

  it("returns null with no usable history", () => {
    expect(seasonality([], 0, NOW)).toBeNull();
  });
});

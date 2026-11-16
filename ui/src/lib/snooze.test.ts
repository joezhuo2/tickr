import { describe, expect, it } from "vitest";
import { localInputToEpoch, nextOpen, snoozeUntil } from "./snooze";

const utc = (y: number, m: number, d: number, h: number, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 1000;

describe("nextOpen", () => {
  it("picks today's open before the bell", () => {
    expect(nextOpen(utc(2026, 1, 5, 14, 0))).toBe(utc(2026, 1, 5, 14, 30));
  });

  it("picks the next weekday after the bell", () => {
    expect(nextOpen(utc(2026, 1, 6, 15, 0))).toBe(utc(2026, 1, 7, 14, 30));
  });

  it("skips the weekend", () => {
    expect(nextOpen(utc(2026, 1, 9, 21, 0))).toBe(utc(2026, 1, 12, 14, 30));
    expect(nextOpen(utc(2026, 1, 10, 12, 0))).toBe(utc(2026, 1, 12, 14, 30));
  });

  it("follows daylight saving time", () => {
    expect(nextOpen(utc(2026, 7, 6, 12, 0))).toBe(utc(2026, 7, 6, 13, 30));
  });
});

describe("snoozeUntil", () => {
  it("adds hours or jumps to the open", () => {
    expect(snoozeUntil("1h", 1000)).toBe(4600);
    expect(snoozeUntil("4h", 1000)).toBe(15_400);
    expect(snoozeUntil("open", utc(2026, 1, 5, 14, 0))).toBe(utc(2026, 1, 5, 14, 30));
  });
});

describe("localInputToEpoch", () => {
  it("parses a datetime-local value and rejects blanks", () => {
    expect(localInputToEpoch("2026-01-05T09:30")).toBe(Math.floor(new Date(2026, 0, 5, 9, 30).getTime() / 1000));
    expect(localInputToEpoch("")).toBeNull();
    expect(localInputToEpoch("nope")).toBeNull();
  });
});

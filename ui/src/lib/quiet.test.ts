import { describe, expect, it } from "vitest";
import { toHhmm, toMinutes } from "./quiet";

describe("quiet hours times", () => {
  it("converts between HH:MM and minutes", () => {
    expect(toMinutes("22:00")).toBe(1320);
    expect(toMinutes("07:05")).toBe(425);
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("23:59")).toBe(1439);
    expect(toHhmm(1320)).toBe("22:00");
    expect(toHhmm(425)).toBe("07:05");
  });

  it("rejects blank and out-of-range values and clamps display", () => {
    for (const bad of ["", "24:00", "12:60", "9", "ab:cd"]) expect(toMinutes(bad)).toBeNull();
    expect(toHhmm(5000)).toBe("23:59");
    expect(toHhmm(-5)).toBe("00:00");
  });
});

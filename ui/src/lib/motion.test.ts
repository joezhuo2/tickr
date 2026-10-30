import { describe, expect, it } from "vitest";
import { ms } from "./motion";

describe("ms", () => {
  it("reads CSS times in milliseconds", () => {
    expect(ms("180ms")).toBe(180);
    expect(ms(" 0.24s ")).toBe(240);
    expect(ms("0ms")).toBe(0);
    expect(ms("120")).toBe(120);
  });

  it("falls back to no motion for missing or bad values", () => {
    expect(ms("")).toBe(0);
    expect(ms("fast")).toBe(0);
    expect(ms("-5ms")).toBe(0);
  });
});

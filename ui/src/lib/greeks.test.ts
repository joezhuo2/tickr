import { describe, expect, it } from "vitest";
import { greeks, MIN_YEARS, yearsTo } from "./greeks";

describe("greeks", () => {
  const call = greeks("call", 100, 100, 1, 0.2, 0.05)!;
  const put = greeks("put", 100, 100, 1, 0.2, 0.05)!;

  it("matches known call values", () => {
    expect(call.delta).toBeCloseTo(0.6368, 3);
    expect(call.gamma).toBeCloseTo(0.01876, 4);
    expect(call.vega).toBeCloseTo(0.3752, 3);
    expect(call.theta * 365).toBeCloseTo(-6.414, 2);
  });

  it("matches known put values", () => {
    expect(put.delta).toBeCloseTo(-0.3632, 3);
    expect(put.gamma).toBeCloseTo(call.gamma, 10);
    expect(put.vega).toBeCloseTo(call.vega, 10);
    expect(put.theta * 365).toBeCloseTo(-1.658, 2);
  });

  it("returns null without usable inputs", () => {
    expect(greeks("call", 100, 100, 1, null)).toBeNull();
    expect(greeks("call", 100, 100, 1, 0)).toBeNull();
    expect(greeks("call", null, 100, 1, 0.2)).toBeNull();
    expect(greeks("call", 100, 0, 1, 0.2)).toBeNull();
  });

  it("stays finite at expiry", () => {
    const g = greeks("call", 100, 100, 0, 0.3)!;
    expect(Object.values(g).every(Number.isFinite)).toBe(true);
  });

  it("floors time to expiry", () => {
    expect(yearsTo(100, 200)).toBe(MIN_YEARS);
    expect(yearsTo(null)).toBe(MIN_YEARS);
    expect(yearsTo(86400 * 365, 0)).toBeCloseTo(1, 10);
  });
});

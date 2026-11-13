import { describe, expect, it } from "vitest";
import { cleanSettings, defaultSettings } from "./studySettings";

describe("study settings", () => {
  it("defaults to the previously fixed values", () => {
    const d = defaultSettings();
    expect(d.stoch).toEqual({ k: 14, smooth: 3, d: 3 });
    expect(d.ichimoku).toEqual({ conversion: 9, base: 26, spanB: 52, displacement: 26 });
    expect(d.supertrend).toEqual({ length: 10, multiplier: 3 });
    expect(d.pivotType).toBe("classic");
  });

  it("clamps, rounds and rejects bad values", () => {
    const s = cleanSettings({ stoch: { k: 0, smooth: 7.6, d: "x" }, psar: { step: 0.5, max: 0.1 }, supertrend: { multiplier: 99 }, pivotType: "nope" });
    expect(s.stoch).toEqual({ k: 1, smooth: 8, d: 3 });
    expect(s.psar).toEqual({ step: 0.5, max: 0.5 });
    expect(s.supertrend.multiplier).toBe(10);
    expect(s.pivotType).toBe("classic");
    expect(cleanSettings({ pivotType: "woodie" }).pivotType).toBe("woodie");
  });
});

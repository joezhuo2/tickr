import { describe, expect, it } from "vitest";
import { CHART_PATTERN_INFO, CHART_PATTERN_KINDS, PATTERN_INFO, PATTERN_KINDS, patternInfo } from "./patternInfo";

describe("pattern info", () => {
  it("explains every pattern kind", () => {
    for (const kind of PATTERN_KINDS) {
      const info = PATTERN_INFO[kind];
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.text.length).toBeGreaterThan(20);
    }
    expect(Object.keys(PATTERN_INFO).sort()).toEqual([...PATTERN_KINDS].sort());
  });

  it("explains every chart pattern kind", () => {
    for (const kind of CHART_PATTERN_KINDS) {
      const info = CHART_PATTERN_INFO[kind];
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.text.length).toBeGreaterThan(20);
      expect(patternInfo(kind)).toBe(info);
    }
    expect(Object.keys(CHART_PATTERN_INFO).sort()).toEqual([...CHART_PATTERN_KINDS].sort());
  });

  it("ignores unknown kinds", () => {
    expect(patternInfo("hammer")?.name).toBe("Hammer");
    expect(patternInfo("toString")).toBeNull();
  });
});

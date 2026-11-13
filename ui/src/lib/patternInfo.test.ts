import { describe, expect, it } from "vitest";
import { PATTERN_INFO, PATTERN_KINDS, patternInfo } from "./patternInfo";

describe("pattern info", () => {
  it("explains every pattern kind", () => {
    for (const kind of PATTERN_KINDS) {
      const info = PATTERN_INFO[kind];
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.text.length).toBeGreaterThan(20);
    }
    expect(Object.keys(PATTERN_INFO).sort()).toEqual([...PATTERN_KINDS].sort());
  });

  it("ignores unknown kinds", () => {
    expect(patternInfo("hammer")?.name).toBe("Hammer");
    expect(patternInfo("toString")).toBeNull();
  });
});

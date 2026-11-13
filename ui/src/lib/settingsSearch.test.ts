import { describe, expect, it } from "vitest";
import { SETTINGS, matchSettings } from "./settingsSearch";

describe("settings search", () => {
  it("suggests the first settings when the query is empty", () => {
    expect(matchSettings("  ").map((e) => e.label)).toEqual(SETTINGS.slice(0, 8).map((e) => e.label));
  });

  it("ranks label prefixes, then label matches, then section matches", () => {
    const found = matchSettings("the");
    expect(found[0].label).toBe("Theme");
    expect(matchSettings("model").map((e) => e.label)).toEqual(["Model", "News model", "Events model"]);
    expect(matchSettings("backup").map((e) => e.label)).toEqual(["Export", "Import"]);
    expect(matchSettings("zzz")).toEqual([]);
    expect(matchSettings("auto an")[0]).toMatchObject({ label: "Auto analyze", tab: "chart" });
    expect(matchSettings("head and")[0]).toMatchObject({ label: "Head and shoulders", section: "Technical analysis" });
  });

  it("points hotkey entries at their category and respects the limit", () => {
    const hit = matchSettings("ruler")[0];
    expect(hit).toMatchObject({ tab: "hotkeys", group: "draw" });
    expect(matchSettings("hotkeys", SETTINGS, 5)).toHaveLength(5);
    expect(new Set(SETTINGS.map((e) => `${e.tab} ${e.group ?? ""} ${e.label}`)).size).toBe(SETTINGS.length);
  });
});

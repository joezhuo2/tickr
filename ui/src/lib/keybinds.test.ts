import { describe, expect, it } from "vitest";
import { actionFor, bindKey, keyLabel, rebind } from "./keybinds";
import type { Keybinds } from "./types";

const DEFAULTS: Keybinds = {
  chart_mode: "c",
  refresh: "r",
  range: "v",
  technicals: "t",
  analysts: "a",
  earnings: "e",
  watchlist: "x",
  search: "s",
  settings: ",",
};

const down = (key: string, mods: Partial<Record<"ctrlKey" | "altKey" | "metaKey", boolean>> = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("bindKey", () => {
  it("lowercases characters and keeps key names", () => {
    expect(bindKey(down("C"))).toBe("c");
    expect(bindKey(down("F5"))).toBe("F5");
  });
  it("rejects chords and reserved keys", () => {
    expect(bindKey(down("c", { ctrlKey: true }))).toBeNull();
    expect(bindKey(down("Shift"))).toBeNull();
    expect(bindKey(down("Escape"))).toBeNull();
  });
});

describe("actionFor", () => {
  it("finds the action on a key", () => {
    expect(actionFor(DEFAULTS, "t")).toBe("technicals");
    expect(actionFor(DEFAULTS, ",")).toBe("settings");
    expect(actionFor(DEFAULTS, "q")).toBeNull();
    expect(actionFor({ ...DEFAULTS, search: "" }, "")).toBeNull();
  });
});

describe("rebind", () => {
  it("swaps with an action already on the key", () => {
    const next = rebind(DEFAULTS, "refresh", "c");
    expect(next.refresh).toBe("c");
    expect(next.chart_mode).toBe("r");
  });
  it("leaves others alone on a free key", () => {
    expect(rebind(DEFAULTS, "refresh", "F5")).toEqual({ ...DEFAULTS, refresh: "F5" });
  });
  it("swaps the Settings shortcut and allows it to be unbound", () => {
    const next = rebind(DEFAULTS, "settings", "s");
    expect(next.settings).toBe("s");
    expect(next.search).toBe(",");
    expect(actionFor({ ...next, settings: "" }, "s")).toBeNull();
  });
});

describe("keyLabel", () => {
  it("shows characters uppercase and unbound as a dash", () => {
    expect(keyLabel("c")).toBe("C");
    expect(keyLabel("F5")).toBe("F5");
    expect(keyLabel("")).toBe("—");
  });
});

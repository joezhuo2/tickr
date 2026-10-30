import { describe, expect, it } from "vitest";
import { ACTIONS, CATEGORIES, actionFor, groupActions, bindKey, keyLabel, rebind } from "./keybinds";
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
  toggle_watchlist: "w",
  alerts: "p",
  market: "m",
  news: "n",
  analyze: "z",
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
    expect(actionFor(DEFAULTS, "w")).toBe("toggle_watchlist");
    expect(actionFor(DEFAULTS, "x")).toBe("watchlist");
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
  it("keeps Watchlist toggling separate from cycling stocks when rebound", () => {
    const next = rebind(DEFAULTS, "toggle_watchlist", "x");
    expect(actionFor(next, "x")).toBe("toggle_watchlist");
    expect(actionFor(next, "w")).toBe("watchlist");
    expect(actionFor({ ...next, toggle_watchlist: "" }, "x")).toBeNull();
  });
});

describe("keyLabel", () => {
  it("shows characters uppercase and unbound as a dash", () => {
    expect(keyLabel("c")).toBe("C");
    expect(keyLabel("F5")).toBe("F5");
    expect(keyLabel("")).toBe("—");
  });
});

describe("groupActions", () => {
  it("lists every action once, in category order", () => {
    const groups = groupActions();
    expect(groups.map((g) => g.id)).toEqual(CATEGORIES.map((c) => c.id));
    const ids = groups.flatMap((g) => g.actions.map((a) => a.id));
    expect(ids).toHaveLength(ACTIONS.length);
    expect(new Set(ids)).toEqual(new Set(Object.keys(DEFAULTS)));
  });
  it("keeps actions in their declared order within a group", () => {
    const panels = groupActions().find((g) => g.id === "panels")!;
    expect(panels.actions.map((a) => a.id)).toEqual(["technicals", "analyze", "analysts", "earnings", "alerts", "market", "news"]);
  });
});

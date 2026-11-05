import { describe, expect, it } from "vitest";
import { ACTIONS, CATEGORIES, actionFor, groupActions, bindKey, keyLabel, nextGroupTab, practiceAllows, rebind, replayAllows } from "./keybinds";
import type { Keybinds } from "./types";

const DEFAULTS: Keybinds = {
  chart_mode: "c",
  chart_scale: "l",
  chart_interval: "i",
  draw_level: "1",
  draw_trend: "2",
  draw_text: "3",
  draw_ruler: "4",
  draw_pen: "5",
  chart_split: "j",
  chart_replay: "y",
  practice: "q",
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
  options: "o",
  paper: "h",
  options_side: "u",
  options_expiry: "d",
  add_watchlist: "f",
  events: "k",
  next_group: "g",
  previous_symbol: "b",
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
    expect(actionFor(DEFAULTS, "6")).toBeNull();
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

describe("chart_split", () => {
  it("is a chart action on J that can be rebound and unbound", () => {
    expect(actionFor(DEFAULTS, "j")).toBe("chart_split");
    expect(ACTIONS.find((a) => a.id === "chart_split")?.category).toBe("chart");
    const next = rebind(DEFAULTS, "chart_split", "c");
    expect(actionFor(next, "c")).toBe("chart_split");
    expect(actionFor(next, "j")).toBe("chart_mode");
    expect(actionFor({ ...DEFAULTS, chart_split: "" }, "j")).toBeNull();
  });
});

describe("chart_replay", () => {
  it("is a chart action on Y that can be rebound and unbound", () => {
    expect(actionFor(DEFAULTS, "y")).toBe("chart_replay");
    expect(ACTIONS.find((a) => a.id === "chart_replay")?.category).toBe("chart");
    const next = rebind(DEFAULTS, "chart_replay", "j");
    expect(actionFor(next, "j")).toBe("chart_replay");
    expect(actionFor(next, "y")).toBe("chart_split");
    expect(actionFor({ ...DEFAULTS, chart_replay: "" }, "y")).toBeNull();
  });
  it("does not use the replay control keys", () => {
    for (const key of [" ", "Escape", "ArrowLeft", "ArrowRight"]) expect(actionFor(DEFAULTS, key)).toBeNull();
    expect(bindKey(down(" "))).toBeNull();
    expect(bindKey(down("Escape"))).toBeNull();
  });
  it("blocks panels, drawing and the second chart during replay", () => {
    for (const id of ["chart_replay", "chart_mode", "chart_scale", "technicals", "paper", "analyze", "settings"] as const) expect(replayAllows(id)).toBe(true);
    for (const id of ["news", "earnings", "analysts", "options", "market", "events", "alerts", "toggle_watchlist", "chart_split", "draw_level", "draw_pen"] as const) expect(replayAllows(id)).toBe(false);
  });
});

describe("practice", () => {
  it("is a chart action on Q that can be rebound and unbound", () => {
    expect(actionFor(DEFAULTS, "q")).toBe("practice");
    expect(ACTIONS.find((a) => a.id === "practice")?.category).toBe("chart");
    const next = rebind(DEFAULTS, "practice", "y");
    expect(actionFor(next, "y")).toBe("practice");
    expect(actionFor(next, "q")).toBe("chart_replay");
    expect(actionFor({ ...DEFAULTS, practice: "" }, "q")).toBeNull();
  });
  it("can be reached from bar replay", () => {
    expect(replayAllows("practice")).toBe(true);
  });
  it("allows only view-only actions during practice", () => {
    for (const id of ["practice", "chart_mode", "chart_scale", "technicals", "analyze", "settings"] as const) expect(practiceAllows(id)).toBe(true);
    for (const id of ["chart_replay", "chart_interval", "range", "refresh", "paper", "search", "previous_symbol", "watchlist", "add_watchlist", "news", "earnings", "analysts", "alerts", "options", "market", "events", "toggle_watchlist", "next_group", "chart_split", "draw_level", "draw_pen"] as const) expect(practiceAllows(id)).toBe(false);
  });
});

describe("paper", () => {
  it("is a panel action on H that can be rebound and unbound", () => {
    expect(actionFor(DEFAULTS, "h")).toBe("paper");
    expect(ACTIONS.find((a) => a.id === "paper")?.category).toBe("panels");
    const next = rebind(DEFAULTS, "paper", "y");
    expect(actionFor(next, "y")).toBe("paper");
    expect(actionFor(next, "h")).toBe("chart_replay");
    expect(actionFor({ ...DEFAULTS, paper: "" }, "h")).toBeNull();
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
    expect(panels.actions.map((a) => a.id)).toEqual(["technicals", "analyze", "analysts", "earnings", "alerts", "market", "events", "news", "options", "paper"]);
  });
  it("puts the options actions in their own group", () => {
    const options = groupActions().find((g) => g.id === "options")!;
    expect(options.actions.map((a) => a.id)).toEqual(["options_side", "options_expiry"]);
  });
  it("gives every default a distinct key", () => {
    const keys = Object.values(DEFAULTS);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("nextGroupTab", () => {
  it("goes from All through each group and back to All", () => {
    expect(nextGroupTab(["Tech", "Bank"], null)).toBe("Tech");
    expect(nextGroupTab(["Tech", "Bank"], "Tech")).toBe("Bank");
    expect(nextGroupTab(["Tech", "Bank"], "Bank")).toBeNull();
  });
  it("goes to the first group when the current one is gone", () => {
    expect(nextGroupTab(["Tech"], "Old")).toBe("Tech");
  });
  it("stays on All with no groups", () => {
    expect(nextGroupTab([], null)).toBeNull();
    expect(nextGroupTab([], "Old")).toBeNull();
  });
});

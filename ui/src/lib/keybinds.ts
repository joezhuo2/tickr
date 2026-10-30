// In-window shortcuts: single keys, matched without Ctrl, Alt or Cmd.

import type { Keybinds } from "./types";

export type Action = keyof Keybinds;

export type Category = "chart" | "panels" | "options" | "watchlist" | "general";

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "chart", label: "Chart" },
  { id: "panels", label: "Panels" },
  { id: "options", label: "Options" },
  { id: "watchlist", label: "Watchlist" },
  { id: "general", label: "General" },
];

export const ACTIONS: { id: Action; label: string; category: Category }[] = [
  { id: "chart_mode", label: "Switch line / candles", category: "chart" },
  { id: "range", label: "Cycle date range", category: "chart" },
  { id: "refresh", label: "Refresh", category: "chart" },
  { id: "technicals", label: "Open Technicals", category: "panels" },
  { id: "analyze", label: "Analyze / re-analyze", category: "panels" },
  { id: "analysts", label: "Open Analysts", category: "panels" },
  { id: "earnings", label: "Open Earnings", category: "panels" },
  { id: "alerts", label: "Open Alerts", category: "panels" },
  { id: "market", label: "Open Market", category: "panels" },
  { id: "news", label: "Open News", category: "panels" },
  { id: "options", label: "Open Options", category: "panels" },
  { id: "options_side", label: "Switch calls / puts", category: "options" },
  { id: "options_expiry", label: "Next expiry date", category: "options" },
  { id: "toggle_watchlist", label: "Toggle Watchlist", category: "watchlist" },
  { id: "watchlist", label: "Next watchlist stock", category: "watchlist" },
  { id: "add_watchlist", label: "Add stock to Watchlist", category: "watchlist" },
  { id: "search", label: "Focus search", category: "general" },
  { id: "settings", label: "Toggle Settings", category: "general" },
];

export function groupActions(): { id: Category; label: string; actions: typeof ACTIONS }[] {
  return CATEGORIES.map((c) => ({ ...c, actions: ACTIONS.filter((a) => a.category === c.id) })).filter((g) => g.actions.length);
}

const RESERVED = new Set(["Shift", "Control", "Alt", "Meta", "Escape", "Tab", "Enter", " ", "CapsLock", "Dead", "Unidentified"]);

/** The binding for a keydown: a lowercase character or a key name ("F5"), or null when it can't be bound. */
export function bindKey(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): string | null {
  if (e.ctrlKey || e.altKey || e.metaKey || RESERVED.has(e.key)) return null;
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

export function actionFor(binds: Keybinds, key: string): Action | null {
  if (!key) return null;
  return ACTIONS.find((a) => binds[a.id] === key)?.id ?? null;
}

/** Binds `key` to `id`; an action already on that key takes `id`'s old key. */
export function rebind(binds: Keybinds, id: Action, key: string): Keybinds {
  const next = { ...binds };
  const other = actionFor(binds, key);
  if (other) next[other] = binds[id];
  next[id] = key;
  return next;
}

export function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key || "—";
}

// In-window shortcuts: single keys, matched without Ctrl, Alt or Cmd.

import type { Keybinds } from "./types";

export type Action = keyof Keybinds;

export const ACTIONS: { id: Action; label: string }[] = [
  { id: "chart_mode", label: "Switch line / candles" },
  { id: "refresh", label: "Refresh" },
  { id: "range", label: "Cycle date range" },
  { id: "technicals", label: "Open Technicals" },
  { id: "analysts", label: "Open Analysts" },
  { id: "earnings", label: "Open Earnings" },
  { id: "watchlist", label: "Next watchlist stock" },
  { id: "search", label: "Focus search" },
];

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

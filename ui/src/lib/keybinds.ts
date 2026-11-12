// In-window shortcuts: single keys, matched without Ctrl, Alt or Cmd.

import type { Keybinds, Overlays } from "./types";

export type Action = keyof Keybinds;

export type Category = "general" | "chart" | "draw" | "indicators" | "panels" | "options" | "watchlist";

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "general", label: "General" },
  { id: "chart", label: "Chart" },
  { id: "draw", label: "Draw" },
  { id: "indicators", label: "Indicators" },
  { id: "panels", label: "Panels" },
  { id: "options", label: "Options" },
  { id: "watchlist", label: "Watchlist" },
];

export const ACTIONS: { id: Action; label: string; category: Category }[] = [
  { id: "chart_mode", label: "Cycle chart type", category: "chart" },
  { id: "chart_scale", label: "Cycle price scale", category: "chart" },
  { id: "chart_interval", label: "Cycle candle length", category: "chart" },
  { id: "draw_level", label: "Draw level", category: "draw" },
  { id: "draw_trend", label: "Draw trendline", category: "draw" },
  { id: "draw_text", label: "Draw text", category: "draw" },
  { id: "draw_ruler", label: "Ruler", category: "draw" },
  { id: "draw_pen", label: "Draw freehand", category: "draw" },
  { id: "draw_rect", label: "Draw box", category: "draw" },
  { id: "draw_ray", label: "Draw ray", category: "draw" },
  { id: "draw_fib", label: "Draw Fibonacci retracement", category: "draw" },
  { id: "draw_position", label: "Draw long / short position", category: "draw" },
  { id: "draw_avwap", label: "Anchored VWAP", category: "draw" },
  { id: "chart_split", label: "Toggle second chart", category: "chart" },
  { id: "chart_replay", label: "Toggle bar replay", category: "chart" },
  { id: "practice", label: "Practice on a random setup", category: "chart" },
  { id: "range", label: "Cycle date range", category: "chart" },
  { id: "refresh", label: "Refresh", category: "chart" },
  { id: "toggle_opening_range", label: "Toggle opening range", category: "indicators" },
  { id: "toggle_levels", label: "Toggle key levels", category: "indicators" },
  { id: "toggle_volume_ma", label: "Toggle volume average", category: "indicators" },
  { id: "toggle_volume_profile", label: "Toggle volume profile", category: "indicators" },
  { id: "technicals", label: "Open Technicals", category: "panels" },
  { id: "analyze", label: "Analyze / re-analyze", category: "panels" },
  { id: "analysts", label: "Open Analysts", category: "panels" },
  { id: "earnings", label: "Open Earnings", category: "panels" },
  { id: "alerts", label: "Open Alerts", category: "panels" },
  { id: "market", label: "Open Market", category: "panels" },
  { id: "events", label: "Open Events", category: "panels" },
  { id: "news", label: "Open News", category: "panels" },
  { id: "options", label: "Open Options", category: "panels" },
  { id: "paper", label: "Open Paper trading", category: "panels" },
  { id: "backtest", label: "Open Strategy backtest", category: "panels" },
  { id: "options_side", label: "Switch calls / puts", category: "options" },
  { id: "options_expiry", label: "Next expiry date", category: "options" },
  { id: "toggle_watchlist", label: "Toggle Watchlist", category: "watchlist" },
  { id: "watchlist", label: "Next watchlist stock", category: "watchlist" },
  { id: "add_watchlist", label: "Add stock to Watchlist", category: "watchlist" },
  { id: "next_group", label: "Next watchlist group", category: "watchlist" },
  { id: "search", label: "Focus search", category: "general" },
  { id: "previous_symbol", label: "Previous symbol", category: "general" },
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

const REPLAY_ACTIONS = new Set<Action>(["chart_mode", "chart_scale", "chart_interval", "chart_replay", "practice", "range", "refresh", "technicals", "paper", "analyze", "toggle_opening_range", "toggle_levels", "toggle_volume_ma", "toggle_volume_profile", "search", "previous_symbol", "watchlist", "add_watchlist", "settings"]);

export function replayAllows(action: Action): boolean {
  return REPLAY_ACTIONS.has(action);
}

const PRACTICE_ACTIONS = new Set<Action>(["chart_mode", "chart_scale", "practice", "technicals", "analyze", "settings"]);

export function practiceAllows(action: Action): boolean {
  return PRACTICE_ACTIONS.has(action);
}

/** The overlay an indicator toggle action switches. */
export function overlayFor(action: Action): keyof Overlays | null {
  return action.startsWith("toggle_") && action !== "toggle_watchlist" ? (action.slice(7) as keyof Overlays) : null;
}

export function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key || "—";
}

export function nextGroupTab(names: string[], tab: string | null): string | null {
  if (!names.length) return null;
  if (tab === null) return names[0];
  const i = names.indexOf(tab);
  return i < 0 ? names[0] : (names[i + 1] ?? null);
}

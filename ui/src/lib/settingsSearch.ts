import { TOKENS } from "./display";
import { groupActions, type Category } from "./keybinds";
import { OVERLAY_TOGGLES } from "./indicators";
import { CHART_PATTERN_INFO, CHART_PATTERN_KINDS } from "./patternInfo";

export type SettingsTab = "display" | "hotkeys" | "chart" | "data" | "ai" | "backup" | "connections";

export interface SettingEntry {
  label: string;
  section: string;
  tab: SettingsTab;
  group?: Category;
  part?: ChartGroup;
}

export const CHART_GROUPS = [
  { id: "sessions", label: "Sessions" },
  { id: "live", label: "Live updates" },
  { id: "limits", label: "Limits" },
  { id: "drawings", label: "Drawings" },
  { id: "dots", label: "Dots" },
  { id: "alerts", label: "Alerts" },
  { id: "notifications", label: "Notifications" },
  { id: "analysis", label: "Analysis" },
  { id: "patterns", label: "Patterns" },
] as const;
export type ChartGroup = (typeof CHART_GROUPS)[number]["id"];

const entry = (tab: SettingsTab, section: string, labels: string[]): SettingEntry[] => labels.map((label) => ({ label, section, tab }));
const chart = (part: ChartGroup, labels: string[]): SettingEntry[] =>
  labels.map((label) => ({ label, section: `Chart · ${CHART_GROUPS.find((g) => g.id === part)?.label}`, tab: "chart", part }));

export const SETTINGS: SettingEntry[] = [
  ...entry("display", "Display", ["Show tour", "Theme", "Main color", "Sub color", "Font", "Number font", "Text size", "Gain/loss colors", "Background refresh", "Reset all colors", ...TOKENS.map((t) => t.label)]),
  { label: "Show or hide tickr", section: "Hotkeys · General", tab: "hotkeys", group: "general" },
  { label: "Reset all keybinds", section: "Hotkeys · General", tab: "hotkeys", group: "general" },
  ...groupActions().flatMap((g) => g.actions.map((a) => ({ label: a.label, section: `Hotkeys · ${g.label}`, tab: "hotkeys" as const, group: g.id }))),
  ...chart("sessions", ["Extended-hours candles", "Shade pre-market and after-hours", "Chart times"]),
  ...chart("live", ["Live candles", "Chart refresh", "Live update rate"]),
  ...chart("limits", ["Maximum candles to load", "Backtest sweep limit", "Compare overlay limit"]),
  ...chart("drawings", ["R:R reward multiple"]),
  ...chart("dots", ["Earnings", "News", "Analyst ratings"]),
  ...chart("alerts", ["Check indicator and drawing alerts in the background"]),
  ...chart("notifications", ["Do not disturb", "Daily digest"]),
  ...chart("analysis", ["Auto analyze", ...OVERLAY_TOGGLES.map((o) => o.label)]),
  ...chart("patterns", ["Minimum candles for patterns"]),
  ...chart("patterns", CHART_PATTERN_KINDS.map((k) => CHART_PATTERN_INFO[k].name)),
  ...entry("data", "Market data", ["Provider", "Clear cached history", "SEC contact email"]),
  ...entry("ai", "AI", ["News analysis", "Base URL", "Model", "News model", "Events model", "API key"]),
  ...entry("backup", "Backup", ["Export", "Import"]),
  ...entry("connections", "Connections", ["Copy diagnostics", "Save crash reports", "Clear crash reports"]),
];

export function matchSettings(query: string, entries: readonly SettingEntry[] = SETTINGS, limit = 8): SettingEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, limit);
  const rank = (e: SettingEntry) => {
    const label = e.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (label.includes(q)) return 1;
    return e.section.toLowerCase().includes(q) ? 2 : 3;
  };
  return entries
    .map((e, i) => ({ e, i, r: rank(e) }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}

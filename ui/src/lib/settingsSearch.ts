import { TOKENS } from "./display";
import { groupActions, type Category } from "./keybinds";

export type SettingsTab = "display" | "hotkeys" | "chart" | "data" | "ai" | "backup" | "connections";

export interface SettingEntry {
  label: string;
  section: string;
  tab: SettingsTab;
  group?: Category;
}

const entry = (tab: SettingsTab, section: string, labels: string[]): SettingEntry[] => labels.map((label) => ({ label, section, tab }));

export const SETTINGS: SettingEntry[] = [
  ...entry("display", "Display", ["Theme", "Main color", "Sub color", "Font", "Number font", "Text size", "Gain/loss colors", "Background refresh", "Reset all colors", ...TOKENS.map((t) => t.label)]),
  { label: "Show or hide tickr", section: "Hotkeys · General", tab: "hotkeys", group: "general" },
  ...groupActions().flatMap((g) => g.actions.map((a) => ({ label: a.label, section: `Hotkeys · ${g.label}`, tab: "hotkeys" as const, group: g.id }))),
  ...entry("chart", "Chart", ["Extended-hours candles", "Shade pre-market and after-hours", "Chart times", "Earnings", "News", "Analyst ratings"]),
  ...entry("chart", "Chart alerts", ["Check indicator and drawing alerts in the background"]),
  ...entry("data", "Market data", ["Provider", "Clear cached history"]),
  ...entry("ai", "AI", ["News analysis", "Base URL", "Model", "News model", "Events model", "API key"]),
  ...entry("backup", "Backup", ["Export", "Import"]),
  ...entry("connections", "Connections", ["Copy diagnostics"]),
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

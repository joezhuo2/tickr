export interface TourStep {
  id: string;
  selector: string | null;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  { id: "tray", selector: null, title: "Welcome to tickr", body: "tickr lives in your tray or menu bar. Use the global hotkey to show or hide this window from anywhere; you can change it in Settings > Hotkeys." },
  { id: "search", selector: ".search-open", title: "Search and commands", body: "Press Ctrl/Cmd+K or S to find a symbol or run a command such as \"nvda 1y\", \"alert nvda >= 170\" or \"tour\"." },
  { id: "chart", selector: "select[aria-label=\"Chart type\"]", title: "Chart types and drawings", body: "Switch between line, candles and other chart types here. The toolbar on the chart holds the drawing tools." },
  { id: "panels", selector: ".range-controls .ranges", title: "Ranges and panels", body: "Pick a range, or open Technicals, Analysts, Earnings, Stats and more. News and Options sit in the toolbar above." },
  { id: "star", selector: ".title .star:not(.bell)", title: "Watchlist and alerts", body: "The star adds this symbol to your watchlist. The bell beside it opens price alerts." },
  { id: "settings", selector: "button.gear", title: "Settings", body: "Themes, keybinds, data sources, backup and the Show tour action live in Settings." },
];

export function availableSteps(steps: readonly TourStep[], has: (selector: string) => boolean): TourStep[] {
  return steps.filter((s) => s.selector === null || has(s.selector));
}

export function move(index: number, delta: number, count: number): number {
  return Math.min(count - 1, Math.max(0, index + delta));
}

import { claim, type ChartAlert } from "./chartAlerts";

const KEY = "tickr.chartAlerts";

function load(): ChartAlert[] | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((a) => a && typeof a.id === "number" && typeof a.symbol === "string") : [];
  } catch {
    return null;
  }
}

export const chartAlerts = $state<{ list: ChartAlert[] }>({ list: load() ?? [] });

addEventListener("storage", (e) => {
  if (e.key === KEY) chartAlerts.list = load() ?? chartAlerts.list;
});

export function setChartAlerts(next: ChartAlert[]) {
  chartAlerts.list = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
}

export function claimChartAlerts(ids: ReadonlySet<number>, now: number): ChartAlert[] {
  // shortcut: localStorage has no lock, so two windows checking the same candle in the same instant could both fire; move chart alerts to the backend if duplicates show up
  const r = claim(load() ?? chartAlerts.list, ids, now);
  if (r.claimed.length) setChartAlerts(r.list);
  return r.claimed;
}

import type { ChartAlert } from "./chartAlerts";

const KEY = "tickr.chartAlerts";

function load(): ChartAlert[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((a) => a && typeof a.id === "number" && typeof a.symbol === "string") : [];
  } catch {
    return [];
  }
}

export const chartAlerts = $state<{ list: ChartAlert[] }>({ list: load() });

export function setChartAlerts(next: ChartAlert[]) {
  chartAlerts.list = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
}

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { aggregateChart } from "./aggregate";
import { addError, claim, type ChartAlert, type LineSpec } from "./chartAlerts";
import { CONCURRENCY, dueGroups, groups, triggered, type Group } from "./chartAlertSchedule";
import { clockFor } from "./strategy";
import type { Chart } from "./types";

const KEY = "tickr.chartAlerts";

function load(): ChartAlert[] | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((a) => a && typeof a.id === "number" && typeof a.symbol === "string") : [];
  } catch {
    return null;
  }
}

export const chartAlerts = $state<{ list: ChartAlert[]; background: boolean }>({ list: load() ?? [], background: false });

addEventListener("storage", (e) => {
  if (e.key === KEY) chartAlerts.list = load() ?? chartAlerts.list;
});

export function setChartAlerts(next: ChartAlert[]) {
  chartAlerts.list = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
}

export function addChartAlert(symbol: string, interval: string, label: string, expr: string | null, line: LineSpec | null): { id: number } | { error: string } {
  const error = !interval ? "Load a chart first" : addError(chartAlerts.list, expr);
  if (error) return { error };
  const id = chartAlerts.list.reduce((m, a) => Math.max(m, a.id), 0) + 1;
  setChartAlerts([...chartAlerts.list, { id, symbol: symbol.toUpperCase(), interval, label, expr, line, enabled: true, fired_at: null }]);
  return { id };
}

function claimChartAlerts(ids: ReadonlySet<number>, now: number): ChartAlert[] {
  // shortcut: localStorage has no lock, so two windows checking the same candle in the same instant could both fire; move chart alerts to the backend if duplicates show up
  const r = claim(load() ?? chartAlerts.list, ids, now);
  if (r.claimed.length) setChartAlerts(r.list);
  return r.claimed;
}

export function fireChartAlerts(pick: (list: ChartAlert[]) => ChartAlert[]) {
  const fired = pick(chartAlerts.list);
  if (!fired.length) return;
  const claimed = claimChartAlerts(new Set(fired.map((a) => a.id)), Math.floor(Date.now() / 1000));
  for (const a of claimed) invoke("send_notification", { title: `tickr · ${a.symbol} chart alert`, body: `${a.label} (${a.interval})` }).catch(console.warn);
}

const checked = new Map<string, number>();
const seen = new Map<string, number>();
let busy = false;

async function check(g: Group, now: number) {
  checked.set(g.key, now);
  // shortcut: background checks use regular-session candles, add extended hours if users ask for pre/post crosses
  const c = await invoke<Chart>("get_chart", { symbol: g.symbol, range: g.range, interval: g.base, extended: false, secondary: true });
  const since = seen.get(g.key) ?? null;
  seen.set(g.key, now);
  if (c.interval === g.base) fireChartAlerts((list) => triggered(list, g.symbol, g.interval, aggregateChart(c, g.interval).candles, clockFor(c.meta), since));
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const now = Math.floor(Date.now() / 1000);
    const queue = dueGroups(groups(chartAlerts.list), checked, now);
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (let g = queue.shift(); g; g = queue.shift()) await check(g, now).catch(console.warn);
    }));
  } finally {
    busy = false;
  }
}

export function startBackgroundChartAlerts(): () => void {
  if (getCurrentWindow().label !== "main") return () => {};
  const un = listen("chart-alerts-tick", () => void tick());
  return () => void un.then((f) => f());
}

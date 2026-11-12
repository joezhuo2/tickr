import { MAX_CHART_ALERTS, type ChartAlert } from "./chartAlerts";
import { sanitizeCustom, type Custom } from "./display";
import { STUDIES } from "./studies";

export interface LocalBackup {
  custom?: Custom;
  studies?: Record<string, boolean>;
  chart_alerts?: ChartAlert[];
  magnet?: boolean;
}

type Store = Pick<Storage, "getItem" | "setItem">;

const KEYS = { custom: "tickr.custom", studies: "tickr.studies", chart_alerts: "tickr.chartAlerts", magnet: "tickr.magnet" };

function read(store: Store, key: string): unknown {
  try { return JSON.parse(store.getItem(key) ?? "null"); } catch { return null; }
}

function cleanStudies(v: unknown): Record<string, boolean> {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(STUDIES.map((s) => [s.id, o[s.id] === true]));
}

function cleanAlerts(v: unknown): ChartAlert[] {
  if (!Array.isArray(v)) return [];
  return v.filter((a) => a && typeof a.id === "number" && typeof a.symbol === "string").slice(0, MAX_CHART_ALERTS);
}

export function collectLocal(store: Store): LocalBackup {
  const out: LocalBackup = {};
  const custom = read(store, KEYS.custom);
  const studies = read(store, KEYS.studies);
  const alerts = read(store, KEYS.chart_alerts);
  if (custom != null) out.custom = sanitizeCustom(custom);
  if (studies != null) out.studies = cleanStudies(studies);
  if (alerts != null) out.chart_alerts = cleanAlerts(alerts);
  out.magnet = store.getItem(KEYS.magnet) === "1";
  return out;
}

export function parseLocal(text: string): LocalBackup {
  const root = JSON.parse(text);
  const l = root && typeof root === "object" && root.local && typeof root.local === "object" ? root.local : {};
  const out: LocalBackup = {};
  if ("custom" in l) out.custom = sanitizeCustom(l.custom);
  if ("studies" in l) out.studies = cleanStudies(l.studies);
  if ("chart_alerts" in l) out.chart_alerts = cleanAlerts(l.chart_alerts);
  if (typeof l.magnet === "boolean") out.magnet = l.magnet;
  return out;
}

export function applyLocal(store: Store, local: LocalBackup) {
  try {
    if (local.custom) store.setItem(KEYS.custom, JSON.stringify(local.custom));
    if (local.studies) store.setItem(KEYS.studies, JSON.stringify(local.studies));
    if (local.chart_alerts) store.setItem(KEYS.chart_alerts, JSON.stringify(local.chart_alerts));
    if (local.magnet !== undefined) store.setItem(KEYS.magnet, local.magnet ? "1" : "0");
  } catch { /* storage unavailable */ }
}

export function withLocal(text: string, store: Store): string {
  return JSON.stringify({ ...JSON.parse(text), local: collectLocal(store) }, null, 2);
}

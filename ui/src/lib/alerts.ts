import { num } from "./format";
import type { PriceAlert } from "./types";

export type AlertStatus = "armed" | "triggered" | "paused";
export type AlertFilter = "all" | AlertStatus;

export const ALERT_FILTERS: { key: AlertFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "armed", label: "Armed" },
  { key: "triggered", label: "Triggered" },
  { key: "paused", label: "Paused" },
];

type StatusFields = Pick<PriceAlert, "enabled" | "recurring" | "triggered_at">;

export function alertStatus(a: StatusFields): AlertStatus {
  if (a.enabled) return "armed";
  return a.recurring || a.triggered_at == null ? "paused" : "triggered";
}

export function filterAlerts<T extends StatusFields>(alerts: T[], filter: AlertFilter): T[] {
  return filter === "all" ? alerts : alerts.filter((a) => alertStatus(a) === filter);
}

export function sortAlerts<T extends Pick<PriceAlert, "id" | "triggered_at">>(alerts: T[], filter: AlertFilter): T[] {
  if (filter !== "triggered") return [...alerts];
  return [...alerts].sort((a, b) => (b.triggered_at ?? 0) - (a.triggered_at ?? 0) || a.id - b.id);
}

export function visibleAlerts<T extends StatusFields & Pick<PriceAlert, "id">>(alerts: T[], filter: AlertFilter): T[] {
  return sortAlerts(filterAlerts(alerts, filter), filter);
}

export function alertCounts(alerts: StatusFields[]): Record<AlertFilter, number> {
  const counts: Record<AlertFilter, number> = { all: alerts.length, armed: 0, triggered: 0, paused: 0 };
  for (const a of alerts) counts[alertStatus(a)]++;
  return counts;
}

export function emptyMessage(filter: AlertFilter): string {
  return filter === "all" ? "No price alerts yet." : `No ${filter} alerts.`;
}

export function fireTime(t: number, locale?: string, timeZone?: string): string {
  return new Date(t * 1000)
    .toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone })
    .replace(/\u202f/g, " ");
}

export interface TriggerInfo {
  label: "Triggered" | "Last fired";
  price: string | null;
  time: string;
}

export function triggerInfo(a: StatusFields & Pick<PriceAlert, "triggered_price">, locale?: string, timeZone?: string): TriggerInfo | null {
  if (a.triggered_at == null) return null;
  const price = a.triggered_price != null && Number.isFinite(a.triggered_price) && a.triggered_price > 0 ? num(a.triggered_price) : null;
  return {
    label: alertStatus(a) === "triggered" ? "Triggered" : "Last fired",
    price,
    time: fireTime(a.triggered_at, locale, timeZone),
  };
}

export function toggleLabel(status: AlertStatus): string {
  return status === "armed" ? "Pause" : status === "paused" ? "Resume" : "Rearm";
}

export function levelError(level: number | undefined | null, noun: string): string | null {
  if (level == null || !Number.isFinite(level) || level <= 0) return `Enter a ${noun.toLowerCase()} greater than zero.`;
  return null;
}

export function addedAlert<T extends { id: number }>(before: T[], after: T[]): T | undefined {
  const known = new Set(before.map((a) => a.id));
  return after.find((a) => !known.has(a.id));
}

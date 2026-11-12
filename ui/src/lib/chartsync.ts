import { indexToTime, timeToIndex } from "./drawing";
import { isIntraday } from "./session";
import { clamp, type View } from "./viewport";

export interface TimeWindow {
  from: number;
  to: number;
}

export function barSpan(times: number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) gaps.push(times[i] - times[i - 1]);
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

export function barAt(times: number[], t: number, span = barSpan(times)): number {
  const n = times.length;
  if (!n || !Number.isFinite(t) || t < times[0]) return -1;
  let lo = 0;
  let hi = n - 1;
  if (t >= times[hi]) lo = hi;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
  }
  if (t === times[lo]) return lo;
  const end = Math.min(lo + 1 < n ? times[lo + 1] : Infinity, times[lo] + span);
  return t < end ? lo : -1;
}

export function viewWindow(times: number[], view: View): TimeWindow | null {
  if (!times.length || !(view.count > 0)) return null;
  return { from: indexToTime(times, view.start - 0.5), to: indexToTime(times, view.start + view.count - 0.5) };
}

export function windowView(times: number[], w: TimeWindow): View | null {
  const n = times.length;
  if (!n || !Number.isFinite(w.from) || !Number.isFinite(w.to) || !(w.to > w.from)) return null;
  if (w.to <= times[0] || w.from >= times[n - 1] + barSpan(times)) return null;
  const start = Math.max(0, timeToIndex(times, w.from) + 0.5);
  const end = Math.min(n, timeToIndex(times, w.to) + 0.5);
  if (!(end > start)) return null;
  const fit = clamp({ start, count: end - start }, n);
  return clamp({ start: (start + end - fit.count) / 2, count: fit.count }, n);
}

export function secondaryDefaults(range: string, interval: string): { range: string; interval: string } {
  const intraday = interval === "auto" ? ["1d", "5d", "1mo"].includes(range) : isIntraday(interval);
  return intraday ? { range: "1y", interval: "1d" } : { range: "5d", interval: "auto" };
}

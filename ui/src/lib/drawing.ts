import type { Drawing, DrawingPoint } from "./types";

function spacing(times: number[]): number {
  return times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) || 1 : 1;
}

export function timeToIndex(times: number[], t: number): number {
  if (!times.length) return 0;
  const last = times.length - 1;
  if (t <= times[0]) return (t - times[0]) / spacing(times);
  if (t >= times[last]) return last + (t - times[last]) / spacing(times);
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  return lo + (t - times[lo]) / (times[hi] - times[lo]);
}

export function indexToTime(times: number[], i: number): number {
  if (!times.length) return 0;
  const last = times.length - 1;
  if (i <= 0) return times[0] + i * spacing(times);
  if (i >= last) return times[last] + (i - last) * spacing(times);
  const lo = Math.floor(i);
  return times[lo] + (i - lo) * (times[lo + 1] - times[lo]);
}

export interface Pixel { x: number; y: number }
export function segmentDistance(p: Pixel, a: Pixel, b: Pixel): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const f = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - f * dx, p.y - a.y - f * dy);
}
export function hitTest(p: Pixel, a: Pixel, b?: Pixel): boolean {
  return (b ? segmentDistance(p, a, b) : Math.abs(p.y - a.y)) <= 6;
}

export interface History { past: Drawing[][]; present: Drawing[]; future: Drawing[][] }
export function undoReducer(state: History, action: Drawing[] | "undo" | "redo"): History {
  if (action === "undo") return state.past.length ? { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] } : state;
  if (action === "redo") return state.future.length ? { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) } : state;
  return { past: [...state.past, state.present], present: action, future: [] };
}

export function rulerMeasurement(a: DrawingPoint, b: DrawingPoint, times: number[]) {
  const delta = b.price - a.price;
  const percent = delta / a.price * 100;
  const bars = Math.round(Math.abs(timeToIndex(times, b.t) - timeToIndex(times, a.t)));
  const seconds = Math.abs(b.t - a.t);
  const elapsed = seconds >= 86400 ? `${+(seconds / 86400).toFixed(1)}d` : seconds >= 3600 ? `${+(seconds / 3600).toFixed(1)}h` : seconds >= 60 ? `${+(seconds / 60).toFixed(1)}m` : `${Math.round(seconds)}s`;
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  return { delta, percent, bars, elapsed, label: `${signed(delta)} (${signed(percent)}%) · ${bars} bars · ${elapsed}` };
}

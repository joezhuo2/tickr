import type { Candle, Drawing, DrawingPoint } from "./types";

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

export const PEN_MAX_POINTS = 500;

export function simplifyPath<T>(points: T[], pos: (p: T) => Pixel, tolerance = 1.5, max = PEN_MAX_POINTS): T[] {
  if (points.length < 3) return points.slice();
  let min = tolerance;
  for (;;) {
    const kept = [points[0]];
    let last = pos(points[0]);
    for (let i = 1; i < points.length - 1; i++) {
      const p = pos(points[i]);
      if (Math.hypot(p.x - last.x, p.y - last.y) >= min) { kept.push(points[i]); last = p; }
    }
    kept.push(points[points.length - 1]);
    if (kept.length <= max || min > 1e6) return kept;
    min *= 1.5;
  }
}

export function polylineDistance(p: Pixel, path: Pixel[]): number {
  if (!path.length) return Infinity;
  if (path.length === 1) return segmentDistance(p, path[0], path[0]);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, segmentDistance(p, path[i - 1], path[i]));
  return best;
}

export function hitPolyline(p: Pixel, path: Pixel[]): boolean {
  return polylineDistance(p, path) <= 6;
}

export function pathBounds(path: Pixel[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of path) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
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

/** Kinds drawn from two anchor points. */
export const TWO_POINT: ReadonlySet<Drawing["kind"]> = new Set(["trend", "rect", "ray", "fib", "position"] as const);

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Retracement levels of the move from `from` to `to`: 0 sits at `to`, 1 back at `from`. */
export function fibLevels(from: number, to: number): { ratio: number; price: number }[] {
  return FIB_RATIOS.map((ratio) => ({ ratio, price: to - (to - from) * ratio }));
}

export function clampReward(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.min(20, Math.max(0.1, Math.round(v * 10) / 10)) : 2;
}

/** A long (stop below entry) or short trade with its target `reward` times the risk away. */
export function positionLevels(entry: number, stop: number, reward = 2) {
  const risk = Math.abs(entry - stop);
  return { long: stop < entry, risk, riskPct: (risk / entry) * 100, target: entry + (entry - stop) * reward, reward };
}

/** VWAP of typical price from the first candle at or after `from`; null before it or until volume trades. */
export function anchoredVwap(candles: readonly Candle[], from: number): (number | null)[] {
  let pv = 0;
  let vol = 0;
  return candles.map((c) => {
    if (c.t < from) return null;
    pv += ((c.h + c.l + c.c) / 3) * c.v;
    vol += c.v;
    return vol > 0 ? pv / vol : null;
  });
}

/** Where the ray from `a` through `b` leaves the span left..right; `b` itself when vertical. */
export function rayEnd(a: Pixel, b: Pixel, left: number, right: number): Pixel {
  const dx = b.x - a.x;
  if (!dx) return b;
  const k = ((dx > 0 ? right : left) - a.x) / dx;
  return k > 1 ? { x: a.x + dx * k, y: a.y + (b.y - a.y) * k } : b;
}

/** True within 6px of the outline of the box spanned by `a` and `b`. */
export function hitBox(p: Pixel, a: Pixel, b: Pixel): boolean {
  const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
  return hitPolyline(p, corners);
}

export const DRAWING_COLORS = ["", "#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7"];

export function snapPrice(price: number, candle: Pick<Candle, "o" | "h" | "l" | "c"> | undefined, tolerance: number): number {
  if (!candle) return price;
  let best = price;
  let gap = tolerance;
  for (const v of [candle.o, candle.h, candle.l, candle.c]) {
    if (Math.abs(v - price) <= gap) { best = v; gap = Math.abs(v - price); }
  }
  return best;
}

export const POINT_COUNT: Partial<Record<Drawing["kind"], number>> = {
  hline: 1, text: 1, avwap: 1, vline: 1, hray: 1, note: 1,
  trend: 2, rect: 2, ray: 2, fib: 2, position: 2, arrow: 2, prange: 2, drange: 2, vprofile: 2,
  channel: 3, fibext: 3, pitchfork: 3,
};

export const FIB_EXT_RATIOS = [0, 0.618, 1, 1.618, 2.618];

export function fibExtLevels(a: number, b: number, c: number): { ratio: number; price: number }[] {
  return FIB_EXT_RATIOS.map((ratio) => ({ ratio, price: c + (b - a) * ratio }));
}

export function channelLines(a: Pixel, b: Pixel, c: Pixel): [Pixel, Pixel][] {
  const dx = b.x - a.x;
  const o = dx ? { x: 0, y: c.y - (a.y + ((b.y - a.y) * (c.x - a.x)) / dx) } : { x: c.x - a.x, y: 0 };
  return [[a, b], [{ x: a.x + o.x, y: a.y + o.y }, { x: b.x + o.x, y: b.y + o.y }]];
}

export function pitchforkLines(a: Pixel, b: Pixel, c: Pixel, left: number, right: number): [Pixel, Pixel][] {
  const mid = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  const d = { x: mid.x - a.x, y: mid.y - a.y };
  const tine = (p: Pixel): [Pixel, Pixel] => [p, rayEnd(p, { x: p.x + d.x, y: p.y + d.y }, left, right)];
  return [[a, rayEnd(a, mid, left, right)], tine(b), tine(c), [b, c]];
}

export function arrowHead(a: Pixel, b: Pixel, size = 9): [Pixel, Pixel] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const wing = (turn: number) => ({ x: b.x - size * Math.cos(angle + turn), y: b.y - size * Math.sin(angle + turn) });
  return [wing(0.45), wing(-0.45)];
}

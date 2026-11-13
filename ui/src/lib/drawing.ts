import { num } from "./format";
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
  hline: 1, text: 1, avwap: 1, vline: 1, hray: 1, note: 1, arrowup: 1, arrowdown: 1,
  trend: 2, rect: 2, ray: 2, fib: 2, position: 2, arrow: 2, prange: 2, drange: 2, vprofile: 2, callout: 2,
  channel: 3, fibext: 3, pitchfork: 3,
  corrective: 4, xabcd: 5, headshoulders: 5, impulse: 6,
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

export const SHAPE_LABELS: Partial<Record<Drawing["kind"], string[]>> = {
  impulse: ["0", "1", "2", "3", "4", "5"],
  corrective: ["0", "A", "B", "C"],
  xabcd: ["X", "A", "B", "C", "D"],
  headshoulders: ["LS", "", "H", "", "RS"],
};

export function pointLabel(path: Pixel[], i: number, gap = 6): { x: number; y: number; above: boolean } {
  const p = path[i];
  const near = [path[i - 1], path[i + 1]].filter((q): q is Pixel => !!q);
  const above = near.reduce((s, q) => s + q.y, 0) >= p.y * near.length;
  return { x: p.x, y: above ? p.y - gap : p.y + gap, above };
}

export function harmonicRatios([x, a, b, c, d]: number[]): { from: number; to: number; label: string; ratio: number }[] {
  const r = (n: number, m: number) => (m ? Math.abs(n / m) : 0);
  return [
    { from: 0, to: 2, label: "AB/XA", ratio: r(b - a, a - x) },
    { from: 1, to: 3, label: "BC/AB", ratio: r(c - b, b - a) },
    { from: 2, to: 4, label: "CD/BC", ratio: r(d - c, c - b) },
    { from: 0, to: 4, label: "AD/XA", ratio: r(d - a, a - x) },
  ];
}

export function necklineEnds(pts: Pixel[]): [Pixel, Pixel] {
  const [n1, n2] = [pts[1], pts[3]];
  const dx = n2.x - n1.x;
  if (!dx) return [n1, n2];
  const xs = pts.map((p) => p.x);
  const at = (x: number) => ({ x, y: n1.y + ((n2.y - n1.y) * (x - n1.x)) / dx });
  return [at(Math.min(...xs)), at(Math.max(...xs))];
}

export function shapeSegments(kind: Drawing["kind"], pts: Pixel[]): [Pixel, Pixel][] {
  const legs = pts.slice(1).map((p, i): [Pixel, Pixel] => [pts[i], p]);
  if (kind === "xabcd") return [...legs, ...[[0, 2], [1, 3], [2, 4], [0, 4]].map(([i, j]): [Pixel, Pixel] => [pts[i], pts[j]])];
  if (kind === "headshoulders") return [...legs, necklineEnds(pts)];
  return legs;
}

export function inBounds(p: Pixel, b: { minX: number; maxX: number; minY: number; maxY: number }, pad = 0): boolean {
  return p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad;
}

export function markerPath(p: Pixel, up: boolean, size = 12): Pixel[] {
  const s = up ? 1 : -1;
  const head = p.y + s * (2 + size / 2), tail = p.y + s * (2 + size * 1.4), w = size / 2, stem = size / 5;
  return [{ x: p.x, y: p.y + s * 2 }, { x: p.x + w, y: head }, { x: p.x + stem, y: head }, { x: p.x + stem, y: tail }, { x: p.x - stem, y: tail }, { x: p.x - stem, y: head }, { x: p.x - w, y: head }];
}

export function calloutGeometry(a: Pixel, b: Pixel, textWidth: number) {
  const box = { minX: b.x, maxX: b.x + textWidth + 12, minY: b.y - 10, maxY: b.y + 10 };
  const tail = { x: Math.max(box.minX, Math.min(box.maxX, a.x)), y: Math.max(box.minY, Math.min(box.maxY, a.y)) };
  return { box, tail };
}

export function hitCallout(p: Pixel, a: Pixel, b: Pixel, textWidth: number): boolean {
  const { box, tail } = calloutGeometry(a, b, textWidth);
  return inBounds(p, box, 3) || hitTest(p, a, tail);
}

export const DRAWING_NAMES: Record<Drawing["kind"], string> = {
  hline: "Level", trend: "Trend line", text: "Text", pen: "Pen", rect: "Box", ray: "Ray", fib: "Fib retracement",
  position: "Long / short position", avwap: "Anchored VWAP", vline: "Vertical line", hray: "Horizontal ray", arrow: "Arrow",
  prange: "Price range", drange: "Date range", channel: "Channel", fibext: "Fib extension", pitchfork: "Pitchfork",
  vprofile: "Volume profile", note: "Note", arrowup: "Arrow up", arrowdown: "Arrow down", callout: "Callout",
  impulse: "Elliott impulse (1-5)", corrective: "Elliott correction (A-B-C)", xabcd: "XABCD pattern", headshoulders: "Head and shoulders",
};

export function drawingSummary(d: Drawing): string {
  if (d.text) {
    const line = d.text.split("\n")[0].trim();
    return line.length > 40 ? `${line.slice(0, 39)}…` : line;
  }
  if (d.kind === "pen") return `${d.points.length} points`;
  const first = num(d.points[0].price);
  return d.points.length > 1 ? `${first} → ${num(d.points[d.points.length - 1].price)}` : first;
}

export interface DrawingStyle { color: string; width: number; dashed: boolean }
export interface StyleTemplate extends DrawingStyle { name: string }
export interface DrawingStyles { defaults: Partial<Record<Drawing["kind"], DrawingStyle>>; templates: StyleTemplate[] }
export const MAX_TEMPLATES = 20;

export function cleanStyle(v: unknown): DrawingStyle {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    color: typeof o.color === "string" && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : "",
    width: typeof o.width === "number" && Number.isInteger(o.width) && o.width >= 1 && o.width <= 4 ? o.width : 1,
    dashed: o.dashed === true,
  };
}

export function cleanDrawingStyles(v: unknown): DrawingStyles {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const raw = o.defaults && typeof o.defaults === "object" ? o.defaults : {};
  const defaults = Object.fromEntries(Object.entries(raw).filter(([k]) => Object.hasOwn(DRAWING_NAMES, k)).map(([k, s]) => [k, cleanStyle(s)]));
  let templates: StyleTemplate[] = [];
  for (const t of Array.isArray(o.templates) ? o.templates : []) templates = saveTemplate(templates, typeof t?.name === "string" ? t.name : "", cleanStyle(t), false);
  return { defaults, templates };
}

export function saveTemplate(list: StyleTemplate[], name: string, style: DrawingStyle, replace = true): StyleTemplate[] {
  const n = name.trim().slice(0, 40);
  const i = list.findIndex((t) => t.name === n);
  if (!n || (i >= 0 && !replace) || (i < 0 && list.length >= MAX_TEMPLATES)) return list;
  const next = { name: n, color: style.color, width: style.width, dashed: style.dashed };
  return i >= 0 ? list.map((t, k) => (k === i ? next : t)) : [...list, next];
}

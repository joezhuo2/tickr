import { barSpan } from "./chartsync";
import type { Candle, Chart } from "./types";

export const SPEEDS = [1, 2, 5, 10] as const;
export type Speed = (typeof SPEEDS)[number];

export const BASE_MS = 1000;
export const MIN_CONTEXT = 20;

export interface ReplayState {
  total: number;
  start: number;
  cursor: number;
  playing: boolean;
  speed: Speed;
  elapsed: number;
  forming?: number;
}

interface Timed {
  t: number;
}

export function msPerBar(speed: Speed): number {
  return BASE_MS / speed;
}

export function isSpeed(value: unknown): value is Speed {
  return SPEEDS.includes(value as Speed);
}

export function canReplay(total: number, context = MIN_CONTEXT): boolean {
  return total > context;
}

export function startIndex(bars: readonly Timed[], time: number, context = MIN_CONTEXT): number | null {
  if (!canReplay(bars.length, context) || Number.isNaN(time)) return null;
  const i = bars.findIndex((b) => b.t >= time);
  return Math.max(context, i < 0 ? bars.length - 1 : i);
}

export function startAt(bars: readonly Timed[], time: number, context = MIN_CONTEXT, speed: Speed = 1): ReplayState | null {
  const i = startIndex(bars, time, context);
  if (i == null) return null;
  return { total: bars.length, start: i, cursor: i, playing: false, speed: isSpeed(speed) ? speed : 1, elapsed: 0 };
}

function before(bars: readonly Timed[], at: number): number {
  const i = bars.findIndex((b) => b.t >= at);
  return i < 0 ? bars.length : i;
}

function formingAt(bars: readonly Timed[], k: number, at: number, span: number): boolean {
  return Number.isFinite(at) && (k + 1 >= bars.length || bars[k + 1].t > at) && bars[k].t + span > at;
}

export function seekTime(bars: readonly Timed[], at: number, speed: Speed = 1, playing = false): ReplayState | null {
  if (Number.isNaN(at)) return null;
  const n = before(bars, at);
  if (n < 2) return null;
  const s: ReplayState = { total: bars.length, start: n - 1, cursor: n - 1, playing, speed: isSpeed(speed) ? speed : 1, elapsed: 0 };
  if (formingAt(bars, n - 1, at, barSpan(bars.map((b) => b.t)))) return { ...s, forming: at };
  return isAtEnd(s) ? { ...s, playing: false } : s;
}

export function revealedAt(bars: readonly Candle[], at: number, finer: readonly Candle[] = []): Candle[] {
  if (Number.isNaN(at)) return [];
  const n = before(bars, at);
  const shown = bars.slice(0, n);
  if (!n) return shown;
  const span = barSpan(bars.map((b) => b.t));
  if (!formingAt(bars, n - 1, at, span)) return shown;
  const bar = shown.pop()!;
  if (!finer.length || finer[0].t > bar.t || barSpan(finer.map((f) => f.t)) >= span) return shown;
  const parts = finer.filter((f) => f.t >= bar.t && f.t < at);
  if (parts.length) shown.push(parts.slice(1).reduce((b, f) => ({ ...b, h: Math.max(b.h, f.h), l: Math.min(b.l, f.l), c: f.c, v: b.v + f.v }), { ...parts[0], t: bar.t }));
  return shown;
}

export function chartAt(base: Chart, at: number, finer: readonly Candle[] = []): Chart | null {
  const candles = revealedAt(base.candles, at, finer);
  const last = candles[candles.length - 1];
  if (!last) return null;
  return {
    ...base,
    meta: { ...base.meta, price: last.c, market_time: last.t },
    candles,
    dividends: known(base.dividends, (d) => d.t, at),
    splits: known(base.splits, (s) => s.t, at),
    last_bar_time: last.t,
  };
}

export function settled(s: ReplayState): number {
  return s.forming == null ? s.cursor : s.cursor - 1;
}

export function isAtEnd(s: ReplayState): boolean {
  return s.forming == null && s.cursor >= s.total - 1;
}

export function step(s: ReplayState): ReplayState {
  const cursor = s.forming == null ? Math.min(s.total - 1, s.cursor + 1) : s.cursor;
  return { ...s, cursor, forming: undefined, playing: s.playing && cursor < s.total - 1, elapsed: 0 };
}

export function stepBack(s: ReplayState): ReplayState {
  const cursor = Math.max(s.start, s.cursor - 1);
  return { ...s, cursor, forming: cursor === s.cursor ? s.forming : undefined, playing: false, elapsed: 0 };
}

export function play(s: ReplayState): ReplayState {
  if (isAtEnd(s)) return { ...s, playing: false, elapsed: 0 };
  return s.playing ? s : { ...s, playing: true, elapsed: 0 };
}

export function pause(s: ReplayState): ReplayState {
  return s.playing ? { ...s, playing: false, elapsed: 0 } : s;
}

export function toggle(s: ReplayState): ReplayState {
  return s.playing ? pause(s) : play(s);
}

export function setSpeed(s: ReplayState, speed: Speed): ReplayState {
  return isSpeed(speed) && speed !== s.speed ? { ...s, speed, elapsed: 0 } : s;
}

export function tick(s: ReplayState, dtMs: number): ReplayState {
  if (!s.playing || !(dtMs > 0) || !Number.isFinite(dtMs)) return s;
  const ms = msPerBar(s.speed);
  const elapsed = s.elapsed + dtMs;
  const bars = Math.floor(elapsed / ms);
  if (bars === 0) return { ...s, elapsed };
  const cursor = Math.min(s.total - 1, s.cursor + bars - (s.forming == null ? 0 : 1));
  const end = cursor >= s.total - 1;
  return { ...s, cursor, forming: undefined, playing: !end, elapsed: end ? 0 : elapsed - bars * ms };
}

export function revealed<T>(bars: readonly T[], s: ReplayState): T[] {
  return bars.slice(0, Math.max(0, Math.min(s.cursor, bars.length - 1) + 1));
}

export function cutoff(bars: readonly Timed[], s: ReplayState): number {
  if (s.forming != null) return s.forming;
  return s.cursor + 1 < bars.length ? bars[Math.max(0, s.cursor + 1)].t : Infinity;
}

export function known<T>(items: readonly T[], time: (item: T) => number, before: number): T[] {
  return items.filter((item) => time(item) < before);
}

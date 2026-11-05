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

export function isAtEnd(s: ReplayState): boolean {
  return s.cursor >= s.total - 1;
}

export function step(s: ReplayState): ReplayState {
  const cursor = Math.min(s.total - 1, s.cursor + 1);
  return { ...s, cursor, playing: s.playing && cursor < s.total - 1, elapsed: 0 };
}

export function stepBack(s: ReplayState): ReplayState {
  return { ...s, cursor: Math.max(s.start, s.cursor - 1), playing: false, elapsed: 0 };
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
  const cursor = Math.min(s.total - 1, s.cursor + bars);
  const end = cursor >= s.total - 1;
  return { ...s, cursor, playing: !end, elapsed: end ? 0 : elapsed - bars * ms };
}

export function revealed<T>(bars: readonly T[], s: ReplayState): T[] {
  return bars.slice(0, Math.max(0, Math.min(s.cursor, bars.length - 1) + 1));
}

export function cutoff(bars: readonly Timed[], s: ReplayState): number {
  return s.cursor + 1 < bars.length ? bars[Math.max(0, s.cursor + 1)].t : Infinity;
}

export function known<T>(items: readonly T[], time: (item: T) => number, before: number): T[] {
  return items.filter((item) => time(item) < before);
}

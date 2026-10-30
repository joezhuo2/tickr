export interface View {
  start: number;
  count: number;
}

export const MIN_BARS = 10;

export function full(n: number): View {
  return { start: 0, count: n };
}

export function isFull(v: View, n: number): boolean {
  return v.start <= 0 && v.count >= n;
}

function fitCount(count: number, n: number): number {
  return Math.min(n, Math.max(Math.min(MIN_BARS, n), count));
}

export function clamp(v: View, n: number): View {
  const count = fitCount(v.count, n);
  return { start: Math.min(n - count, Math.max(0, v.start)), count };
}

export function zoom(v: View, n: number, factor: number, anchor: number): View {
  const count = fitCount(v.count * factor, n);
  const a = Math.min(1, Math.max(0, anchor));
  return clamp({ start: v.start + (v.count - count) * a, count }, n);
}

export function pan(v: View, n: number, bars: number): View {
  return clamp({ start: v.start + bars, count: v.count }, n);
}

export function reveal(v: View, n: number, i: number): View {
  if (i < v.start) return clamp({ start: i, count: v.count }, n);
  if (i + 1 > v.start + v.count) return clamp({ start: i + 1 - v.count, count: v.count }, n);
  return v;
}

export function follow(v: View, prevN: number, n: number): View {
  if (isFull(v, prevN)) return full(n);
  const atEnd = v.start + v.count >= prevN - 1e-9;
  return clamp(atEnd ? { start: v.start + n - prevN, count: v.count } : v, n);
}

export function visible(v: View, n: number): [number, number] {
  return [Math.max(0, Math.floor(v.start)), Math.min(n - 1, Math.ceil(v.start + v.count) - 1)];
}

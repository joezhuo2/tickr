export const FUSE_MS = 4000;

export interface Fuse {
  left: number;
  since: number | null;
}

export function lightFuse(ms: number, now: number): Fuse {
  return { left: Math.max(0, ms), since: now };
}

export function remaining(f: Fuse, now: number): number {
  return f.since == null ? f.left : Math.max(0, f.left - Math.max(0, now - f.since));
}

export function pauseFuse(f: Fuse, now: number): Fuse {
  return f.since == null ? f : { left: remaining(f, now), since: null };
}

export function resumeFuse(f: Fuse, now: number): Fuse {
  return f.since == null ? { left: f.left, since: now } : f;
}

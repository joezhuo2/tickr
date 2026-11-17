export interface Prefs {
  max_candles: number;
  live_candles: boolean;
  refresh_secs: number;
  sweep_runs: number;
  compare_max: number;
  pattern_min_bars: number;
}

export const DEFAULT_PREFS: Prefs = { max_candles: 20_000, live_candles: true, refresh_secs: 60, sweep_runs: 400, compare_max: 4, pattern_min_bars: 20 };

export const PREF_OPTIONS = {
  max_candles: [10_000, 20_000, 50_000, 100_000, 200_000],
  refresh_secs: [15, 30, 60, 120, 300],
  sweep_runs: [100, 400, 1000, 2500],
  compare_max: [2, 4, 6, 8],
  pattern_min_bars: [10, 20, 30, 50],
} as const;

export const STREAM_MS_OPTIONS = [100, 250, 500, 1000, 2000];

export function cleanPrefs(v: unknown): Prefs {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PREFS };
  for (const key of Object.keys(PREF_OPTIONS) as (keyof typeof PREF_OPTIONS)[]) {
    if ((PREF_OPTIONS[key] as readonly unknown[]).includes(o[key])) out[key] = o[key] as number;
  }
  if (typeof o.live_candles === "boolean") out.live_candles = o.live_candles;
  return out;
}

import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, cleanPrefs } from "./prefs";
import { applyLocal, collectLocal, parseLocal } from "./backupLocal";

describe("prefs", () => {
  it("keeps listed values and falls back to defaults for anything else", () => {
    expect(cleanPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(cleanPrefs("x")).toEqual(DEFAULT_PREFS);
    const custom = { max_candles: 100_000, live_candles: false, refresh_secs: 15, sweep_runs: 2500, compare_max: 8, pattern_min_bars: 50 };
    expect(cleanPrefs(custom)).toEqual(custom);
    expect(cleanPrefs({ max_candles: 123, live_candles: "no", refresh_secs: "15", sweep_runs: 1e9, compare_max: -1, pattern_min_bars: NaN, extra: 1 })).toEqual(DEFAULT_PREFS);
  });

  it("round-trips through a backup", () => {
    const data = new Map<string, string>([["tickr.prefs", JSON.stringify({ ...DEFAULT_PREFS, compare_max: 6, junk: true })]]);
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const local = collectLocal(store);
    expect(local.prefs).toEqual({ ...DEFAULT_PREFS, compare_max: 6 });
    const parsed = parseLocal(JSON.stringify({ local }));
    data.clear();
    applyLocal(store, parsed);
    expect(JSON.parse(data.get("tickr.prefs") ?? "null")).toEqual({ ...DEFAULT_PREFS, compare_max: 6 });
  });
});

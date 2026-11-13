export const PIVOT_TYPES = ["classic", "fibonacci", "camarilla", "woodie"] as const;
export type PivotType = (typeof PIVOT_TYPES)[number];

interface Field { label: string; def: number; min: number; max: number; step: number }

const len = (def: number, label = "Length"): Field => ({ label, def, min: 1, max: 500, step: 1 });

export const SETTING_FIELDS = {
  stoch: { k: len(14, "%K"), smooth: len(3, "Smoothing"), d: len(3, "%D") },
  ichimoku: { conversion: len(9, "Conversion"), base: len(26, "Base"), spanB: len(52, "Span B"), displacement: len(26, "Displacement") },
  supertrend: { length: len(10, "ATR period"), multiplier: { label: "Multiplier", def: 3, min: 0.5, max: 10, step: 0.1 } },
  keltner: { ema: len(20, "EMA length"), atr: len(10, "ATR length"), multiplier: { label: "Multiplier", def: 2, min: 0.5, max: 10, step: 0.1 } },
  donchian: { length: len(20) },
  cci: { length: len(20) },
  willr: { length: len(14) },
  mfi: { length: len(14) },
  wma: { length: len(20) },
  hma: { length: len(20) },
  vwma: { length: len(20) },
  zigzag: { percent: { label: "Reversal %", def: 5, min: 0.1, max: 50, step: 0.1 } },
  linreg: { length: { label: "Length", def: 100, min: 2, max: 500, step: 1 }, deviations: { label: "Deviations", def: 2, min: 0.5, max: 5, step: 0.1 } },
  stochrsi: { rsi: len(14, "RSI length"), stoch: len(14, "Stoch length"), k: len(3, "%K"), d: len(3, "%D") },
  aroon: { length: len(25) },
  cmf: { length: len(20) },
  roc: { length: len(9) },
  rsi_study: { length: len(14) },
  macd_study: { fast: len(12, "Fast"), slow: len(26, "Slow"), signal: len(9, "Signal") },
  psar: { step: { label: "Step", def: 0.02, min: 0.001, max: 1, step: 0.001 }, max: { label: "Max", def: 0.2, min: 0.01, max: 1, step: 0.01 } },
} as const;

export type SettingGroup = keyof typeof SETTING_FIELDS;

export const STUDY_TIMEFRAMES = ["5m", "15m", "30m", "60m", "4h", "1d", "1wk", "1mo"] as const;
export const NO_TIMEFRAME: readonly SettingGroup[] = ["ichimoku", "zigzag", "linreg"];
export const MAX_EXTRAS = 24;

export interface StudyInstance { key: string; study: SettingGroup; params: Record<string, number>; tf: string }

export type StudySettings = {
  [G in SettingGroup]: { [F in keyof (typeof SETTING_FIELDS)[G]]: number };
} & { pivotType: PivotType; timeframes: Partial<Record<SettingGroup, string>>; extras: StudyInstance[]; showPoc: boolean; vpArea: number };

export const SETTING_LABELS: Record<SettingGroup, string> = {
  stoch: "Stochastic",
  ichimoku: "Ichimoku",
  supertrend: "Supertrend",
  keltner: "Keltner",
  donchian: "Donchian",
  cci: "CCI",
  willr: "Williams %R",
  mfi: "MFI",
  wma: "WMA",
  hma: "Hull MA",
  vwma: "VWMA",
  zigzag: "ZigZag",
  linreg: "Linear regression",
  stochrsi: "Stoch RSI",
  aroon: "Aroon",
  cmf: "CMF",
  roc: "ROC",
  rsi_study: "RSI",
  macd_study: "MACD",
  psar: "Parabolic SAR",
};

const isGroup = (g: unknown): g is SettingGroup => typeof g === "string" && Object.hasOwn(SETTING_FIELDS, g);

function cleanGroup(group: SettingGroup, v: unknown): Record<string, number> {
  const src = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Record<string, number> = Object.fromEntries(Object.entries(SETTING_FIELDS[group]).map(([key, f]: [string, Field]) => {
    const n = src[key];
    if (typeof n !== "number" || !Number.isFinite(n)) return [key, f.def];
    const clamped = Math.min(f.max, Math.max(f.min, n));
    return [key, f.step >= 1 ? Math.round(clamped) : Math.round(clamped * 1000) / 1000];
  }));
  if (group === "psar") out.max = Math.max(out.max, out.step);
  return out;
}

function cleanTimeframe(group: SettingGroup, tf: unknown): string {
  return !NO_TIMEFRAME.includes(group) && STUDY_TIMEFRAMES.includes(tf as (typeof STUDY_TIMEFRAMES)[number]) ? (tf as string) : "chart";
}

export function cleanSettings(v: unknown): StudySettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const group of Object.keys(SETTING_FIELDS) as SettingGroup[]) out[group] = cleanGroup(group, o[group]);
  out.pivotType = PIVOT_TYPES.includes(o.pivotType as PivotType) ? o.pivotType : "classic";
  const tfs = (o.timeframes && typeof o.timeframes === "object" ? o.timeframes : {}) as Record<string, unknown>;
  out.timeframes = Object.fromEntries(Object.entries(tfs).filter(([g]) => isGroup(g)).map(([g, tf]) => [g, cleanTimeframe(g as SettingGroup, tf)]).filter(([, tf]) => tf !== "chart"));
  const seen = new Set<string>();
  out.extras = (Array.isArray(o.extras) ? o.extras : []).flatMap((x): StudyInstance[] => {
    if (!x || typeof x !== "object" || !isGroup(x.study) || typeof x.key !== "string") return [];
    if (!new RegExp(`^${x.study}-([2-9]|[1-9]\d+)$`).test(x.key) || seen.has(x.key)) return [];
    seen.add(x.key);
    return [{ key: x.key, study: x.study, params: cleanGroup(x.study, x.params), tf: cleanTimeframe(x.study, x.tf) }];
  }).slice(0, MAX_EXTRAS);
  out.vpArea = typeof o.vpArea === "number" && Number.isFinite(o.vpArea) ? Math.min(95, Math.max(50, Math.round(o.vpArea))) : 70;
  out.showPoc = typeof o.showPoc === "boolean" ? o.showPoc : true;
  return out as StudySettings;
}

export const defaultSettings = (): StudySettings => cleanSettings(null);

export function studyInstances(on: Partial<Record<string, boolean>>, s: StudySettings): StudyInstance[] {
  const first = (Object.keys(SETTING_FIELDS) as SettingGroup[]).filter((g) => on[g]).map((g) => ({ key: g, study: g, params: s[g] as Record<string, number>, tf: s.timeframes[g] ?? "chart" }));
  return [...first, ...s.extras];
}

export function nextKey(study: SettingGroup, s: StudySettings): string {
  let n = 2;
  while (s.extras.some((x) => x.key === `${study}-${n}`)) n++;
  return `${study}-${n}`;
}

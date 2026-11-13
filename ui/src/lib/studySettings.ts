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
  psar: { step: { label: "Step", def: 0.02, min: 0.001, max: 1, step: 0.001 }, max: { label: "Max", def: 0.2, min: 0.01, max: 1, step: 0.01 } },
} as const;

export type SettingGroup = keyof typeof SETTING_FIELDS;

export type StudySettings = {
  [G in SettingGroup]: { [F in keyof (typeof SETTING_FIELDS)[G]]: number };
} & { pivotType: PivotType };

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
  psar: "Parabolic SAR",
};

export function cleanSettings(v: unknown): StudySettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [group, fields] of Object.entries(SETTING_FIELDS)) {
    const src = (o[group] && typeof o[group] === "object" ? o[group] : {}) as Record<string, unknown>;
    out[group] = Object.fromEntries(Object.entries(fields).map(([key, f]) => {
      const n = src[key];
      if (typeof n !== "number" || !Number.isFinite(n)) return [key, f.def];
      const clamped = Math.min(f.max, Math.max(f.min, n));
      return [key, f.step >= 1 ? Math.round(clamped) : Math.round(clamped * 1000) / 1000];
    }));
  }
  const psar = out.psar as { step: number; max: number };
  psar.max = Math.max(psar.max, psar.step);
  out.pivotType = PIVOT_TYPES.includes(o.pivotType as PivotType) ? o.pivotType : "classic";
  return out as StudySettings;
}

export const defaultSettings = (): StudySettings => cleanSettings(null);

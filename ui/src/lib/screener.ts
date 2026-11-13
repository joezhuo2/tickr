import { num, signed } from "./format";
import type { SavedScreen, ScreenFundamentals, ScreenItem, ScreenOp, ScreenRow, ScreenRule } from "./types";

export const SMA_LENGTHS = [20, 50, 200];
export const RSI_LENGTH = 14;
export const MAX_RULES = 10;
export const MAX_NAME = 40;
export const MAX_VALUES = 20;

export const SECTORS = [
  "Basic Materials",
  "Communication Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Energy",
  "Financial Services",
  "Healthcare",
  "Industrials",
  "Real Estate",
  "Technology",
  "Utilities",
];

export type FieldGroup = "Price & volume" | "Performance" | "Technical" | "Fundamentals";
export const FIELD_GROUPS: FieldGroup[] = ["Price & volume", "Performance", "Technical", "Fundamentals"];

export interface FieldDef {
  key: string;
  label: string;
  group: FieldGroup;
  unit: string;
  digits: number;
  start: number;
  signed?: boolean;
  text?: boolean;
  fund?: boolean;
  get: (r: ScreenItem) => number | string | null | undefined;
}

function vsSma(length: number): (r: ScreenItem) => number | null {
  return (r) => {
    const sma = smaOf(r, length);
    return r.price != null && sma != null && sma > 0 ? (r.price / sma - 1) * 100 : null;
  };
}

const pct = (key: string, label: string, group: FieldGroup, get: FieldDef["get"], start = 0): FieldDef => ({
  key,
  label,
  group,
  unit: "%",
  digits: 2,
  start,
  signed: true,
  get,
});

export const FIELDS: FieldDef[] = [
  { key: "price", label: "Price", group: "Price & volume", unit: "", digits: 2, start: 100, get: (r) => r.price },
  pct("change", "Change %", "Price & volume", (r) => r.change_pct),
  pct("gap_pct", "Gap %", "Price & volume", (r) => r.gap_pct),
  { key: "volume", label: "Volume (M)", group: "Price & volume", unit: "M", digits: 2, start: 1, get: (r) => (r.volume == null ? null : r.volume / 1e6) },
  { key: "rel_volume", label: "Relative volume", group: "Price & volume", unit: "x", digits: 2, start: 1.5, get: (r) => r.rel_volume },
  pct("perf_1w", "Perf 1W %", "Performance", (r) => r.perf_1w),
  pct("perf_1m", "Perf 1M %", "Performance", (r) => r.perf_1m),
  pct("perf_3m", "Perf 3M %", "Performance", (r) => r.perf_3m),
  pct("perf_6m", "Perf 6M %", "Performance", (r) => r.perf_6m),
  pct("perf_ytd", "Perf YTD %", "Performance", (r) => r.perf_ytd),
  pct("perf_1y", "Perf 1Y %", "Performance", (r) => r.perf_1y),
  pct("from_high_52w", "From 52W high %", "Performance", (r) => r.from_high_52w, -10),
  pct("from_low_52w", "From 52W low %", "Performance", (r) => r.from_low_52w, 10),
  { key: "atr_pct", label: "ATR 14 %", group: "Performance", unit: "%", digits: 2, start: 3, get: (r) => r.atr_pct },
  { key: "rsi", label: `RSI ${RSI_LENGTH}`, group: "Technical", unit: "", digits: 0, start: 30, get: (r) => r.rsi },
  ...SMA_LENGTHS.map((n) => pct(`vs_sma${n}`, `Price vs SMA ${n} %`, "Technical", vsSma(n))),
  { key: "macd_hist", label: "MACD histogram", group: "Technical", unit: "", digits: 2, start: 0, signed: true, get: (r) => r.macd_hist },
  { key: "market_cap", label: "Market cap (B)", group: "Fundamentals", unit: "B", digits: 1, start: 10, fund: true, get: (r) => (r.market_cap == null ? null : r.market_cap / 1e9) },
  { key: "pe", label: "P/E", group: "Fundamentals", unit: "", digits: 1, start: 20, fund: true, get: (r) => r.pe },
  { key: "eps", label: "EPS", group: "Fundamentals", unit: "", digits: 2, start: 0, fund: true, get: (r) => r.eps },
  { key: "dividend_yield", label: "Dividend yield %", group: "Fundamentals", unit: "%", digits: 2, start: 1, fund: true, get: (r) => r.dividend_yield },
  { key: "revenue_growth", label: "Revenue growth %", group: "Fundamentals", unit: "%", digits: 1, start: 10, signed: true, fund: true, get: (r) => r.revenue_growth },
  { key: "profit_margin", label: "Profit margin %", group: "Fundamentals", unit: "%", digits: 1, start: 10, signed: true, fund: true, get: (r) => r.profit_margin },
  { key: "beta", label: "Beta", group: "Fundamentals", unit: "", digits: 2, start: 1, fund: true, get: (r) => r.beta },
  { key: "sector", label: "Sector", group: "Fundamentals", unit: "", digits: 0, start: 0, text: true, fund: true, get: (r) => r.sector },
];

export const DEFAULT_COLUMNS = ["price", "change", "rsi"];

export function fieldOf(key: string): FieldDef | undefined {
  return FIELDS.find((f) => f.key === key);
}

export function opsFor(def: FieldDef): ScreenOp[] {
  return def.text ? ["is", "any"] : ["above", "below", "between"];
}

export function cleanColumns(keys: string[] | undefined): string[] {
  const known = [...new Set(keys ?? [])].filter((k) => fieldOf(k));
  return known.length ? known : DEFAULT_COLUMNS;
}

export function needsFundamentals(columns: string[], rules: ScreenRule[]): boolean {
  return columns.some((k) => fieldOf(k)?.fund) || rules.some((r) => fieldOf(r.kind)?.fund);
}

export function mergeItems(rows: ScreenRow[], funds: Map<string, ScreenFundamentals>): ScreenItem[] {
  return rows.map((r) => ({ ...funds.get(r.symbol), ...r }));
}

export function formatField(def: FieldDef, item: ScreenItem): string {
  const v = def.get(item);
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "—";
  if (typeof v === "string") return v;
  return `${def.signed ? signed(v, def.digits) : num(v, def.digits)}${def.unit}`;
}

export function newRule(kind: string, op?: ScreenOp): ScreenRule {
  const def = fieldOf(kind);
  if (def?.text) return { kind, op: op ?? "is", value: 0, values: [] };
  if (kind === "sma") return { kind, op: op ?? "above", value: 50 };
  return { kind, op: op ?? (kind === "rsi" ? "below" : "above"), value: def?.start ?? 0 };
}

export function migrateRule(rule: ScreenRule): ScreenRule {
  return rule.kind === "sma" && SMA_LENGTHS.includes(rule.value) ? { kind: `vs_sma${rule.value}`, op: rule.op, value: 0 } : rule;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function ruleValid(rule: ScreenRule): boolean {
  if (rule.kind === "sma") return finite(rule.value) && SMA_LENGTHS.includes(rule.value) && (rule.op === "above" || rule.op === "below");
  const def = fieldOf(rule.kind);
  if (!def || !opsFor(def).includes(rule.op)) return false;
  if (def.text) {
    const values = rule.values ?? [];
    return values.length >= 1 && values.length <= MAX_VALUES && (rule.op !== "is" || values.length === 1) && values.every((v) => v.length > 0);
  }
  const needed = rule.op === "between" ? [rule.value, rule.value2] : [rule.value];
  if (!needed.every(finite)) return false;
  return rule.kind !== "rsi" || needed.every((v) => v >= 0 && v <= 100);
}

export function ruleLabel(rule: ScreenRule): string {
  if (rule.kind === "rsi" && rule.op !== "between") return `RSI ${RSI_LENGTH} ${rule.op} ${rule.value}`;
  if (rule.kind === "sma") return `Price ${rule.op} SMA ${rule.value}`;
  if (rule.kind === "change" && rule.op !== "between") return `Change ${rule.op} ${rule.value}%`;
  const def = fieldOf(rule.kind);
  const label = def?.label ?? rule.kind;
  if (rule.op === "between") return `${label} between ${rule.value} and ${rule.value2}`;
  if (rule.op === "is") return `${label} is ${rule.values?.[0] ?? ""}`;
  if (rule.op === "any") return `${label} is any of ${(rule.values ?? []).join(", ")}`;
  return `${label} ${rule.op} ${rule.value}`;
}

export function smaOf(row: ScreenRow, length: number): number | null {
  return length === 20 ? row.sma20 : length === 50 ? row.sma50 : length === 200 ? row.sma200 : null;
}

export function matchesRule(row: ScreenItem, rule: ScreenRule): boolean {
  if (!ruleValid(rule)) return false;
  const r = migrateRule(rule);
  const def = fieldOf(r.kind);
  if (!def) return false;
  const actual = def.get(row);
  if (def.text) {
    if (typeof actual !== "string") return false;
    const key = actual.toLowerCase();
    return (r.values ?? []).some((v) => v.toLowerCase() === key);
  }
  if (!finite(actual)) return false;
  if (r.op === "between") {
    const [lo, hi] = [Math.min(r.value, r.value2 as number), Math.max(r.value, r.value2 as number)];
    return actual >= lo && actual <= hi;
  }
  return r.op === "above" ? actual > r.value : actual < r.value;
}

export function screenRows<T extends ScreenItem>(rows: T[], rules: ScreenRule[]): T[] {
  const active = rules.filter(ruleValid);
  return rows.filter((row) => !row.error && active.every((rule) => matchesRule(row, rule)));
}

export type SortDir = "asc" | "desc";

export function sortItems<T extends ScreenItem>(items: T[], key: string | null, dir: SortDir): T[] {
  if (!key) return items;
  const def = fieldOf(key);
  const read = (r: T) => (key === "symbol" ? r.symbol : def?.get(r));
  const sign = dir === "asc" ? 1 : -1;
  const known = (v: unknown): v is number | string => typeof v === "string" || finite(v);
  return [...items].sort((a, b) => {
    const [x, y] = [read(a), read(b)];
    if (!known(x) || !known(y)) return known(x) === known(y) ? 0 : known(x) ? -1 : 1;
    if (typeof x === "string" || typeof y === "string") return sign * String(x).localeCompare(String(y));
    return sign * (x - y);
  });
}

export function canSave(name: string, rules: ScreenRule[]): boolean {
  const n = name.trim().length;
  return n >= 1 && n <= MAX_NAME && rules.length >= 1 && rules.length <= MAX_RULES && rules.every(ruleValid);
}

export function sameRules(a: ScreenRule[], b: ScreenRule[]): boolean {
  const same = (x: ScreenRule, y: ScreenRule) =>
    x.kind === y.kind &&
    x.op === y.op &&
    x.value === y.value &&
    (x.value2 ?? null) === (y.value2 ?? null) &&
    (x.values ?? []).join("\n") === (y.values ?? []).join("\n");
  return a.length === b.length && a.every((r, i) => same(migrateRule(r), migrateRule(b[i])));
}

export function findScreen(screens: SavedScreen[], name: string): SavedScreen | undefined {
  const key = name.trim().toLowerCase();
  return screens.find((s) => s.name.toLowerCase() === key);
}

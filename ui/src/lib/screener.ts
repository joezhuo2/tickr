import type { SavedScreen, ScreenKind, ScreenOp, ScreenRow, ScreenRule } from "./types";

export const SMA_LENGTHS = [20, 50, 200];
export const RSI_LENGTH = 14;
export const MAX_RULES = 10;
export const MAX_NAME = 40;

export const SCREEN_KINDS: { kind: ScreenKind; label: string }[] = [
  { kind: "rsi", label: `RSI ${RSI_LENGTH}` },
  { kind: "sma", label: "Price vs SMA" },
  { kind: "change", label: "Change %" },
];

export function newRule(kind: ScreenKind, op: ScreenOp = kind === "rsi" ? "below" : "above"): ScreenRule {
  return { kind, op, value: kind === "rsi" ? 30 : kind === "sma" ? 50 : 0 };
}

export function ruleValid(rule: ScreenRule): boolean {
  if (typeof rule.value !== "number" || !Number.isFinite(rule.value)) return false;
  if (rule.kind === "rsi") return rule.value >= 0 && rule.value <= 100;
  if (rule.kind === "sma") return SMA_LENGTHS.includes(rule.value);
  return true;
}

export function ruleLabel(rule: ScreenRule): string {
  if (rule.kind === "rsi") return `RSI ${RSI_LENGTH} ${rule.op} ${rule.value}`;
  if (rule.kind === "sma") return `Price ${rule.op} SMA ${rule.value}`;
  return `Change ${rule.op} ${rule.value}%`;
}

export function smaOf(row: ScreenRow, length: number): number | null {
  return length === 20 ? row.sma20 : length === 50 ? row.sma50 : length === 200 ? row.sma200 : null;
}

function known(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

export function matchesRule(row: ScreenRow, rule: ScreenRule): boolean {
  if (!ruleValid(rule)) return false;
  let actual: number | null;
  let limit = rule.value;
  if (rule.kind === "rsi") actual = row.rsi;
  else if (rule.kind === "change") actual = row.change_pct;
  else {
    actual = row.price;
    limit = smaOf(row, rule.value) ?? NaN;
  }
  if (!known(actual) || !known(limit)) return false;
  return rule.op === "above" ? actual > limit : actual < limit;
}

export function screenRows(rows: ScreenRow[], rules: ScreenRule[]): ScreenRow[] {
  const active = rules.filter(ruleValid);
  return rows.filter((row) => !row.error && active.every((rule) => matchesRule(row, rule)));
}

export function canSave(name: string, rules: ScreenRule[]): boolean {
  const n = name.trim().length;
  return n >= 1 && n <= MAX_NAME && rules.length >= 1 && rules.length <= MAX_RULES && rules.every(ruleValid);
}

export function sameRules(a: ScreenRule[], b: ScreenRule[]): boolean {
  return a.length === b.length && a.every((r, i) => r.kind === b[i].kind && r.op === b[i].op && r.value === b[i].value);
}

export function findScreen(screens: SavedScreen[], name: string): SavedScreen | undefined {
  const key = name.trim().toLowerCase();
  return screens.find((s) => s.name.toLowerCase() === key);
}

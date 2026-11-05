import { num, volume } from "./format";
import type { FinancialPeriod } from "./types";

export type Frequency = "annual" | "quarterly";

export interface Series {
  key: string;
  label: string;
  values: (number | null)[];
}

export interface Row extends Series {
  cells: string[];
}

export interface Bar {
  series: number;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function margin(part: number | null | undefined, revenue: number | null | undefined): number | null {
  if (part == null || revenue == null || !(revenue > 0)) return null;
  const m = (part / revenue) * 100;
  return Number.isFinite(m) ? m : null;
}

export function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return v < 0 ? `−${volume(-v)}` : volume(v);
}

export function percent(v: number | null | undefined): string {
  if (v == null) return "—";
  const r = Math.round(v * 10) / 10;
  return `${r < 0 ? "−" : ""}${num(Math.abs(r), 1)}%`;
}

export function periodLabel(date: string, frequency: Frequency): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!m) return date;
  if (frequency === "annual") return `FY${m[1]}`;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} '${m[1].slice(2)}` : date;
}

const col = (periods: FinancialPeriod[], f: (p: FinancialPeriod) => number | null): (number | null)[] => periods.map(f);

export function volumeSeries(periods: FinancialPeriod[]): Series[] {
  return [
    { key: "revenue", label: "Revenue", values: col(periods, (p) => p.revenue) },
    { key: "net_income", label: "Net income", values: col(periods, (p) => p.net_income) },
    { key: "free_cash_flow", label: "Free cash flow", values: col(periods, (p) => p.free_cash_flow) },
  ];
}

export function marginSeries(periods: FinancialPeriod[]): Series[] {
  return [
    { key: "gross_margin", label: "Gross margin", values: col(periods, (p) => margin(p.gross_profit, p.revenue)) },
    { key: "operating_margin", label: "Operating margin", values: col(periods, (p) => margin(p.operating_income, p.revenue)) },
    { key: "net_margin", label: "Net margin", values: col(periods, (p) => margin(p.net_income, p.revenue)) },
  ].filter((s) => s.values.some((v) => v != null));
}

export function tableRows(periods: FinancialPeriod[]): Row[] {
  const rows = (series: Series[], format: (v: number | null) => string): Row[] =>
    series.map((s) => ({ ...s, cells: s.values.map(format) }));
  return [...rows(volumeSeries(periods), money), ...rows(marginSeries(periods), percent)].filter((r) => r.values.some((v) => v != null));
}

export function hasData(periods: FinancialPeriod[]): boolean {
  return tableRows(periods).length > 0;
}

function domain(series: (number | null)[][]): { lo: number; hi: number } {
  const all = series.flat().filter((v): v is number => v != null && Number.isFinite(v));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  return hi > lo ? { lo, hi } : { lo, hi: lo + 1 };
}

function scaleY(lo: number, hi: number, height: number, pad: number): (v: number) => number {
  return (v) => pad + ((hi - v) / (hi - lo)) * (height - 2 * pad);
}

export function barLayout(series: (number | null)[][], width: number, height: number, gap = 0.3, pad = 3): { bars: Bar[]; baseline: number } {
  const n = Math.max(0, ...series.map((s) => s.length));
  const { lo, hi } = domain(series);
  const y = scaleY(lo, hi, height, pad);
  const baseline = y(0);
  const bars: Bar[] = [];
  if (n === 0) return { bars, baseline };
  const slot = width / n;
  const barWidth = (slot * (1 - gap)) / series.length;
  series.forEach((values, s) => {
    values.forEach((value, index) => {
      if (value == null || !Number.isFinite(value)) return;
      const top = Math.min(y(value), baseline);
      const bottom = Math.max(y(value), baseline);
      const h = Math.max(bottom - top, value === 0 ? 0 : 1);
      bars.push({ series: s, index, x: index * slot + (slot * gap) / 2 + s * barWidth, y: value < 0 ? baseline : baseline - h, width: barWidth, height: h, value });
    });
  });
  return { bars, baseline };
}

export function lineLayout(series: (number | null)[][], width: number, height: number, pad = 4): { paths: string[]; baseline: number } {
  const n = Math.max(0, ...series.map((s) => s.length));
  const { lo, hi } = domain(series);
  const y = scaleY(lo, hi, height, pad);
  const slot = n > 0 ? width / n : 0;
  const paths = series.map((values) => {
    let d = "";
    let run = 0;
    const flush = () => {
      if (run === 1) d += " h0";
      run = 0;
    };
    values.forEach((value, i) => {
      if (value == null || !Number.isFinite(value)) {
        flush();
        return;
      }
      const at = `${((i + 0.5) * slot).toFixed(1)} ${y(value).toFixed(1)}`;
      d += run === 0 ? `${d ? " " : ""}M${at}` : ` L${at}`;
      run++;
    });
    flush();
    return d;
  });
  return { paths, baseline: y(0) };
}

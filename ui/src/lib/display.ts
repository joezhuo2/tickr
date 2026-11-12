import { isHex, luminance, mix } from "./color";
import type { Palette, Theme } from "./types";

export function applyDisplay(root: { dataset: { theme?: string; palette?: string } }, theme: Theme, palette: Palette) {
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  if (palette === "standard") delete root.dataset.palette;
  else root.dataset.palette = palette;
}

export interface Custom {
  main: string;
  sub: string;
  font: string;
  mono: string;
  colors: Record<string, string>;
}

export const NO_CUSTOM: Custom = { main: "", sub: "", font: "", mono: "", colors: {} };

export const TOKENS: { name: string; label: string; group: string }[] = [
  { name: "bg", label: "Background", group: "Interface" },
  { name: "surface", label: "Panels", group: "Interface" },
  { name: "text", label: "Text", group: "Interface" },
  { name: "muted", label: "Muted text", group: "Interface" },
  { name: "faint", label: "Borders", group: "Interface" },
  { name: "accent", label: "Accent", group: "Interface" },
  { name: "tooltip-bg", label: "Tooltip background", group: "Interface" },
  { name: "warn-bg", label: "Warning background", group: "Interface" },
  { name: "warn-text", label: "Warning text", group: "Interface" },
  { name: "up", label: "Gain", group: "Market" },
  { name: "down", label: "Loss", group: "Market" },
  { name: "flat", label: "Unchanged", group: "Market" },
  { name: "grid", label: "Chart grid", group: "Chart" },
  { name: "crosshair", label: "Crosshair", group: "Chart" },
  { name: "ext-shade", label: "Extended-hours shade", group: "Chart" },
  { name: "ma-1", label: "Moving average 1", group: "Chart" },
  { name: "ma-2", label: "Moving average 2", group: "Chart" },
  { name: "ma-3", label: "Moving average 3", group: "Chart" },
  { name: "ma-4", label: "Moving average 4", group: "Chart" },
  { name: "ma-5", label: "Moving average 5", group: "Chart" },
  { name: "bb", label: "Bollinger bands", group: "Chart" },
  { name: "bb-fill", label: "Bollinger fill", group: "Chart" },
  { name: "vwap", label: "VWAP", group: "Chart" },
  { name: "rsi", label: "RSI", group: "Chart" },
  { name: "fib", label: "Fibonacci", group: "Chart" },
  { name: "or", label: "Opening range", group: "Chart" },
  { name: "levels", label: "Key levels", group: "Chart" },
  { name: "vol-ma", label: "Volume average", group: "Chart" },
  { name: "rating", label: "Analyst rating markers", group: "Chart" },
  { name: "news", label: "News markers", group: "Chart" },
  { name: "dividend", label: "Dividend markers", group: "Chart" },
  { name: "split", label: "Split markers", group: "Chart" },
];

export const FONTS: { id: string; label: string; stack: string }[] = [
  { id: "sans", label: "Sans (Segoe UI, Helvetica)", stack: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: "humanist", label: "Humanist (Verdana, Tahoma)", stack: 'Verdana, Tahoma, "Trebuchet MS", sans-serif' },
  { id: "rounded", label: "Rounded", stack: 'ui-rounded, "SF Pro Rounded", "Segoe UI Variable Display", "Arial Rounded MT Bold", sans-serif' },
  { id: "serif", label: "Serif (Georgia, Cambria)", stack: 'Georgia, Cambria, "Times New Roman", serif' },
  { id: "mono", label: "Monospace", stack: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace' },
];

export const MONO_FONTS: { id: string; label: string; stack: string }[] = [
  { id: "consolas", label: "Consolas / Menlo", stack: 'Consolas, Menlo, "DejaVu Sans Mono", monospace' },
  { id: "cascadia", label: "Cascadia / SF Mono", stack: '"Cascadia Code", "Cascadia Mono", "SF Mono", monospace' },
  { id: "courier", label: "Courier", stack: '"Courier New", Courier, monospace' },
  { id: "ui", label: "Same as text", stack: "var(--font)" },
];

export const MAIN_PRESETS = ["#4c8dff", "#0a66d8", "#7c4dff", "#bf5af2", "#ff375f", "#ff9f0a", "#30d158", "#00c7be"];
export const SUB_PRESETS = ["#111113", "#0b1220", "#161a1d", "#1e1b2e", "#ffffff", "#f5f1e8", "#eef3f8", "#f4f4f5"];

const KEY = "tickr.custom";
const VARS = [...TOKENS.map((t) => `--${t.name}`), "--font", "--font-mono"];

export function sanitizeCustom(value: unknown): Custom {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const hex = (x: unknown) => (typeof x === "string" && isHex(x) ? x.toLowerCase() : "");
  const pick = (x: unknown, list: { id: string }[]) => (typeof x === "string" && list.some((f) => f.id === x) ? x : "");
  const given = (v.colors && typeof v.colors === "object" ? v.colors : {}) as Record<string, unknown>;
  const colors = Object.fromEntries(TOKENS.filter((t) => hex(given[t.name])).map((t) => [t.name, hex(given[t.name])]));
  return { main: hex(v.main), sub: hex(v.sub), font: pick(v.font, FONTS), mono: pick(v.mono, MONO_FONTS), colors };
}

export function loadCustom(): Custom {
  try {
    return sanitizeCustom(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return { ...NO_CUSTOM };
  }
}

export function saveCustom(c: Custom) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

export function customVars(c: Custom): { vars: Record<string, string>; scheme: "light" | "dark" | null } {
  const vars: Record<string, string> = {};
  let scheme: "light" | "dark" | null = null;
  if (c.main) vars["--accent"] = c.main;
  if (c.sub) {
    scheme = luminance(c.sub) < 0.3 ? "dark" : "light";
    const ink = scheme === "dark" ? "#f2f2f7" : "#1d1d1f";
    const veil = scheme === "dark" ? "255, 255, 255" : "0, 0, 0";
    vars["--bg"] = c.sub;
    vars["--surface"] = mix(c.sub, ink, 0.07);
    vars["--faint"] = mix(c.sub, ink, 0.2);
    vars["--text"] = ink;
    vars["--muted"] = mix(c.sub, ink, 0.58);
    vars["--grid"] = `rgba(${veil}, 0.07)`;
    vars["--crosshair"] = `rgba(${veil}, 0.4)`;
    vars["--ext-shade"] = `rgba(${veil}, 0.035)`;
    vars["--tooltip-bg"] = mix(c.sub, ink, 0.04);
  }
  for (const [name, hex] of Object.entries(c.colors)) vars[`--${name}`] = hex;
  const font = FONTS.find((f) => f.id === c.font);
  const mono = MONO_FONTS.find((f) => f.id === c.mono);
  if (font) vars["--font"] = font.stack;
  if (mono) vars["--font-mono"] = mono.stack;
  return { vars, scheme };
}

export function applyCustom(root: HTMLElement, c: Custom) {
  const { vars, scheme } = customVars(c);
  for (const name of VARS) {
    if (vars[name]) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
  if (scheme) root.dataset.theme = scheme;
}

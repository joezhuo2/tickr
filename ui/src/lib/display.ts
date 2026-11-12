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
}

export const NO_CUSTOM: Custom = { main: "", sub: "", font: "", mono: "" };

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
const VARS = ["--accent", "--bg", "--surface", "--faint", "--text", "--muted", "--grid", "--crosshair", "--ext-shade", "--tooltip-bg", "--font", "--font-mono"];

export function sanitizeCustom(value: unknown): Custom {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const hex = (x: unknown) => (typeof x === "string" && isHex(x) ? x.toLowerCase() : "");
  const pick = (x: unknown, list: { id: string }[]) => (typeof x === "string" && list.some((f) => f.id === x) ? x : "");
  return { main: hex(v.main), sub: hex(v.sub), font: pick(v.font, FONTS), mono: pick(v.mono, MONO_FONTS) };
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

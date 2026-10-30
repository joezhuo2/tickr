import { cubicOut } from "svelte/easing";
import { fade, fly, scale } from "svelte/transition";

export type Speed = "fast" | "base" | "slow";

export function ms(value: string): number {
  const v = value.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return v.endsWith("ms") ? n : v.endsWith("s") ? n * 1000 : n;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

export function duration(speed: Speed): number {
  return ms(token(`--motion-${speed}`));
}

export function paneIn(node: Element, { y = 6, speed = "base" }: { y?: number; speed?: Speed } = {}) {
  return fly(node, { y, duration: duration(speed), easing: cubicOut });
}

export function backdrop(node: Element) {
  return fade(node, { duration: duration("base") });
}

export function dialog(node: Element) {
  return scale(node, { start: 0.96, duration: duration("base"), easing: cubicOut });
}

export function fadeIn(el: Element | undefined) {
  const d = duration("base");
  if (el && d) el.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: d, easing: token("--ease-out").trim() || "ease-out" });
}

export type SnoozeChoice = "1h" | "4h" | "open";

const ZONE = "America/New_York";
const OPEN_HOUR = 9;
const OPEN_MINUTE = 30;

function wall(sec: number) {
  const out: Record<string, string> = {};
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }).formatToParts(sec * 1000);
  for (const p of parts) out[p.type] = p.value;
  return { y: +out.year, m: +out.month, d: +out.day, h: +out.hour, mi: +out.minute, wd: out.weekday };
}

export function nextOpen(now: number): number {
  for (let i = 0; i < 8; i++) {
    const day = wall(now + i * 86_400);
    if (day.wd === "Sat" || day.wd === "Sun") continue;
    const guess = Date.UTC(day.y, day.m - 1, day.d, OPEN_HOUR, OPEN_MINUTE) / 1000;
    const at = wall(guess);
    const offset = Date.UTC(at.y, at.m - 1, at.d, at.h, at.mi) / 1000 - guess;
    if (guess - offset > now) return guess - offset;
  }
  return now + 86_400;
}

export function snoozeUntil(choice: SnoozeChoice, now: number): number {
  return choice === "1h" ? now + 3600 : choice === "4h" ? now + 4 * 3600 : nextOpen(now);
}

export function localInputToEpoch(value: string): number | null {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

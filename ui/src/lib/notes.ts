import { barAt } from "./chartsync";
import type { Drawing } from "./types";

export const NOTE_MAX = 2000;

export function noteBar(times: number[], t: number): number | null {
  const i = barAt(times, t);
  return i < 0 ? null : i;
}

export function snapNoteTime(times: number[], t: number): number {
  const i = noteBar(times, t);
  return i == null ? t : times[i];
}

export function notesOf(list: readonly Drawing[]): Drawing[] {
  return list.filter((d) => d.kind === "note").sort((a, b) => a.points[0].t - b.points[0].t);
}

export function noteTitle(text: string): string {
  const line = text.split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

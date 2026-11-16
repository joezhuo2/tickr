export function toMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [h, mi] = [Number(m[1]), Number(m[2])];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

export function toHhmm(minutes: number): string {
  const m = Math.min(Math.max(Math.floor(minutes), 0), 1439);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

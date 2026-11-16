import type { Candle } from "./types";

export interface MonthStat { month: number; avg: number; positive: number; years: number }

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function seasonality(monthly: readonly Candle[], gmtoffset = 0, now = Date.now() / 1000): MonthStat[] | null {
  const key = (t: number) => { const d = new Date((t + gmtoffset) * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const returns: number[][] = Array.from({ length: 12 }, () => []);
  monthly.forEach((c, i) => {
    const k = key(c.t);
    if (k === key(now)) return;
    const from = i ? monthly[i - 1].c : c.o;
    if (from > 0) returns[k % 12].push((c.c / from - 1) * 100);
  });
  const stats = returns.map((r, month) => ({
    month,
    avg: r.length ? r.reduce((s, x) => s + x, 0) / r.length : 0,
    positive: r.length ? (r.filter((x) => x > 0).length / r.length) * 100 : 0,
    years: r.length,
  }));
  return stats.some((s) => s.years) ? stats : null;
}

export function drawSeasonality(ctx: CanvasRenderingContext2D, stats: readonly MonthStat[], rect: { left: number; width: number; top: number; h: number }, colors: { up: string; down: string; text: string; grid: string }) {
  const extent = Math.max(1e-9, ...stats.map((s) => Math.abs(s.avg)));
  const mid = rect.top + rect.h / 2;
  const slot = rect.width / 12;
  ctx.strokeStyle = colors.grid;
  ctx.beginPath();
  ctx.moveTo(rect.left, Math.round(mid) + 0.5);
  ctx.lineTo(rect.left + rect.width, Math.round(mid) + 0.5);
  ctx.stroke();
  ctx.textAlign = "center";
  stats.forEach((s, i) => {
    const cx = rect.left + slot * (i + 0.5);
    const dy = (s.avg / extent) * rect.h * 0.28;
    ctx.fillStyle = s.avg >= 0 ? colors.up : colors.down;
    ctx.fillRect(cx - slot * 0.3, Math.min(mid, mid - dy), slot * 0.6, Math.max(1, Math.abs(dy)));
    ctx.fillStyle = colors.text;
    ctx.textBaseline = "bottom";
    ctx.fillText(MONTH_NAMES[i], cx, rect.top + rect.h - 2);
    ctx.textBaseline = "top";
    if (s.years) ctx.fillText(`${s.avg >= 0 ? "+" : ""}${s.avg.toFixed(1)}% · ${Math.round(s.positive)}%`, cx, rect.top + 14);
  });
}

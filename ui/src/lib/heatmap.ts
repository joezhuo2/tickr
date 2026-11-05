export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HeatItem {
  id: string;
  weight: number;
}

export type HeatTile = HeatItem & Rect;
export type TileDetail = "full" | "ticker" | "none";

export const HEAT_CLAMP = 5;
export const HEAT_MAX_MIX = 60;
const MIN_SHARE = 0.15;

export function heatColor(pct: number | null | undefined, clamp = HEAT_CLAMP): string {
  if (pct == null || !Number.isFinite(pct) || !(clamp > 0)) return "var(--surface)";
  const strength = Math.min(Math.abs(pct), clamp) / clamp;
  const mix = Math.round(strength * HEAT_MAX_MIX);
  if (mix === 0) return "var(--surface)";
  return `color-mix(in srgb, var(${pct > 0 ? "--up" : "--down"}) ${mix}%, var(--surface))`;
}

export function heatWeights(pcts: (number | null | undefined)[]): number[] {
  const mags = pcts.map((p) => (p != null && Number.isFinite(p) ? Math.abs(p) : 0));
  const max = Math.max(0, ...mags);
  if (max === 0) return mags.map(() => 1);
  const floor = max * MIN_SHARE;
  return mags.map((m) => Math.max(m, floor));
}

export function tileDetail(w: number, h: number): TileDetail {
  if (w >= 64 && h >= 40) return "full";
  if (w >= 36 && h >= 20) return "ticker";
  return "none";
}

function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const sq = side * side;
  return Math.max((sq * max) / (sum * sum), (sum * sum) / (sq * min));
}

export function layoutHeatmap(items: HeatItem[], width: number, height: number): HeatTile[] {
  if (!(width > 0) || !(height > 0)) return [];
  const rows = items
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => Number.isFinite(item.weight) && item.weight > 0)
    .sort((a, b) => b.item.weight - a.item.weight || a.i - b.i)
    .map(({ item }) => item);
  if (!rows.length) return [];

  const total = rows.reduce((sum, r) => sum + r.weight, 0);
  const scale = (width * height) / total;
  const out: HeatTile[] = [];
  let free: Rect = { x: 0, y: 0, w: width, h: height };
  let row: HeatItem[] = [];

  const flush = () => {
    const sum = row.reduce((s, r) => s + r.weight * scale, 0);
    if (free.w >= free.h) {
      const colW = sum / free.h;
      let y = free.y;
      for (const r of row) {
        const h = (r.weight * scale) / colW;
        out.push({ ...r, x: free.x, y, w: colW, h });
        y += h;
      }
      free = { x: free.x + colW, y: free.y, w: free.w - colW, h: free.h };
    } else {
      const rowH = sum / free.w;
      let x = free.x;
      for (const r of row) {
        const w = (r.weight * scale) / rowH;
        out.push({ ...r, x, y: free.y, w, h: rowH });
        x += w;
      }
      free = { x: free.x, y: free.y + rowH, w: free.w, h: free.h - rowH };
    }
    row = [];
  };

  for (const r of rows) {
    const side = Math.min(free.w, free.h);
    const areas = row.map((x) => x.weight * scale);
    const next = r.weight * scale;
    if (row.length === 0 || worst([...areas, next], side) <= worst(areas, side)) row.push(r);
    else {
      flush();
      row.push(r);
    }
  }
  flush();
  return out;
}

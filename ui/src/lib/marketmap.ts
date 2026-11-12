import { layoutHeatmap, type HeatTile } from "./heatmap";
import type { HeatQuote } from "./types";

export const SECTOR_HEAD = 18;

export interface SectorBlock {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tiles: HeatTile[];
}

function group(rows: HeatQuote[], sector: string | null): Map<string, HeatQuote[]> {
  const groups = new Map<string, HeatQuote[]>();
  for (const r of rows) {
    if (!(r.market_cap > 0) || (sector && r.sector !== sector)) continue;
    const list = groups.get(r.sector);
    if (list) list.push(r);
    else groups.set(r.sector, [r]);
  }
  return groups;
}

export function sectorNames(rows: HeatQuote[]): string[] {
  const cap = (list: HeatQuote[]) => list.reduce((s, r) => s + r.market_cap, 0);
  return [...group(rows, null)].sort((a, b) => cap(b[1]) - cap(a[1])).map(([name]) => name);
}

export function layoutMarket(rows: HeatQuote[], sector: string | null, width: number, height: number): SectorBlock[] {
  const groups = group(rows, sector);
  const weights = [...groups].map(([id, list]) => ({ id, weight: list.reduce((s, r) => s + r.market_cap, 0) }));
  return layoutHeatmap(weights, width, height).map((b) => ({
    name: b.id,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    tiles: layoutHeatmap(
      groups.get(b.id)!.map((r) => ({ id: r.symbol, weight: r.market_cap })),
      b.w,
      Math.max(0, b.h - SECTOR_HEAD),
    ),
  }));
}

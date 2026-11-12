import { describe, expect, it } from "vitest";
import { layoutMarket, SECTOR_HEAD, sectorNames } from "./marketmap";
import type { HeatQuote } from "./types";

const q = (symbol: string, sector: string, market_cap: number): HeatQuote => ({
  symbol,
  name: symbol,
  sector,
  price: 10,
  change_pct: 1,
  market_cap,
});

const rows = [q("A", "Tech", 300), q("B", "Tech", 100), q("C", "Energy", 150), q("D", "Energy", 50), q("E", "Gone", 0)];

describe("marketmap", () => {
  it("orders sectors by total market cap and drops empty ones", () => {
    expect(sectorNames(rows)).toEqual(["Tech", "Energy"]);
  });

  it("sizes sector blocks by cap and fits tiles inside each block below the label", () => {
    const blocks = layoutMarket(rows, null, 800, 600);
    expect(blocks.map((b) => b.name).sort()).toEqual(["Energy", "Tech"]);
    const total = blocks.reduce((s, b) => s + b.w * b.h, 0);
    expect(total).toBeCloseTo(800 * 600, 3);
    const tech = blocks.find((b) => b.name === "Tech")!;
    expect((tech.w * tech.h) / total).toBeCloseTo(2 / 3, 3);
    for (const b of blocks) {
      expect(b.tiles.reduce((s, t) => s + t.w * t.h, 0)).toBeCloseTo(b.w * (b.h - SECTOR_HEAD), 3);
    }
  });

  it("limits to one sector and handles no size", () => {
    const blocks = layoutMarket(rows, "Energy", 400, 300);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tiles.map((t) => t.id)).toEqual(["C", "D"]);
    expect(layoutMarket(rows, null, 0, 0)).toEqual([]);
  });
});

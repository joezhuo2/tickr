import { describe, expect, it } from "vitest";
import { hotlist } from "./hotlists";
import type { Market, Mover } from "./types";

const mv = (symbol: string, o: Partial<Mover> = {}): Mover => ({
  symbol,
  name: symbol,
  price: 100,
  change_pct: 1,
  volume: 1000,
  open: 100,
  prev_close: 100,
  high_52w: 100,
  low_52w: 100,
  ...o,
});

const market = {
  indices: [],
  macros: [],
  sectors: [],
  gainers: [mv("A", { open: 105, high_52w: 101, low_52w: 80 }), mv("B", { open: 101, high_52w: 200, low_52w: 99 })],
  losers: [mv("C", { open: 90, high_52w: 150, low_52w: 100 })],
  actives: [mv("B", { volume: 5, open: 101, high_52w: 200, low_52w: 99 }), mv("D", { volume: 9, open: null })],
} as Market;

const syms = (id: Parameters<typeof hotlist>[1]) => hotlist(market, id).map((r) => r.mover.symbol);

describe("hotlist", () => {
  it("sorts most active by volume", () => expect(syms("active")).toEqual(["D", "B"]));
  it("ranks gaps and drops quotes without an open", () => {
    expect(syms("gap-up")).toEqual(["A", "B", "C"]);
    expect(syms("gap-down")).toEqual(["C", "B", "A"]);
  });
  it("ranks 52-week proximity over the deduped pool", () => {
    expect(syms("high")).toEqual(["D", "A", "C", "B"]);
    expect(syms("low")).toEqual(["D", "C", "B", "A"]);
  });
});

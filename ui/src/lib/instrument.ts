export type Instrument = "future" | "forex" | "other";

export function instrumentOf(symbol: string | null | undefined): Instrument {
  const s = (symbol ?? "").trim().toUpperCase();
  if (/^([A-Z]{3}|[A-Z]{6})=X$/.test(s)) return "forex";
  if (/^[A-Z0-9]{1,6}=F$/.test(s)) return "future";
  return "other";
}

export const isDerivativeMarket = (symbol: string | null | undefined) => instrumentOf(symbol) !== "other";

export const hasVolume = (symbol: string | null | undefined) => instrumentOf(symbol) !== "forex";

export function priceDigits(symbol: string | null | undefined, v: number): number | undefined {
  if (instrumentOf(symbol) !== "forex") return undefined;
  if (/JPY=X$/i.test((symbol ?? "").trim())) return Math.abs(v) >= 100 ? 2 : 3;
  return Math.abs(v) < 10 ? 5 : 4;
}

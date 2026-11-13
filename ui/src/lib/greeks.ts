export const RISK_FREE = 0.04;
export const MIN_YEARS = 1 / 365 / 24;

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

function cdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export function yearsTo(expiry: number | null, now = Date.now() / 1000): number {
  return Math.max(MIN_YEARS, expiry == null ? 0 : (expiry - now) / 86400 / 365);
}

export function greeks(kind: "call" | "put", spot: number | null, strike: number, years: number, iv: number | null, rate = RISK_FREE): Greeks | null {
  if (spot == null || iv == null || !(iv > 0) || !(spot > 0) || !(strike > 0)) return null;
  const t = Math.max(MIN_YEARS, years);
  const root = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (rate + (iv * iv) / 2) * t) / (iv * root);
  const d2 = d1 - iv * root;
  const pdf = 0.3989422804014327 * Math.exp((-d1 * d1) / 2);
  const decay = rate * strike * Math.exp(-rate * t);
  const theta = -(spot * pdf * iv) / (2 * root) + (kind === "call" ? -decay * cdf(d2) : decay * cdf(-d2));
  return {
    delta: kind === "call" ? cdf(d1) : cdf(d1) - 1,
    gamma: pdf / (spot * iv * root),
    theta: theta / 365,
    vega: (spot * pdf * root) / 100,
  };
}

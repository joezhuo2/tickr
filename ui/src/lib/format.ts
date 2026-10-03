const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

export function digitsFor(v: number): number {
  return Math.abs(v) < 1 ? 4 : 2;
}

export function num(v: number, digits = digitsFor(v)): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function price(v: number | null | undefined, currency = "USD"): string {
  if (v == null) return "—";
  const sym = SYMBOLS[currency || "USD"];
  const d = currency === "JPY" ? 0 : digitsFor(v);
  return sym ? `${sym}${num(v, d)}` : `${num(v, d)} ${currency}`;
}

/** "+1.23" / "−1.23" (true minus sign). Values that round to zero are "+0.00". */
export function signed(v: number, digits = 2): string {
  const r = Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v;
  return `${r >= 0 ? "+" : "−"}${num(Math.abs(r), digits)}`;
}

export function change(abs: number | null, pct: number | null): string {
  if (abs == null || pct == null) return "—";
  return `${signed(abs)} (${signed(pct)}%)`;
}

export function direction(v: number | null | undefined): "up" | "down" | "flat" {
  if (v == null || v === 0) return "flat";
  return v > 0 ? "up" : "down";
}

export function volume(v: number | null | undefined): string {
  if (v == null) return "—";
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [n, u] of units) {
    if (Math.abs(v) >= n) return `${(v / n).toFixed(v / n >= 100 ? 0 : 1)}${u}`;
  }
  return String(Math.round(v));
}

const RATINGS: Record<string, string> = {
  strong_buy: "Strong buy",
  buy: "Buy",
  hold: "Hold",
  underperform: "Underperform",
  sell: "Sell",
  strong_sell: "Strong sell",
};

/** "Strong buy" for "strong_buy"; unknown keys are title-cased. */
export function ratingLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return RATINGS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

/** Color class for a rating: buys are up, sells are down, hold is flat. */
export function ratingTone(key: string | null | undefined): "up" | "down" | "flat" {
  if (key === "strong_buy" || key === "buy") return "up";
  if (key === "underperform" || key === "sell" || key === "strong_sell") return "down";
  return "flat";
}

/** Percent move from price to target, or null when either is missing. */
export function upside(target: number | null | undefined, from: number | null | undefined): number | null {
  if (target == null || from == null || from === 0) return null;
  return ((target - from) / from) * 100;
}

export function span(lo: number | null | undefined, hi: number | null | undefined): string {
  if (lo == null || hi == null) return "—";
  return `${num(lo)} – ${num(hi)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Exchange-local time for a unix time; read it with the getUTC* methods. */
function local(t: number, gmtoffset: number): Date {
  return new Date((t + gmtoffset) * 1000);
}

function hm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Short axis label for a candle time. */
export function axisTime(t: number, gmtoffset: number, range: string): string {
  const d = local(t, gmtoffset);
  switch (range) {
    case "1d":
      return hm(d);
    case "5d":
      return `${DAYS[d.getUTCDay()]} ${hm(d)}`;
    case "1mo":
    case "6mo":
    case "ytd":
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    default:
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
}

/** Full label for the hover tooltip; intraday intervals include the time. */
export function fullTime(t: number, gmtoffset: number, interval: string): string {
  const d = local(t, gmtoffset);
  const date = `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return /\dm$/.test(interval) ? `${date} ${hm(d)}` : date;
}

/** How long ago a Unix time was: "now", "5m ago", "3h ago", "2d ago". */
export function ago(t: number, now: number): string {
  const s = Math.max(0, now - t);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Headline date, e.g. "Oct 2, 2026 14:05", in the given UTC offset (seconds). */
export function newsDate(t: number, gmtoffset: number): string {
  const d = local(t, gmtoffset);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${hm(d)}`;
}

/** Evenly spaced "nice" tick values inside [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** The latest price and its move for the session now trading: pre-market or
 *  after hours when there is an extended quote, otherwise the regular day. */
export function sessionMove(q: {
  price: number;
  change_pct: number | null;
  extended: { price: number; change_pct: number } | null;
}): { price: number; pct: number | null } {
  return q.extended ? { price: q.extended.price, pct: q.extended.change_pct } : { price: q.price, pct: q.change_pct };
}

/** Symbols ordered by percent move, biggest gain first; unknown moves last,
 *  in their original order. */
export function byGain(symbols: string[], pct: (s: string) => number | null | undefined): string[] {
  const rank = (s: string) => pct(s) ?? -Infinity;
  return symbols
    .map((s, i) => ({ s, i, r: rank(s) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.s);
}

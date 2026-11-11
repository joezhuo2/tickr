import type { FreshnessState } from "./freshness";
import type { Session } from "./types";

export type Side = "buy" | "sell";
export type OrderKind = "market" | "limit" | "stop";
export type Direction = "long" | "short";

export interface Costs {
  commission: number;
  commission_bps: number;
  slippage_bps: number;
}

export interface Position {
  symbol: string;
  qty: number;
  avg_price: number;
  entry_costs: number;
  opened: number;
}

export interface Order {
  id: number;
  symbol: string;
  side: Side;
  qty: number;
  kind: OrderKind;
  price: number | null;
  created: number;
  /** Orders sharing this number cancel each other when one fills. */
  oco?: number;
  /** Exit orders to place when this order fills. */
  bracket?: Bracket;
}

export interface Bracket {
  stop: number | null;
  target: number | null;
}

export interface Fill {
  id: number;
  order_id: number | null;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  commission: number;
  time: number;
}

export interface ClosedTrade {
  id: number;
  symbol: string;
  direction: Direction;
  qty: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  costs: number;
  opened: number;
  closed: number;
}

export interface Account {
  starting_cash: number;
  cash: number;
  realized: number;
  positions: Position[];
  orders: Order[];
  fills: Fill[];
  trades: ClosedTrade[];
  costs: Costs;
  next_id: number;
}

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface OrderRequest {
  symbol: string;
  side: Side;
  qty: number;
  kind: OrderKind;
  price?: number | null;
  bracket?: Bracket | null;
}

export type Outcome = { ok: true; account: Account; fill?: Fill; order?: Order } | { ok: false; error: string };

export type BarEvent = { kind: "fill"; order: Order; fill: Fill } | { kind: "rejected"; order: Order; error: string };

export const DEFAULT_STARTING_CASH = 100_000;
export const DEFAULT_COSTS: Costs = { commission: 0, commission_bps: 0, slippage_bps: 0 };
export const LIMITS = {
  minCash: 100,
  maxCash: 1_000_000_000,
  maxQty: 10_000_000,
  maxCommission: 1000,
  maxBps: 1000,
  maxOrders: 100,
  maxHistory: 2000,
};

const EPS = 1e-6;

export function newAccount(startingCash = DEFAULT_STARTING_CASH, costs: Costs = DEFAULT_COSTS): Account {
  return { starting_cash: startingCash, cash: startingCash, realized: 0, positions: [], orders: [], fills: [], trades: [], costs: { ...costs }, next_id: 1 };
}

export function cashError(value: number): string | null {
  if (!Number.isFinite(value) || value < LIMITS.minCash || value > LIMITS.maxCash) return `Starting cash must be from ${LIMITS.minCash} to ${LIMITS.maxCash.toLocaleString("en-US")}`;
  return null;
}

export function costsError(c: Costs): string | null {
  if (!Number.isFinite(c.commission) || c.commission < 0 || c.commission > LIMITS.maxCommission) return `Commission per trade must be from 0 to ${LIMITS.maxCommission}`;
  if (!Number.isFinite(c.commission_bps) || c.commission_bps < 0 || c.commission_bps > LIMITS.maxBps) return `Commission bps must be from 0 to ${LIMITS.maxBps}`;
  if (!Number.isFinite(c.slippage_bps) || c.slippage_bps < 0 || c.slippage_bps > LIMITS.maxBps) return `Slippage bps must be from 0 to ${LIMITS.maxBps}`;
  return null;
}

export function qtyError(qty: number): string | null {
  if (!Number.isInteger(qty) || qty < 1) return "Quantity must be a whole number of shares, at least 1";
  if (qty > LIMITS.maxQty) return `Quantity must be at most ${LIMITS.maxQty.toLocaleString("en-US")}`;
  return null;
}

function priceError(price: unknown, label = "Price"): string | null {
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? null : `${label} must be a positive number`;
}

export function reset(a: Account, startingCash = a.starting_cash): Outcome {
  const error = cashError(startingCash);
  return error ? { ok: false, error } : { ok: true, account: newAccount(startingCash, a.costs) };
}

export function setCosts(a: Account, costs: Costs): Outcome {
  const error = costsError(costs);
  return error ? { ok: false, error } : { ok: true, account: { ...a, costs: { ...costs } } };
}

export interface Sizing {
  side: Side;
  shares: number;
  /** Loss per share and in total if the stop is hit. */
  per_share: number;
  risk: number;
  cost: number;
  target: number;
}

/** Whole shares that lose at most `riskPct` of `account` between `entry` and `stop`, with the target `reward` times that distance away. */
export function positionSize(account: number, riskPct: number, entry: number, stop: number, reward = 2): Sizing | null {
  if (![account, riskPct, entry, stop, reward].every(Number.isFinite)) return null;
  if (account <= 0 || riskPct <= 0 || riskPct > 100 || entry <= 0 || stop <= 0 || entry === stop) return null;
  const per_share = Math.abs(entry - stop);
  const shares = Math.floor((account * riskPct) / 100 / per_share);
  return { side: entry > stop ? "buy" : "sell", shares, per_share, risk: shares * per_share, cost: shares * entry, target: entry + (entry - stop) * reward };
}

export function slipped(side: Side, price: number, bps: number): number {
  return side === "buy" ? price * (1 + bps / 10_000) : price * (1 - bps / 10_000);
}

export function commissionFor(costs: Costs, qty: number, price: number): number {
  return costs.commission + (qty * price * costs.commission_bps) / 10_000;
}

export function positionOf(a: Account, symbol: string): Position | null {
  return a.positions.find((p) => p.symbol === symbol) ?? null;
}

export function shortExposure(a: Account): number {
  return a.positions.reduce((sum, p) => (p.qty < 0 ? sum - p.qty * p.avg_price : sum), 0);
}

export function buyingPower(a: Account): number {
  return a.cash - 2 * shortExposure(a);
}

export function unrealized(p: Position, mark: number): number {
  return p.qty * (mark - p.avg_price) - p.entry_costs;
}

export function equity(a: Account, marks: Record<string, number> = {}): number {
  return a.positions.reduce((sum, p) => sum + p.qty * markFor(p, marks), a.cash);
}

function hasMark(marks: Record<string, number>, symbol: string): boolean {
  const m = marks[symbol];
  return typeof m === "number" && Number.isFinite(m) && m > 0;
}

function markFor(p: Position, marks: Record<string, number>): number {
  return hasMark(marks, p.symbol) ? marks[p.symbol] : p.avg_price;
}

export interface Summary {
  cash: number;
  equity: number;
  buying_power: number;
  realized: number;
  unrealized: number;
  return_pct: number;
  unmarked: string[];
}

export function summary(a: Account, marks: Record<string, number> = {}): Summary {
  const eq = equity(a, marks);
  return {
    cash: a.cash,
    equity: eq,
    buying_power: buyingPower(a),
    realized: a.realized,
    unrealized: a.positions.reduce((sum, p) => sum + unrealized(p, markFor(p, marks)), 0),
    return_pct: ((eq - a.starting_cash) / a.starting_cash) * 100,
    unmarked: a.positions.filter((p) => !hasMark(marks, p.symbol)).map((p) => p.symbol),
  };
}

function capped<T>(list: T[]): T[] {
  return list.length > LIMITS.maxHistory ? list.slice(list.length - LIMITS.maxHistory) : list;
}

export function applyFill(a: Account, symbol: string, side: Side, qty: number, price: number, time: number, orderId: number | null = null): Outcome {
  const qErr = qtyError(qty);
  if (qErr) return { ok: false, error: qErr };
  const pErr = priceError(price, "Fill price");
  if (pErr) return { ok: false, error: pErr };
  const commission = commissionFor(a.costs, qty, price);
  const delta = side === "buy" ? qty : -qty;
  const old = positionOf(a, symbol);
  const held = old?.qty ?? 0;
  let nextId = a.next_id;
  const fill: Fill = { id: nextId++, order_id: orderId, symbol, side, qty, price, commission, time };
  let pos: Position | null;
  let realized = 0;
  const closed: ClosedTrade[] = [];
  if (!old || held === 0 || Math.sign(held) === Math.sign(delta)) {
    const total = held + delta;
    pos = {
      symbol,
      qty: total,
      avg_price: old ? (Math.abs(held) * old.avg_price + qty * price) / Math.abs(total) : price,
      entry_costs: (old?.entry_costs ?? 0) + commission,
      opened: old?.opened ?? time,
    };
  } else {
    const size = Math.abs(held);
    const closeQty = Math.min(qty, size);
    const openQty = qty - closeQty;
    const exitCost = (commission * closeQty) / qty;
    const entryCost = (old.entry_costs * closeQty) / size;
    const gross = closeQty * (price - old.avg_price) * Math.sign(held);
    realized = gross - entryCost - exitCost;
    closed.push({
      id: nextId++,
      symbol,
      direction: held > 0 ? "long" : "short",
      qty: closeQty,
      entry_price: old.avg_price,
      exit_price: price,
      pnl: realized,
      costs: entryCost + exitCost,
      opened: old.opened,
      closed: time,
    });
    const rest = size - closeQty;
    if (rest > 0) pos = { ...old, qty: Math.sign(held) * rest, entry_costs: Math.max(0, old.entry_costs - entryCost) };
    else if (openQty > 0) pos = { symbol, qty: Math.sign(delta) * openQty, avg_price: price, entry_costs: Math.max(0, commission - exitCost), opened: time };
    else pos = null;
  }
  const positions = a.positions.filter((p) => p.symbol !== symbol);
  if (pos) {
    const at = a.positions.findIndex((p) => p.symbol === symbol);
    positions.splice(at < 0 ? positions.length : at, 0, pos);
  }
  const next: Account = {
    ...a,
    cash: a.cash - delta * price - commission,
    realized: a.realized + realized,
    positions,
    fills: capped([...a.fills, fill]),
    trades: closed.length ? capped([...a.trades, ...closed]) : a.trades,
    next_id: nextId,
  };
  const now = pos?.qty ?? 0;
  const opens = Math.abs(now) > Math.abs(held) || (now !== 0 && held !== 0 && Math.sign(now) !== Math.sign(held));
  if (opens && buyingPower(next) < -EPS) return { ok: false, error: "Insufficient buying power" };
  return { ok: true, account: next, fill };
}

export function marketFillPrice(side: Side, reference: number, costs: Costs): number {
  return slipped(side, reference, costs.slippage_bps);
}

/** Why a stop-loss / take-profit pair cannot bracket an entry on `side` near `reference`; null when it can. */
export function bracketError(side: Side, bracket: Bracket | null | undefined, reference: number | null = null): string | null {
  if (!bracket) return null;
  const { stop, target } = bracket;
  for (const [p, label] of [[stop, "Stop-loss"], [target, "Take-profit"]] as const) {
    if (p != null && priceError(p, label)) return priceError(p, label);
  }
  const long = side === "buy";
  const below = (a: number | null, b: number | null) => a == null || b == null || (long ? a < b : a > b);
  if (!below(stop, target)) return `Stop-loss must be ${long ? "below" : "above"} take-profit`;
  if (!below(stop, reference)) return `Stop-loss must be ${long ? "below" : "above"} the entry price`;
  if (!below(reference, target)) return `Take-profit must be ${long ? "above" : "below"} the entry price`;
  return null;
}

/** After `order` fills: cancels its one-cancels-other siblings and places its bracket's exit orders. */
function afterFill(a: Account, order: Pick<Order, "symbol" | "side" | "qty" | "oco" | "bracket">, time: number): Account {
  const next = order.oco != null ? { ...a, orders: a.orders.filter((o) => o.oco !== order.oco) } : a;
  const { stop = null, target = null } = order.bracket ?? {};
  if (stop == null && target == null) return next;
  const base = { symbol: order.symbol, side: order.side === "buy" ? ("sell" as const) : ("buy" as const), qty: order.qty, created: time, oco: next.next_id };
  let id = next.next_id;
  const exits: Order[] = [];
  if (stop != null) exits.push({ ...base, id: id++, kind: "stop", price: stop });
  if (target != null) exits.push({ ...base, id: id++, kind: "limit", price: target });
  return { ...next, orders: [...next.orders, ...exits], next_id: id };
}

export function marketOrder(a: Account, symbol: string, side: Side, qty: number, reference: number, time: number, bracket: Bracket | null = null): Outcome {
  const error = priceError(reference, "Reference price") ?? bracketError(side, bracket, reference);
  if (error) return { ok: false, error };
  if (bracket && a.orders.length + 2 > LIMITS.maxOrders) return { ok: false, error: `At most ${LIMITS.maxOrders} open orders are allowed` };
  const r = applyFill(a, symbol, side, qty, marketFillPrice(side, reference, a.costs), time);
  return r.ok && bracket ? { ...r, account: afterFill(r.account, { symbol, side, qty, bracket }, time) } : r;
}

export function placeOrder(a: Account, req: OrderRequest, time: number, estimate: number | null = null): Outcome {
  if (!req.symbol) return { ok: false, error: "No symbol" };
  if (req.side !== "buy" && req.side !== "sell") return { ok: false, error: "Unknown side" };
  if (req.kind !== "market" && req.kind !== "limit" && req.kind !== "stop") return { ok: false, error: "Unknown order type" };
  const qErr = qtyError(req.qty);
  if (qErr) return { ok: false, error: qErr };
  const price = req.kind === "market" ? null : (req.price ?? null);
  if (req.kind !== "market") {
    const error = priceError(price, req.kind === "limit" ? "Limit price" : "Stop price");
    if (error) return { ok: false, error };
  }
  const bracket = req.bracket && (req.bracket.stop != null || req.bracket.target != null) ? req.bracket : undefined;
  const bErr = bracketError(req.side, bracket, price ?? estimate);
  if (bErr) return { ok: false, error: bErr };
  if (a.orders.length + (bracket ? 3 : 1) > LIMITS.maxOrders) return { ok: false, error: `At most ${LIMITS.maxOrders} open orders are allowed` };
  const check = req.kind === "limit" ? price! : req.kind === "stop" ? slipped(req.side, price!, a.costs.slippage_bps) : estimate != null ? marketFillPrice(req.side, estimate, a.costs) : null;
  if (check != null) {
    const trial = applyFill(a, req.symbol, req.side, req.qty, check, time);
    if (!trial.ok) return trial;
  }
  const order: Order = { id: a.next_id, symbol: req.symbol, side: req.side, qty: req.qty, kind: req.kind, price, created: time, ...(bracket ? { bracket } : {}) };
  return { ok: true, account: { ...a, orders: [...a.orders, order], next_id: a.next_id + 1 }, order };
}

export function cancelOrder(a: Account, id: number): Account {
  return a.orders.some((o) => o.id === id) ? { ...a, orders: a.orders.filter((o) => o.id !== id) } : a;
}

export function triggerPrice(order: Order, bar: Bar, costs: Costs): number | null {
  if (order.kind === "market") return slipped(order.side, bar.o, costs.slippage_bps);
  const p = order.price!;
  if (order.kind === "limit") {
    if (order.side === "buy") return bar.l <= p ? Math.min(bar.o, p) : null;
    return bar.h >= p ? Math.max(bar.o, p) : null;
  }
  if (order.side === "buy") return bar.h >= p ? slipped("buy", Math.max(bar.o, p), costs.slippage_bps) : null;
  return bar.l <= p ? slipped("sell", Math.min(bar.o, p), costs.slippage_bps) : null;
}

export function processBar(a: Account, symbol: string, bar: Bar): { account: Account; events: BarEvent[] } {
  let account = a;
  const events: BarEvent[] = [];
  for (const order of a.orders) {
    if (order.symbol !== symbol || !(bar.t > order.created) || !account.orders.some((o) => o.id === order.id)) continue;
    const price = triggerPrice(order, bar, account.costs);
    if (price == null) continue;
    const rest = cancelOrder(account, order.id);
    const result = applyFill(rest, symbol, order.side, order.qty, price, bar.t, order.id);
    if (result.ok) {
      account = afterFill(result.account, order, bar.t);
      events.push({ kind: "fill", order, fill: result.fill! });
    } else {
      account = rest;
      events.push({ kind: "rejected", order, error: result.error });
    }
  }
  return { account, events };
}

export function processPrice(a: Account, symbol: string, price: number, time: number): { account: Account; events: BarEvent[] } {
  if (!(price > 0) || !Number.isFinite(price)) return { account: a, events: [] };
  return processBar(a, symbol, { t: time, o: price, h: price, l: price, c: price });
}

export function liveBlock(session: Session | null, state: FreshnessState | null, price: number | null): string | null {
  if (price == null || !Number.isFinite(price) || price <= 0 || session == null || state == null) return "No live quote yet";
  if (session === "closed" || state === "closed") return "Market is closed";
  if (session !== "regular") return "Market orders fill only during the regular session";
  if (state === "stale") return "Quote is stale";
  if (state === "unknown") return "Quote time is unknown";
  return null;
}

export interface Book {
  start: number;
  states: Account[];
}

export function openBook(account: Account, cursor: number): Book {
  return { start: cursor, states: [account] };
}

export function bookCursor(book: Book): number {
  return book.start + book.states.length - 1;
}

export function bookAccount(book: Book): Account {
  return book.states[book.states.length - 1];
}

export function updateBook(book: Book, account: Account): Book {
  return { ...book, states: [...book.states.slice(0, -1), account] };
}

export function seekBook(book: Book, bars: readonly Bar[], cursor: number, symbol: string): { book: Book; events: BarEvent[] } {
  const target = Math.max(book.start, Math.min(cursor, bars.length - 1));
  const k = target - book.start;
  if (k < book.states.length) return { book: k === book.states.length - 1 ? book : { ...book, states: book.states.slice(0, k + 1) }, events: [] };
  const states = [...book.states];
  const events: BarEvent[] = [];
  for (let i = bookCursor(book) + 1; i <= target; i++) {
    const r = processBar(states[states.length - 1], symbol, bars[i]);
    states.push(r.account);
    events.push(...r.events);
  }
  return { book: { ...book, states }, events };
}

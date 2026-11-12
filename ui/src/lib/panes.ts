import { paneLayout } from "./indicators";

export const PANES = ["rsi", "macd", "stoch", "obv"] as const;
export type PaneId = (typeof PANES)[number];
export type Slot = PaneId | "price";
export const LEFT_SCALES = ["off", "same", "percent"] as const;
export type LeftScale = (typeof LEFT_SCALES)[number];
export interface PaneState { groups: Slot[][]; left: LeftScale }

export const PANE_NAMES: Record<Slot, string> = { price: "Price", rsi: "RSI", macd: "MACD", stoch: "Stochastic", obv: "OBV" };

export function defaultPanes(): PaneState {
  return { groups: [["price"], ...PANES.map((id) => [id])], left: "off" };
}

export function cleanPanes(v: unknown): PaneState {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const seen = new Set<Slot>();
  const known = new Set<string>(["price", ...PANES]);
  const groups: Slot[][] = [];
  for (const g of Array.isArray(o.groups) ? o.groups : []) {
    if (!Array.isArray(g)) continue;
    const ids = g.filter((id): id is Slot => typeof id === "string" && known.has(id) && !seen.has(id as Slot));
    ids.forEach((id) => seen.add(id));
    if (ids.length) groups.push(ids);
  }
  const at = groups.findIndex((g) => g.includes("price"));
  const price: Slot[] = ["price", ...(at >= 0 ? groups.splice(at, 1)[0].filter((id) => id !== "price") : [])];
  for (const id of PANES) if (!seen.has(id)) groups.push([id]);
  return { groups: [price, ...groups], left: LEFT_SCALES.includes(o.left as LeftScale) ? (o.left as LeftScale) : "off" };
}

export function visibleGroups(groups: readonly (readonly Slot[])[], on: (id: PaneId) => boolean): Slot[][] {
  return groups.map((g) => g.filter((id) => id === "price" || on(id))).filter((g) => g.length);
}

function find(groups: readonly (readonly Slot[])[], id: Slot) {
  return groups.findIndex((g) => g.includes(id));
}

function neighbor(groups: readonly (readonly Slot[])[], from: number, dir: -1 | 1, on: (id: PaneId) => boolean, floor: number) {
  for (let k = from + dir; k >= floor && k < groups.length; k += dir) {
    if (groups[k].some((id) => id === "price" || on(id))) return k;
  }
  return -1;
}

export function movePane(state: PaneState, id: PaneId, dir: -1 | 1, on: (id: PaneId) => boolean): PaneState {
  const from = find(state.groups, id);
  if (from <= 0) return state;
  const to = neighbor(state.groups, from, dir, on, 1);
  if (to < 0) return state;
  const groups = state.groups.map((g) => [...g]);
  [groups[from], groups[to]] = [groups[to], groups[from]];
  return { ...state, groups };
}

export function mergeUp(state: PaneState, id: PaneId, on: (id: PaneId) => boolean): PaneState {
  const from = find(state.groups, id);
  if (from <= 0) return state;
  const to = neighbor(state.groups, from, -1, on, 0);
  if (to < 0) return state;
  const groups = state.groups.map((g) => [...g]);
  groups[to].push(...groups[from]);
  groups.splice(from, 1);
  return { ...state, groups };
}

export function unmerge(state: PaneState, id: Slot): PaneState {
  const at = find(state.groups, id);
  if (at < 0 || state.groups[at].length < 2) return state;
  const g = state.groups[at];
  const parts: Slot[][] = g[0] === "price" ? [["price"], ...g.slice(1).map((s) => [s])] : g.map((s) => [s]);
  return { ...state, groups: [...state.groups.slice(0, at).map((x) => [...x]), ...parts, ...state.groups.slice(at + 1).map((x) => [...x])] };
}

export interface PaneRect { ids: PaneId[]; top: number; h: number }

export function paneRects(height: number, visible: readonly (readonly Slot[])[], max: Slot | null) {
  const overlays = (visible[0] ?? []).filter((id): id is PaneId => id !== "price");
  const subs = visible.slice(1) as PaneId[][];
  const maxed = max && max !== "price" ? subs.find((g) => g.includes(max)) : undefined;
  const base = paneLayout(height, false, false, max === "price" || maxed ? 0 : subs.length);
  const slots: PaneRect[] = maxed ? [{ ids: maxed, top: 0, h: height }]
    : max === "price" ? []
    : subs.map((ids, k) => ({ ids, top: base.extraTops[k], h: base.rsiH }));
  return { priceH: base.priceH, volTop: base.volTop, volH: base.volH, hidePrice: !!maxed, overlays, slots };
}

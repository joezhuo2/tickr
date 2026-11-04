export interface History {
  back: string[];
  forward: string[];
}

export interface Move {
  history: History;
  to: string;
}

export const MAX_BACK = 50;
export const MAX_RECENT = 10;

export const emptyHistory = (): History => ({ back: [], forward: [] });

const capped = (back: string[]) => back.slice(-MAX_BACK);

export function visit(h: History, current: string, next: string): History {
  if (next === current) return h;
  return { back: capped([...h.back, current]), forward: [] };
}

export function goBack(h: History, current: string): Move | null {
  const to = h.back.at(-1);
  if (to === undefined) return null;
  return { to, history: { back: h.back.slice(0, -1), forward: [current, ...h.forward] } };
}

export function goForward(h: History, current: string): Move | null {
  const to = h.forward[0];
  if (to === undefined) return null;
  return { to, history: { back: capped([...h.back, current]), forward: h.forward.slice(1) } };
}

export function previous(h: History, current: string): Move | null {
  const to = h.back.at(-1);
  if (to === undefined) return null;
  return { to, history: { back: [...h.back.slice(0, -1), current], forward: h.forward } };
}

export function pushRecent(recent: string[], symbol: string): string[] {
  return [symbol, ...recent.filter((s) => s !== symbol)].slice(0, MAX_RECENT);
}

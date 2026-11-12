import type { Candle } from "./types";

export interface Sink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
}

export function columnPen(sink: Sink, perPx: number) {
  let key = 0, x = 0, first = 0, lo = 0, hi = 0, last = 0, count = 0, down = false;
  const flush = () => {
    if (!count) return;
    if (down) sink.lineTo(x, first);
    else sink.moveTo(x, first);
    if (count > 1) {
      sink.lineTo(x, lo);
      sink.lineTo(x, hi);
      sink.lineTo(x, last);
    }
    down = true;
    count = 0;
  };
  return {
    to(px: number, y: number) {
      const k = Math.floor(px * perPx);
      if (count && k === key) {
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
        last = y;
        count++;
        return;
      }
      flush();
      key = k;
      x = px;
      first = lo = hi = last = y;
      count = 1;
    },
    lift() {
      flush();
      down = false;
    },
  };
}

export interface Column extends Candle {
  x: number;
}

export function columns(candles: readonly Candle[], from: number, to: number, x: (i: number) => number, perPx: number): Column[] {
  const out: Column[] = [];
  let key = 0;
  for (let i = from; i <= to; i++) {
    const c = candles[i];
    const k = Math.floor(x(i) * perPx);
    const col = out[out.length - 1];
    if (col && k === key) {
      col.h = Math.max(col.h, c.h);
      col.l = Math.min(col.l, c.l);
      col.c = c.c;
      col.v = Math.max(col.v, c.v);
    } else {
      out.push({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, x: (k + 0.5) / perPx });
      key = k;
    }
  }
  return out;
}

import type { Candle } from "./types";

export type Field = "close" | "open" | "high" | "low" | "volume";
export type Indicator = "sma" | "ema" | "rsi";
type Kind = "num" | "bool";

export type Expr =
  | { k: "num"; v: number }
  | { k: "field"; name: Field }
  | { k: "ind"; fn: Indicator; n: number }
  | { k: "cross"; dir: "above" | "below"; a: Expr; b: Expr }
  | { k: "cmp"; op: ">" | "<" | ">=" | "<=" | "=="; a: Expr; b: Expr }
  | { k: "math"; op: "+" | "-" | "*" | "/"; a: Expr; b: Expr }
  | { k: "logic"; op: "and" | "or"; a: Expr; b: Expr }
  | { k: "not"; a: Expr }
  | { k: "neg"; a: Expr };

export class ParseError extends Error {
  constructor(message: string, readonly pos: number) {
    super(`${message} at position ${pos + 1}`);
  }
}

type Token = { t: "num" | "id" | "op" | "end"; v: string; pos: number };

const FIELDS: Field[] = ["close", "open", "high", "low", "volume"];
const INDICATORS: Indicator[] = ["sma", "ema", "rsi"];
const MAX_PERIOD = 1000;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    const m = /^(\d+\.?\d*|\.\d+)/.exec(rest) ?? /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest) ?? /^(>=|<=|==|[><+\-*/(),])/.exec(rest);
    if (!m) throw new ParseError(`Unexpected character "${ch}"`, i);
    const v = m[0];
    out.push({ t: /^[\d.]/.test(v) ? "num" : /^[A-Za-z_]/.test(v) ? "id" : "op", v: /^[A-Za-z_]/.test(v) ? v.toLowerCase() : v, pos: i });
    i += v.length;
  }
  out.push({ t: "end", v: "", pos: src.length });
  return out;
}

export function parse(src: string): Expr {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const describe = (tok: Token) => (tok.t === "end" ? "end of expression" : `"${tok.v}"`);

  function expect(v: string) {
    const tok = peek();
    if (tok.v !== v || tok.t === "end") throw new ParseError(`Expected "${v}" but found ${describe(tok)}`, tok.pos);
    p++;
  }

  function need(e: { e: Expr; kind: Kind; pos: number }, kind: Kind, what: string): Expr {
    if (e.kind !== kind) throw new ParseError(`${what} needs ${kind === "num" ? "a number" : "a true/false condition"}`, e.pos);
    return e.e;
  }

  function or(): { e: Expr; kind: Kind; pos: number } {
    let left = and();
    while (peek().v === "or" && peek().t === "id") {
      p++;
      const right = and();
      left = { e: { k: "logic", op: "or", a: need(left, "bool", '"or"'), b: need(right, "bool", '"or"') }, kind: "bool", pos: left.pos };
    }
    return left;
  }

  function and(): { e: Expr; kind: Kind; pos: number } {
    let left = not();
    while (peek().v === "and" && peek().t === "id") {
      p++;
      const right = not();
      left = { e: { k: "logic", op: "and", a: need(left, "bool", '"and"'), b: need(right, "bool", '"and"') }, kind: "bool", pos: left.pos };
    }
    return left;
  }

  function not(): { e: Expr; kind: Kind; pos: number } {
    const tok = peek();
    if (tok.t === "id" && tok.v === "not") {
      p++;
      return { e: { k: "not", a: need(not(), "bool", '"not"') }, kind: "bool", pos: tok.pos };
    }
    return cmp();
  }

  function cmp(): { e: Expr; kind: Kind; pos: number } {
    const left = sum();
    const tok = peek();
    if (tok.t !== "op" || ![">", "<", ">=", "<=", "=="].includes(tok.v)) return left;
    p++;
    const right = sum();
    const what = `"${tok.v}"`;
    const e: Expr = { k: "cmp", op: tok.v as ">", a: need(left, "num", what), b: need(right, "num", what) };
    if (peek().t === "op" && [">", "<", ">=", "<=", "=="].includes(peek().v)) throw new ParseError("Chained comparisons are not allowed; join them with \"and\"", peek().pos);
    return { e, kind: "bool", pos: left.pos };
  }

  function sum(): { e: Expr; kind: Kind; pos: number } {
    let left = product();
    while (peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = tokens[p++].v as "+";
      const right = product();
      left = { e: { k: "math", op, a: need(left, "num", `"${op}"`), b: need(right, "num", `"${op}"`) }, kind: "num", pos: left.pos };
    }
    return left;
  }

  function product(): { e: Expr; kind: Kind; pos: number } {
    let left = unary();
    while (peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = tokens[p++].v as "*";
      const right = unary();
      left = { e: { k: "math", op, a: need(left, "num", `"${op}"`), b: need(right, "num", `"${op}"`) }, kind: "num", pos: left.pos };
    }
    return left;
  }

  function unary(): { e: Expr; kind: Kind; pos: number } {
    const tok = peek();
    if (tok.t === "op" && tok.v === "-") {
      p++;
      return { e: { k: "neg", a: need(unary(), "num", '"-"') }, kind: "num", pos: tok.pos };
    }
    return atom();
  }

  function atom(): { e: Expr; kind: Kind; pos: number } {
    const tok = peek();
    if (tok.t === "num") {
      p++;
      return { e: { k: "num", v: Number(tok.v) }, kind: "num", pos: tok.pos };
    }
    if (tok.t === "op" && tok.v === "(") {
      p++;
      const inner = or();
      expect(")");
      return { ...inner, pos: tok.pos };
    }
    if (tok.t === "id") {
      p++;
      if ((FIELDS as string[]).includes(tok.v)) return { e: { k: "field", name: tok.v as Field }, kind: "num", pos: tok.pos };
      if ((INDICATORS as string[]).includes(tok.v)) {
        expect("(");
        const arg = peek();
        const n = Number(arg.v);
        if (arg.t !== "num" || !Number.isInteger(n) || n < 1 || n > MAX_PERIOD) throw new ParseError(`${tok.v}() needs a whole-number period from 1 to ${MAX_PERIOD}`, arg.pos);
        p++;
        expect(")");
        return { e: { k: "ind", fn: tok.v as Indicator, n }, kind: "num", pos: tok.pos };
      }
      if (tok.v === "crosses_above" || tok.v === "crosses_below") {
        expect("(");
        const a = sum();
        expect(",");
        const b = sum();
        expect(")");
        const what = `${tok.v}()`;
        return { e: { k: "cross", dir: tok.v === "crosses_above" ? "above" : "below", a: need(a, "num", what), b: need(b, "num", what) }, kind: "bool", pos: tok.pos };
      }
      throw new ParseError(`Unknown name "${tok.v}"`, tok.pos);
    }
    throw new ParseError(`Unexpected ${describe(tok)}`, tok.pos);
  }

  if (peek().t === "end") throw new ParseError("Expression is empty", 0);
  const root = or();
  if (peek().t !== "end") throw new ParseError(`Unexpected ${describe(peek())}`, peek().pos);
  need(root, "bool", "The expression");
  return root.e;
}

export function check(src: string): string | null {
  try {
    parse(src);
    return null;
  } catch (e) {
    return e instanceof ParseError ? e.message : String(e);
  }
}

export function sma(src: number[], n: number): number[] {
  let sum = 0;
  return src.map((x, i) => {
    sum += x;
    if (i >= n) sum -= src[i - n];
    return i >= n - 1 ? sum / n : NaN;
  });
}

function smoothed(src: number[], n: number, alpha: number): number[] {
  let prev = NaN;
  let sum = 0;
  return src.map((x, i) => {
    if (i < n) {
      sum += x;
      if (i === n - 1) prev = sum / n;
      return prev;
    }
    prev = alpha * x + (1 - alpha) * prev;
    return prev;
  });
}

export function ema(src: number[], n: number): number[] {
  return smoothed(src, n, 2 / (n + 1));
}

export function rsi(closes: number[], n: number): number[] {
  if (!closes.length) return [];
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const up = smoothed(changes.map((d) => Math.max(d, 0)), n, 1 / n);
  const down = smoothed(changes.map((d) => Math.max(-d, 0)), n, 1 / n);
  return [NaN, ...up.map((u, i) => {
    const d = down[i];
    if (Number.isNaN(u)) return NaN;
    if (d === 0) return u === 0 ? 50 : 100;
    return 100 - 100 / (1 + u / d);
  })];
}

export function evaluate(expr: Expr, candles: readonly Candle[]): boolean[] {
  const cache = new Map<string, number[]>();
  const closes = () => candles.map((c) => c.c);
  const key: Record<Field, keyof Candle> = { close: "c", open: "o", high: "h", low: "l", volume: "v" };

  function series(e: Expr): number[] {
    switch (e.k) {
      case "num":
        return candles.map(() => e.v);
      case "field":
        return candles.map((c) => c[key[e.name]]);
      case "ind": {
        const id = `${e.fn}:${e.n}`;
        let s = cache.get(id);
        if (!s) {
          s = e.fn === "sma" ? sma(closes(), e.n) : e.fn === "ema" ? ema(closes(), e.n) : rsi(closes(), e.n);
          cache.set(id, s);
        }
        return s;
      }
      case "neg":
        return series(e.a).map((x) => -x);
      case "not":
        return series(e.a).map((x) => (x ? 0 : 1));
      case "cross": {
        const a = series(e.a);
        const b = series(e.b);
        const up = e.dir === "above";
        return a.map((x, i) => (i > 0 && (up ? a[i - 1] <= b[i - 1] && x > b[i] : a[i - 1] >= b[i - 1] && x < b[i]) ? 1 : 0));
      }
      case "cmp":
      case "math":
      case "logic": {
        const a = series(e.a);
        const b = series(e.b);
        const f = OPS[e.op];
        return a.map((x, i) => f(x, b[i]));
      }
    }
  }

  return series(expr).map((x) => x === 1);
}

const OPS: Record<string, (a: number, b: number) => number> = {
  ">": (a, b) => +(a > b),
  "<": (a, b) => +(a < b),
  ">=": (a, b) => +(a >= b),
  "<=": (a, b) => +(a <= b),
  "==": (a, b) => +(a === b),
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
  and: (a, b) => +(a === 1 && b === 1),
  or: (a, b) => +(a === 1 || b === 1),
};

export type Operand = { kind: Field | Indicator | "value"; n: number };
export type Condition = ">" | "<" | ">=" | "<=" | "crosses_above" | "crosses_below";

export function operandText(o: Operand): string {
  if (o.kind === "value") return String(o.n);
  return (INDICATORS as string[]).includes(o.kind) ? `${o.kind}(${o.n})` : o.kind;
}

export function buildCondition(left: Operand, op: Condition, right: Operand): string {
  const a = operandText(left);
  const b = operandText(right);
  return op === "crosses_above" || op === "crosses_below" ? `${op}(${a}, ${b})` : `${a} ${op} ${b}`;
}

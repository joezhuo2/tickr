import { PATTERN_INFO, PATTERN_KINDS, isPatternKind, type PatternKind } from "./patternInfo";
import { KEEP_BEFORE, randomInt, type Rng } from "./practice";
import { MIN_CONTEXT } from "./replay";
import type { Candle, Pattern } from "./types";

export const NEXT_BARS = 5;
export const CHOICES = 4;

export type Mode = "name" | "move";
export type PracticeMode = "trade" | Mode;
export type Move = "up" | "down";

export const MODE_LABELS: Record<PracticeMode, string> = { trade: "Trade", name: "Name the pattern", move: "Next move" };

export interface Question {
  mode: Mode;
  kind: PatternKind;
  start: number;
  end: number;
  choices: PatternKind[];
}

export interface Score {
  correct: number;
  total: number;
  streak: number;
}

export const EMPTY_SCORE: Score = { correct: 0, total: 0, streak: 0 };

export function record(score: Score, correct: boolean): Score {
  return { correct: score.correct + (correct ? 1 : 0), total: score.total + 1, streak: correct ? score.streak + 1 : 0 };
}

function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function choices(answer: PatternKind, exclude: readonly string[], rng: Rng, n = CHOICES): PatternKind[] {
  const bias = PATTERN_INFO[answer].bias;
  const pool = PATTERN_KINDS.filter((k) => k !== answer && !exclude.includes(k));
  const near = shuffle(pool.filter((k) => PATTERN_INFO[k].bias === bias), rng);
  const far = shuffle(pool.filter((k) => PATTERN_INFO[k].bias !== bias), rng);
  return shuffle([answer, ...[...near, ...far].slice(0, n - 1)], rng);
}

export function build(patterns: readonly Pattern[], candles: readonly Candle[], from: number, mode: Mode, rng: Rng): { bars: Candle[]; question: Question } | null {
  const usable = patterns.filter((p) => p.context_ok && isPatternKind(p.kind) && p.end >= MIN_CONTEXT && p.end + NEXT_BARS < candles.length && candles[p.end].t >= from);
  if (!usable.length) return null;
  const p = usable[randomInt(rng, usable.length)];
  const kind = p.kind as PatternKind;
  const lo = Math.max(0, p.end - KEEP_BEFORE);
  const rivals = patterns.filter((x) => x.end === p.end).map((x) => x.kind);
  return {
    bars: candles.slice(lo, p.end + NEXT_BARS + 1),
    question: { mode, kind, start: p.start - lo, end: p.end - lo, choices: choices(kind, rivals, rng) },
  };
}

export function outcome(bars: readonly Candle[], end: number, n = NEXT_BARS): { move: Move | "flat"; pct: number } | null {
  const from = bars[end]?.c;
  const to = bars[end + n]?.c;
  if (!(from > 0) || to == null) return null;
  const pct = ((to - from) / from) * 100;
  return { move: pct > 0 ? "up" : pct < 0 ? "down" : "flat", pct };
}

export function grade(q: Question, guess: string, bars: readonly Candle[]): boolean {
  return q.mode === "name" ? guess === q.kind : outcome(bars, q.end)?.move === guess;
}

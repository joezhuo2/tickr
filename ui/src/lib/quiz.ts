import type { ChartPattern } from "./chartPatterns";
import { CHART_PATTERN_INFO, CHART_PATTERN_KINDS, PATTERN_INFO, PATTERN_KINDS, isPatternKind, type ChartPatternKind, type PatternInfo, type PatternKind } from "./patternInfo";
import { KEEP_BEFORE, randomInt, type Rng } from "./practice";
import { MIN_CONTEXT } from "./replay";
import type { Candle, Pattern } from "./types";

export const NEXT_BARS = 5;
export const CHOICES = 4;

export type Mode = "name" | "move" | "chart";
export type PracticeMode = "trade" | Mode;
export type Move = "up" | "down";
export type QuizKind = PatternKind | ChartPatternKind;

export const MODE_LABELS: Record<PracticeMode, string> = { trade: "Trade", name: "Name the pattern", move: "Next move", chart: "Name the chart pattern" };

export interface Question {
  mode: Mode;
  kind: QuizKind;
  start: number;
  end: number;
  choices: QuizKind[];
}

export interface Score {
  correct: number;
  total: number;
  streak: number;
}

export const EMPTY_SCORE: Score = { correct: 0, total: 0, streak: 0 };

export function quizInfo(kind: QuizKind): PatternInfo {
  return isPatternKind(kind) ? PATTERN_INFO[kind] : CHART_PATTERN_INFO[kind];
}

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

export function choices(answer: QuizKind, exclude: readonly string[], rng: Rng, n = CHOICES, kinds: readonly QuizKind[] = PATTERN_KINDS): QuizKind[] {
  const bias = quizInfo(answer).bias;
  const pool = kinds.filter((k) => k !== answer && !exclude.includes(k));
  const near = shuffle(pool.filter((k) => quizInfo(k).bias === bias), rng);
  const far = shuffle(pool.filter((k) => quizInfo(k).bias !== bias), rng);
  return shuffle([answer, ...[...near, ...far].slice(0, n - 1)], rng);
}

function ask(p: { kind: QuizKind; start: number; end: number }, candles: readonly Candle[], mode: Mode, rivals: readonly string[], kinds: readonly QuizKind[], rng: Rng) {
  const lo = Math.max(0, Math.min(p.start, p.end - KEEP_BEFORE));
  return {
    bars: candles.slice(lo, p.end + NEXT_BARS + 1),
    question: { mode, kind: p.kind, start: p.start - lo, end: p.end - lo, choices: choices(p.kind, rivals, rng, CHOICES, kinds) },
  };
}

export function build(patterns: readonly Pattern[], candles: readonly Candle[], from: number, mode: Mode, rng: Rng): { bars: Candle[]; question: Question } | null {
  const usable = patterns.filter((p) => p.context_ok && isPatternKind(p.kind) && p.end >= MIN_CONTEXT && p.end + NEXT_BARS < candles.length && candles[p.end].t >= from);
  if (!usable.length) return null;
  const p = usable[randomInt(rng, usable.length)];
  const rivals = patterns.filter((x) => x.end === p.end).map((x) => x.kind);
  return ask({ kind: p.kind as PatternKind, start: p.start, end: p.end }, candles, mode, rivals, PATTERN_KINDS, rng);
}

export function buildChart(patterns: readonly ChartPattern[], candles: readonly Candle[], from: number, rng: Rng): { bars: Candle[]; question: Question } | null {
  const usable = patterns.filter((p) => p.confirmed && p.end >= MIN_CONTEXT && p.end + NEXT_BARS < candles.length && candles[p.end].t >= from);
  if (!usable.length) return null;
  const p = usable[randomInt(rng, usable.length)];
  const rivals = patterns.filter((x) => x.start <= p.end && x.end >= p.start).map((x) => x.kind);
  return ask(p, candles, "chart", rivals, CHART_PATTERN_KINDS, rng);
}

export function outcome(bars: readonly Candle[], end: number, n = NEXT_BARS): { move: Move | "flat"; pct: number } | null {
  const from = bars[end]?.c;
  const to = bars[end + n]?.c;
  if (!(from > 0) || to == null) return null;
  const pct = ((to - from) / from) * 100;
  return { move: pct > 0 ? "up" : pct < 0 ? "down" : "flat", pct };
}

export function grade(q: Question, guess: string, bars: readonly Candle[]): boolean {
  return q.mode === "move" ? outcome(bars, q.end)?.move === guess : guess === q.kind;
}

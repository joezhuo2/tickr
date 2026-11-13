import { describe, expect, it } from "vitest";
import { PATTERN_INFO, PATTERN_KINDS } from "./patternInfo";
import { seeded } from "./practice";
import { CHOICES, EMPTY_SCORE, NEXT_BARS, build, choices, grade, outcome, record } from "./quiz";
import type { Candle, Pattern } from "./types";

const bars = (closes: number[]): Candle[] => closes.map((c, i) => ({ t: 1000 + i, o: c, h: c, l: c, c, v: 1 }));

const pattern = (kind: string, end: number, over: Partial<Pattern> = {}): Pattern => ({
  kind,
  name: kind,
  direction: "bullish",
  start: end - 1,
  end,
  t: 1000 + end,
  trend: "down",
  context_ok: true,
  strength: 0.5,
  limited: false,
  ...over,
});

describe("quiz choices", () => {
  it("offers the answer plus distinct distractors", () => {
    for (let seed = 1; seed < 40; seed++) {
      const list = choices("hammer", [], seeded(seed));
      expect(list).toHaveLength(CHOICES);
      expect(new Set(list).size).toBe(CHOICES);
      expect(list).toContain("hammer");
    }
  });

  it("prefers distractors with the same bias and skips excluded kinds", () => {
    const list = choices("hammer", ["morning_star"], seeded(3));
    expect(list).not.toContain("morning_star");
    const others = list.filter((k) => k !== "hammer");
    expect(others.every((k) => PATTERN_INFO[k].bias === "bullish")).toBe(true);
  });

  it("falls back to other biases when too few share the bias", () => {
    const same = PATTERN_KINDS.filter((k) => PATTERN_INFO[k].bias === "neutral" && k !== "doji");
    const list = choices("doji", [], seeded(5));
    expect(list).toHaveLength(CHOICES);
    expect(same.length).toBeLessThan(CHOICES - 1);
  });
});

describe("quiz build", () => {
  const candles = bars(Array.from({ length: 80 }, (_, i) => 100 + i));

  it("windows the chart around a scored pattern and keeps the next bars", () => {
    const built = build([pattern("hammer", 40)], candles, 0, "move", seeded(1))!;
    expect(built.question.kind).toBe("hammer");
    expect(built.question.end).toBe(40);
    expect(built.question.start).toBe(39);
    expect(built.bars).toHaveLength(40 + NEXT_BARS + 1);
    expect(built.question.choices).toContain("hammer");
  });

  it("skips unscored, unknown, too early, too late and out-of-range patterns", () => {
    const list = [
      pattern("hammer", 40, { context_ok: false }),
      pattern("mystery", 40),
      pattern("hammer", 3),
      pattern("hammer", 79),
      pattern("hammer", 40),
    ];
    expect(build(list, candles, 1000 + 41, "name", seeded(1))).toBeNull();
    expect(build(list, candles, 0, "name", seeded(1))?.question.end).toBe(40);
  });

  it("never offers another pattern that ends on the same candle", () => {
    const rivals = [pattern("hammer", 40), pattern("doji", 40, { context_ok: false })];
    for (let seed = 1; seed < 30; seed++) expect(build(rivals, candles, 0, "name", seeded(seed))!.question.choices).not.toContain("doji");
  });
});

describe("next move", () => {
  it("compares the close N bars after the pattern with its close", () => {
    const up = bars([10, 11, 12, 13, 14, 15, 16]);
    expect(outcome(up, 1)?.move).toBe("up");
    expect(outcome(up, 1)?.pct).toBeCloseTo(((16 - 11) / 11) * 100);
    expect(outcome(bars([10, 9, 8, 7, 6, 5, 4]), 1)?.move).toBe("down");
    expect(outcome(bars([10, 10, 1, 1, 1, 1, 10]), 1)?.move).toBe("flat");
    expect(outcome(up, 3)).toBeNull();
  });

  it("grades both modes", () => {
    const up = bars([10, 11, 12, 13, 14, 15, 16]);
    const q = { mode: "move" as const, kind: "hammer" as const, start: 0, end: 1, choices: [] };
    expect(grade(q, "up", up)).toBe(true);
    expect(grade(q, "down", up)).toBe(false);
    expect(grade({ ...q, mode: "name" }, "hammer", up)).toBe(true);
    expect(grade({ ...q, mode: "name" }, "doji", up)).toBe(false);
  });
});

describe("score", () => {
  it("tracks correct, total and streak", () => {
    let s = record(EMPTY_SCORE, true);
    s = record(s, true);
    expect(s).toEqual({ correct: 2, total: 2, streak: 2 });
    s = record(s, false);
    expect(s).toEqual({ correct: 2, total: 3, streak: 0 });
  });
});

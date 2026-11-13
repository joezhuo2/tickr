import { describe, expect, it } from "vitest";
import {
  BASE_MS,
  MIN_CONTEXT,
  SPEEDS,
  canReplay,
  chartAt,
  cutoff,
  isAtEnd,
  known,
  msPerBar,
  pause,
  play,
  revealed,
  revealedAt,
  seekTime,
  setSpeed,
  settled,
  startAt,
  startIndex,
  step,
  stepBack,
  tick,
  toggle,
  type ReplayState,
  type Speed,
} from "./replay";

const DAY = 86_400;
const bars = (n: number, from = 1_700_000_000) => Array.from({ length: n }, (_, i) => ({ t: from + i * DAY, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 100 + i }));
const BARS = bars(100);
const at = (i: number) => BARS[i].t;
const started = (i = 50) => startAt(BARS, at(i))!;

function checkNoLeak(list: typeof BARS, s: ReplayState) {
  const shown = revealed(list, s);
  expect(shown).toHaveLength(s.cursor + 1);
  expect(shown).toEqual(list.slice(0, s.cursor + 1));
  const last = shown[shown.length - 1].t;
  for (const b of shown) expect(b.t).toBeLessThanOrEqual(last);
  for (const b of list.slice(s.cursor + 1)) expect(shown).not.toContain(b);
  expect(cutoff(list, s)).toBeGreaterThan(last);
  if (s.cursor + 1 < list.length) expect(cutoff(list, s)).toBe(list[s.cursor + 1].t);
}

describe("speeds", () => {
  it("maps each speed to milliseconds per bar", () => {
    expect(SPEEDS).toEqual([1, 2, 5, 10]);
    expect(SPEEDS.map(msPerBar)).toEqual([BASE_MS, BASE_MS / 2, BASE_MS / 5, BASE_MS / 10]);
  });
});

describe("startAt", () => {
  it("starts at the first bar at or after the chosen time", () => {
    expect(started(50)).toEqual({ total: 100, start: 50, cursor: 50, playing: false, speed: 1, elapsed: 0 });
    expect(startAt(BARS, at(50) - 1)!.cursor).toBe(50);
    expect(startAt(BARS, at(50) + 1)!.cursor).toBe(51);
    expect(startAt(BARS, at(50) + DAY / 2)!.cursor).toBe(51);
  });
  it("keeps enough context bars before the start", () => {
    expect(startAt(BARS, at(0))!.cursor).toBe(MIN_CONTEXT);
    expect(startAt(BARS, -Infinity)!.cursor).toBe(MIN_CONTEXT);
    expect(startAt(BARS, at(5), 10)!.cursor).toBe(10);
    expect(startIndex(BARS, at(MIN_CONTEXT - 1))).toBe(MIN_CONTEXT);
  });
  it("clamps a time after the data to the last bar", () => {
    const s = startAt(BARS, at(99) + 10 * DAY)!;
    expect(s.cursor).toBe(99);
    expect(isAtEnd(s)).toBe(true);
  });
  it("refuses data without room for context, or an invalid time", () => {
    expect(canReplay(MIN_CONTEXT)).toBe(false);
    expect(canReplay(MIN_CONTEXT + 1)).toBe(true);
    expect(startAt(bars(MIN_CONTEXT), at(0))).toBeNull();
    expect(startAt([], 0)).toBeNull();
    expect(startAt(BARS, NaN)).toBeNull();
    expect(startAt(bars(MIN_CONTEXT + 1), at(0))!.cursor).toBe(MIN_CONTEXT);
  });
  it("keeps a valid speed and falls back for an invalid one", () => {
    expect(startAt(BARS, at(50), MIN_CONTEXT, 5)!.speed).toBe(5);
    expect(startAt(BARS, at(50), MIN_CONTEXT, 3 as Speed)!.speed).toBe(1);
  });
});

describe("stepping", () => {
  it("steps forward one bar and stops at the end", () => {
    expect(step(started(50)).cursor).toBe(51);
    let s = started(97);
    s = step(step(step(s)));
    expect(s.cursor).toBe(99);
    expect(isAtEnd(s)).toBe(true);
    expect(step(s).cursor).toBe(99);
  });
  it("steps back to the start and no further", () => {
    let s = step(step(started(50)));
    s = stepBack(s);
    expect(s.cursor).toBe(51);
    s = stepBack(stepBack(stepBack(s)));
    expect(s.cursor).toBe(50);
  });
  it("pauses on step back and keeps playing on step forward", () => {
    const s = play(started(50));
    expect(step(s).playing).toBe(true);
    expect(stepBack(step(s)).playing).toBe(false);
  });
  it("stops playing when a step reaches the end", () => {
    expect(step(play(started(98))).playing).toBe(false);
  });
  it("does not mutate the input state", () => {
    const s = started(50);
    const copy = { ...s };
    step(s);
    stepBack(s);
    tick(play(s), 5000);
    setSpeed(s, 10);
    expect(s).toEqual(copy);
  });
});

describe("play and pause", () => {
  it("toggles", () => {
    const s = started();
    expect(play(s).playing).toBe(true);
    expect(pause(play(s)).playing).toBe(false);
    expect(toggle(s).playing).toBe(true);
    expect(toggle(toggle(s)).playing).toBe(false);
    expect(pause(s)).toBe(s);
  });
  it("will not play at the end", () => {
    const s = startAt(BARS, at(99))!;
    expect(play(s).playing).toBe(false);
    expect(toggle(s).playing).toBe(false);
  });
});

describe("setSpeed", () => {
  it("changes speed and resets the bar timer", () => {
    const s = tick(play(started()), 400);
    expect(s.elapsed).toBe(400);
    const fast = setSpeed(s, 10);
    expect(fast.speed).toBe(10);
    expect(fast.elapsed).toBe(0);
    expect(fast.playing).toBe(true);
  });
  it("ignores unknown speeds", () => {
    const s = started();
    expect(setSpeed(s, 3 as Speed)).toBe(s);
    expect(setSpeed(s, 1)).toBe(s);
  });
});

describe("tick", () => {
  it("does nothing while paused or for bad time deltas", () => {
    const s = started();
    expect(tick(s, 5000)).toBe(s);
    const p = play(s);
    for (const dt of [0, -10, NaN, Infinity]) expect(tick(p, dt)).toBe(p);
  });
  it("reveals one bar per interval at 1x", () => {
    let s = play(started(50));
    s = tick(s, 999);
    expect(s.cursor).toBe(50);
    s = tick(s, 1);
    expect(s.cursor).toBe(51);
    expect(s.elapsed).toBe(0);
  });
  it("accumulates small deltas", () => {
    let s = play(started(50));
    for (let k = 0; k < 25; k++) s = tick(s, 40);
    expect(s.cursor).toBe(51);
    expect(s.elapsed).toBe(0);
  });
  it("scales with speed", () => {
    for (const speed of SPEEDS) {
      const s = tick(play(setSpeed(started(50), speed)), 1000);
      expect(s.cursor).toBe(50 + speed);
    }
  });
  it("carries the remainder", () => {
    const s = tick(play(setSpeed(started(50), 2)), 1250);
    expect(s.cursor).toBe(52);
    expect(s.elapsed).toBe(250);
  });
  it("stops at the last bar", () => {
    const s = tick(play(started(90)), 60_000);
    expect(s.cursor).toBe(99);
    expect(s.playing).toBe(false);
    expect(s.elapsed).toBe(0);
    expect(tick(s, 1000)).toBe(s);
  });
});

describe("revealed", () => {
  it("returns only bars up to the cursor", () => {
    const s = started(50);
    expect(revealed(BARS, s)).toEqual(BARS.slice(0, 51));
    expect(revealed(BARS, step(s))).toEqual(BARS.slice(0, 52));
  });
  it("returns a copy, so the caller cannot reach later bars through it", () => {
    const shown = revealed(BARS, started(50));
    shown.push(BARS[80]);
    expect(revealed(BARS, started(50))).toHaveLength(51);
  });
  it("never leaks future bars through any sequence of actions", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    let s = startAt(BARS, at(30))!;
    for (let k = 0; k < 2000; k++) {
      const r = rand();
      if (r < 0.25) s = step(s);
      else if (r < 0.45) s = stepBack(s);
      else if (r < 0.55) s = toggle(s);
      else if (r < 0.65) s = setSpeed(s, SPEEDS[Math.floor(rand() * SPEEDS.length)]);
      else if (r < 0.7) s = startAt(BARS, BARS[Math.floor(rand() * 100)].t + Math.floor(rand() * DAY), MIN_CONTEXT, s.speed)!;
      else s = tick(s, rand() * 3000);
      expect(s.cursor).toBeGreaterThanOrEqual(s.start);
      expect(s.start).toBeGreaterThanOrEqual(MIN_CONTEXT);
      expect(s.cursor).toBeLessThan(BARS.length);
      checkNoLeak(BARS, s);
    }
  }, 20_000);
  it("is bounded by the bar list", () => {
    const s = { ...started(50), cursor: 500 };
    expect(revealed(BARS, s)).toHaveLength(100);
    expect(revealed([], started(50))).toEqual([]);
  });
});

describe("cutoff and known", () => {
  it("is the next bar's time, or unbounded at the end", () => {
    expect(cutoff(BARS, started(50))).toBe(at(51));
    expect(cutoff(BARS, startAt(BARS, at(99))!)).toBe(Infinity);
  });
  it("keeps only items before the cutoff", () => {
    const s = started(50);
    const events = [{ t: at(10) }, { t: at(50) + 3600 }, { t: at(51) }, { t: at(80) }];
    expect(known(events, (e) => e.t, cutoff(BARS, s))).toEqual(events.slice(0, 2));
    expect(known(events, (e) => e.t, cutoff(BARS, step(s)))).toEqual(events.slice(0, 3));
  });
});

const HOUR = 3600;
const OPEN = 1_700_000_000 + 9.5 * HOUR;
const HOURLY = Array.from({ length: 30 * 7 }, (_, i) => {
  const p = 100 + Math.sin(i) * 5 + i * 0.1;
  return { t: OPEN + Math.floor(i / 7) * DAY + (i % 7) * HOUR, o: p, h: p + 1 + (i % 3), l: p - 1 - (i % 2), c: p + 0.5, v: 10 + i };
});
const merge = (list: typeof HOURLY, t: number) => list.slice(1).reduce((b, f) => ({ ...b, h: Math.max(b.h, f.h), l: Math.min(b.l, f.l), c: f.c, v: b.v + f.v }), { ...list[0], t });
const DAILY = Array.from({ length: 30 }, (_, d) => merge(HOURLY.slice(d * 7, d * 7 + 7), OPEN + d * DAY));

describe("seekTime", () => {
  it("maps the replay moment to the last bar before it", () => {
    expect(seekTime(DAILY, DAILY[10].t)).toEqual({ total: 30, start: 9, cursor: 9, playing: false, speed: 1, elapsed: 0 });
    expect(seekTime(HOURLY, DAILY[10].t, 5, true)).toEqual({ total: HOURLY.length, start: 69, cursor: 69, playing: true, speed: 5, elapsed: 0 });
  });
  it("marks a higher-timeframe bar still forming at the moment", () => {
    const s = seekTime(DAILY, HOURLY[73].t)!;
    expect(s.cursor).toBe(10);
    expect(s.forming).toBe(HOURLY[73].t);
    expect(cutoff(DAILY, s)).toBe(HOURLY[73].t);
    expect(isAtEnd(s)).toBe(false);
    expect(settled(s)).toBe(9);
  });
  it("lands at the end for an unbounded moment and refuses data that starts after it", () => {
    const end = seekTime(DAILY, Infinity, 1, true)!;
    expect(end.cursor).toBe(29);
    expect(isAtEnd(end)).toBe(true);
    expect(end.playing).toBe(false);
    expect(seekTime(DAILY, DAILY[1].t)).toBeNull();
    expect(seekTime(DAILY, DAILY[0].t)).toBeNull();
    expect(seekTime(DAILY, NaN)).toBeNull();
  });
  it("finishes the forming bar on the first step, then moves bar by bar", () => {
    const s = seekTime(DAILY, HOURLY[73].t)!;
    const done = step(s);
    expect(done.cursor).toBe(10);
    expect(done.forming).toBeUndefined();
    expect(cutoff(DAILY, done)).toBe(DAILY[11].t);
    expect(step(done).cursor).toBe(11);
    expect(tick(play(s), 1000).cursor).toBe(10);
    expect(tick(play(s), 2000).cursor).toBe(11);
  });
  it("never steps back into the forming bar's close", () => {
    const s = seekTime(DAILY, HOURLY[73].t)!;
    expect(stepBack(s).forming).toBe(s.forming);
    expect(stepBack(s).cursor).toBe(10);
    const later = { ...s, start: 5 };
    expect(stepBack(later)).toMatchObject({ cursor: 9, forming: undefined });
  });
});

describe("revealedAt", () => {
  it("shows whole bars up to an aligned moment", () => {
    expect(revealedAt(DAILY, DAILY[10].t, HOURLY)).toEqual(DAILY.slice(0, 10));
    expect(revealedAt(DAILY, Infinity)).toEqual(DAILY);
    expect(revealedAt(DAILY, DAILY[0].t)).toEqual([]);
  });
  it("builds a forming bar from the finer bars before the moment", () => {
    const shown = revealedAt(DAILY, HOURLY[73].t, HOURLY);
    expect(shown).toHaveLength(11);
    expect(shown[10]).toEqual(merge(HOURLY.slice(70, 73), DAILY[10].t));
    expect(shown[10].c).toBe(HOURLY[72].c);
    expect(shown[10].c).not.toBe(DAILY[10].c);
  });
  it("drops a forming bar it cannot build", () => {
    expect(revealedAt(DAILY, HOURLY[73].t)).toEqual(DAILY.slice(0, 10));
    expect(revealedAt(DAILY, HOURLY[73].t, HOURLY.slice(71))).toEqual(DAILY.slice(0, 10));
    expect(revealedAt(HOURLY, DAILY[10].t + 1, DAILY)).toEqual(HOURLY.slice(0, 70));
  });
  it("never leaks data from after the moment on either timeframe", () => {
    let seed = 11;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    for (let k = 0; k < 500; k++) {
      const at = OPEN + Math.floor(rand() * 31 * DAY) - DAY / 2;
      const fine = revealedAt(HOURLY, at);
      for (const f of fine) expect(f.t + HOUR).toBeLessThanOrEqual(at);
      const coarse = revealedAt(DAILY, at, fine);
      for (const bar of coarse) {
        const day = fine.filter((f) => f.t >= bar.t && f.t < bar.t + DAY);
        expect(day.length).toBeGreaterThan(0);
        expect(bar).toEqual(merge(day, bar.t));
      }
    }
  });
});

describe("chartAt", () => {
  it("cuts candles, dividends and splits at the moment and prices at the last shown bar", () => {
    const base = {
      source: "test",
      meta: { symbol: "T", name: "T", exchange: "X", currency: "USD", price: 999, prev_close: null, gmtoffset: 0 },
      range: "1mo",
      interval: "1d",
      candles: DAILY,
      dividends: [{ t: DAILY[5].t, amount: 1 }, { t: DAILY[20].t, amount: 1 }],
      splits: [{ t: HOURLY[74].t, ratio: "2:1" }],
    } as unknown as import("./types").Chart;
    const c = chartAt(base, HOURLY[73].t, HOURLY)!;
    expect(c.candles).toHaveLength(11);
    expect(c.meta.price).toBe(HOURLY[72].c);
    expect(c.last_bar_time).toBe(DAILY[10].t);
    expect(c.dividends).toHaveLength(1);
    expect(c.splits).toHaveLength(0);
    expect(chartAt(base, DAILY[0].t)).toBeNull();
  });
});

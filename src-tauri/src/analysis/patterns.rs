//! Candlestick pattern recognition (Nison's definitions, sized against ATR).
//!
//! Every pattern is reported, but a reversal only counts toward the score
//! (`context_ok`) when the trend before it agrees: bullish reversals need a
//! prior downtrend, bearish ones a prior uptrend. Hammer, hanging man,
//! inverted hammer, shooting star and doji are named by that trend, so they
//! are skipped when there is none.

use serde::Serialize;

use super::Direction;
use crate::quote::Candle;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PatternKind {
    Doji,
    Hammer,
    InvertedHammer,
    HangingMan,
    ShootingStar,
    BullishEngulfing,
    BearishEngulfing,
    BullishHarami,
    BearishHarami,
    PiercingLine,
    DarkCloudCover,
    MorningStar,
    EveningStar,
    ThreeWhiteSoldiers,
    ThreeBlackCrows,
}

impl PatternKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Doji => "Doji",
            Self::Hammer => "Hammer",
            Self::InvertedHammer => "Inverted hammer",
            Self::HangingMan => "Hanging man",
            Self::ShootingStar => "Shooting star",
            Self::BullishEngulfing => "Bullish engulfing",
            Self::BearishEngulfing => "Bearish engulfing",
            Self::BullishHarami => "Bullish harami",
            Self::BearishHarami => "Bearish harami",
            Self::PiercingLine => "Piercing line",
            Self::DarkCloudCover => "Dark cloud cover",
            Self::MorningStar => "Morning star",
            Self::EveningStar => "Evening star",
            Self::ThreeWhiteSoldiers => "Three white soldiers",
            Self::ThreeBlackCrows => "Three black crows",
        }
    }

    /// Reliability weight, 0..1, used by the pattern score.
    pub fn strength(self) -> f64 {
        match self {
            Self::Doji => 0.3,
            Self::Hammer | Self::ShootingStar => 0.6,
            Self::InvertedHammer | Self::HangingMan => 0.5,
            Self::BullishHarami | Self::BearishHarami => 0.5,
            Self::PiercingLine | Self::DarkCloudCover => 0.7,
            Self::BullishEngulfing | Self::BearishEngulfing => 0.8,
            Self::MorningStar | Self::EveningStar | Self::ThreeWhiteSoldiers | Self::ThreeBlackCrows => 1.0,
        }
    }

    fn direction(self) -> Direction {
        match self {
            Self::Doji => Direction::Neutral,
            Self::Hammer
            | Self::InvertedHammer
            | Self::BullishEngulfing
            | Self::BullishHarami
            | Self::PiercingLine
            | Self::MorningStar
            | Self::ThreeWhiteSoldiers => Direction::Bullish,
            _ => Direction::Bearish,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Trend {
    Up,
    Down,
    Flat,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Pattern {
    pub kind: PatternKind,
    pub name: &'static str,
    pub direction: Direction,
    /// Index of the first and last candle of the pattern.
    pub start: usize,
    pub end: usize,
    /// Time of the last candle.
    pub t: i64,
    /// Trend over the bars before the pattern.
    pub trend: Trend,
    /// True when the prior trend supports the reversal; only these are scored.
    pub context_ok: bool,
    pub strength: f64,
    /// Fewer than TREND_BARS bars of history before the pattern.
    pub limited: bool,
}

/// Bars of history used to judge the trend before a pattern.
pub const TREND_BARS: usize = 5;
/// The close-to-close move over TREND_BARS that counts as a trend, in ATRs.
const TREND_ATR: f64 = 0.5;
/// A "long" real body, in ATRs.
const LONG_BODY_ATR: f64 = 0.6;

struct Shape {
    o: f64,
    c: f64,
    body: f64,
    range: f64,
    upper: f64,
    lower: f64,
}

impl Shape {
    fn of(k: &Candle) -> Self {
        let top = k.o.max(k.c);
        let bottom = k.o.min(k.c);
        Self { o: k.o, c: k.c, body: top - bottom, range: k.h - k.l, upper: k.h - top, lower: bottom - k.l }
    }
    fn bull(&self) -> bool {
        self.c > self.o
    }
    fn bear(&self) -> bool {
        self.c < self.o
    }
    fn top(&self) -> f64 {
        self.o.max(self.c)
    }
    fn bottom(&self) -> f64 {
        self.o.min(self.c)
    }
    fn mid(&self) -> f64 {
        (self.o + self.c) / 2.0
    }
    /// Long lower shadow, tiny upper shadow (hammer / hanging man).
    fn hammer(&self, atr: f64) -> bool {
        self.range > 0.0
            && self.range >= 0.5 * atr
            && self.lower >= 2.0 * self.body
            && self.lower >= 0.6 * self.range
            && self.upper <= 0.15 * self.range
    }
    /// Long upper shadow, tiny lower shadow (inverted hammer / shooting star).
    fn inverted(&self, atr: f64) -> bool {
        self.range > 0.0
            && self.range >= 0.5 * atr
            && self.upper >= 2.0 * self.body
            && self.upper >= 0.6 * self.range
            && self.lower <= 0.15 * self.range
    }
    fn doji(&self, atr: f64) -> bool {
        // Same minimum size as the hammer family, so quiet bars are not dojis.
        self.range > 0.0 && self.range >= 0.5 * atr && self.body <= 0.1 * self.range
    }
}

/// Trend over the TREND_BARS closes before `start`, using what is there.
fn prior_trend(c: &[Candle], atr: &[f64], start: usize) -> (Trend, bool) {
    if start < 2 {
        return (Trend::Flat, true);
    }
    let end = start - 1;
    let from = end.saturating_sub(TREND_BARS);
    let limited = end < TREND_BARS;
    let d = c[end].c - c[from].c;
    let thr = TREND_ATR * atr[end];
    let t = if d > thr {
        Trend::Up
    } else if d < -thr {
        Trend::Down
    } else {
        Trend::Flat
    };
    (t, limited)
}

/// All patterns in the chart, ordered by their last candle. `atr` must be
/// aligned with `c`.
pub fn detect(c: &[Candle], atr: &[f64]) -> Vec<Pattern> {
    let mut out = Vec::new();
    let mut push = |kind: PatternKind, start: usize, end: usize, trend: Trend, limited: bool| {
        let direction = match kind {
            // Indecision after a trend leans against it.
            PatternKind::Doji => match trend {
                Trend::Up => Direction::Bearish,
                Trend::Down => Direction::Bullish,
                Trend::Flat => Direction::Neutral,
            },
            k => k.direction(),
        };
        let context_ok = match direction {
            Direction::Bullish => trend == Trend::Down,
            Direction::Bearish => trend == Trend::Up,
            Direction::Neutral => false,
        };
        out.push(Pattern {
            kind,
            name: kind.name(),
            direction,
            start,
            end,
            t: c[end].t,
            trend,
            context_ok,
            strength: kind.strength(),
            limited,
        });
    };

    for i in 0..c.len() {
        let a = atr[i].max(f64::EPSILON);
        let cur = Shape::of(&c[i]);

        // Three-candle patterns.
        if i >= 2 {
            let (x, y) = (Shape::of(&c[i - 2]), Shape::of(&c[i - 1]));
            let (trend, limited) = prior_trend(c, atr, i - 2);
            let long_x = x.body >= LONG_BODY_ATR * atr[i - 2];
            if x.bear() && long_x && y.body <= 0.3 * x.body && y.mid() < x.c && cur.bull() && cur.c > x.mid() {
                push(PatternKind::MorningStar, i - 2, i, trend, limited);
            }
            if x.bull() && long_x && y.body <= 0.3 * x.body && y.mid() > x.c && cur.bear() && cur.c < x.mid() {
                push(PatternKind::EveningStar, i - 2, i, trend, limited);
            }
            let soldier = |s: &Shape, j: usize| s.bull() && s.body >= 0.5 * atr[j] && s.upper <= 0.4 * s.body;
            if soldier(&x, i - 2)
                && soldier(&y, i - 1)
                && soldier(&cur, i)
                && y.c > x.c
                && cur.c > y.c
                && (x.o..=x.c).contains(&y.o)
                && (y.o..=y.c).contains(&cur.o)
            {
                push(PatternKind::ThreeWhiteSoldiers, i - 2, i, trend, limited);
            }
            let crow = |s: &Shape, j: usize| s.bear() && s.body >= 0.5 * atr[j] && s.lower <= 0.4 * s.body;
            if crow(&x, i - 2)
                && crow(&y, i - 1)
                && crow(&cur, i)
                && y.c < x.c
                && cur.c < y.c
                && (x.c..=x.o).contains(&y.o)
                && (y.c..=y.o).contains(&cur.o)
            {
                push(PatternKind::ThreeBlackCrows, i - 2, i, trend, limited);
            }
        }

        // Two-candle patterns.
        if i >= 1 {
            let p = Shape::of(&c[i - 1]);
            let (trend, limited) = prior_trend(c, atr, i - 1);
            let long_p = p.body >= LONG_BODY_ATR * atr[i - 1];
            if p.bear() && cur.bull() && cur.o <= p.c && cur.c >= p.o && cur.body > p.body {
                push(PatternKind::BullishEngulfing, i - 1, i, trend, limited);
            }
            if p.bull() && cur.bear() && cur.o >= p.c && cur.c <= p.o && cur.body > p.body {
                push(PatternKind::BearishEngulfing, i - 1, i, trend, limited);
            }
            let inside = cur.top() <= p.top() && cur.bottom() >= p.bottom() && cur.body <= 0.6 * p.body;
            if p.bear() && long_p && inside {
                push(PatternKind::BullishHarami, i - 1, i, trend, limited);
            }
            if p.bull() && long_p && inside {
                push(PatternKind::BearishHarami, i - 1, i, trend, limited);
            }
            if p.bear() && long_p && cur.bull() && cur.o < p.c && cur.c > p.mid() && cur.c < p.o {
                push(PatternKind::PiercingLine, i - 1, i, trend, limited);
            }
            if p.bull() && long_p && cur.bear() && cur.o > p.c && cur.c < p.mid() && cur.c > p.o {
                push(PatternKind::DarkCloudCover, i - 1, i, trend, limited);
            }
        }

        // Single-candle patterns, named by the prior trend.
        let (trend, limited) = prior_trend(c, atr, i);
        if trend == Trend::Flat {
            continue;
        }
        let up = trend == Trend::Up;
        if cur.hammer(a) {
            push(if up { PatternKind::HangingMan } else { PatternKind::Hammer }, i, i, trend, limited);
        } else if cur.inverted(a) {
            push(if up { PatternKind::ShootingStar } else { PatternKind::InvertedHammer }, i, i, trend, limited);
        } else if cur.doji(a) {
            push(PatternKind::Doji, i, i, trend, limited);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::indicators::{atr as atr_of, tests::candle};

    /// Six falling bars (a clear downtrend) then the pattern candles.
    fn after_down(tail: &[Candle]) -> Vec<Candle> {
        let mut v: Vec<Candle> = (0..6)
            .map(|i| {
                let o = 110.0 - 2.0 * i as f64;
                candle(o, o + 0.5, o - 2.5, o - 2.0)
            })
            .collect();
        v.extend_from_slice(tail);
        v.iter_mut().enumerate().for_each(|(i, k)| k.t = i as i64);
        v
    }

    /// Six rising bars then the pattern candles.
    fn after_up(tail: &[Candle]) -> Vec<Candle> {
        let mut v: Vec<Candle> = (0..6)
            .map(|i| {
                let o = 90.0 + 2.0 * i as f64;
                candle(o, o + 2.5, o - 0.5, o + 2.0)
            })
            .collect();
        v.extend_from_slice(tail);
        v.iter_mut().enumerate().for_each(|(i, k)| k.t = i as i64);
        v
    }

    fn kinds_at_end(c: &[Candle]) -> Vec<(PatternKind, bool)> {
        let a = atr_of(c, 14);
        let last = c.len() - 1;
        detect(c, &a).into_iter().filter(|p| p.end == last).map(|p| (p.kind, p.context_ok)).collect()
    }

    fn has(c: &[Candle], k: PatternKind) -> bool {
        kinds_at_end(c).iter().any(|(x, ok)| *x == k && *ok)
    }

    #[test]
    fn hammer_and_hanging_man() {
        let shape = candle(97.0, 97.3, 92.0, 97.2);
        assert!(has(&after_down(&[shape]), PatternKind::Hammer));
        let shape = candle(102.0, 102.3, 97.0, 102.2);
        assert!(has(&after_up(&[shape]), PatternKind::HangingMan));
    }

    #[test]
    fn inverted_hammer_and_shooting_star() {
        assert!(has(&after_down(&[candle(97.0, 102.0, 96.9, 97.2)]), PatternKind::InvertedHammer));
        assert!(has(&after_up(&[candle(102.0, 107.0, 101.7, 101.8)]), PatternKind::ShootingStar));
    }

    #[test]
    fn doji_leans_against_the_trend() {
        let c = after_up(&[candle(102.0, 103.5, 100.5, 102.05)]);
        let a = atr_of(&c, 14);
        let p = detect(&c, &a).into_iter().find(|p| p.kind == PatternKind::Doji).unwrap();
        assert_eq!(p.direction, Direction::Bearish);
        assert!(p.context_ok);
    }

    #[test]
    fn engulfing() {
        let c = after_down(&[candle(98.0, 98.5, 95.5, 96.0), candle(95.5, 99.5, 95.0, 99.0)]);
        assert!(has(&c, PatternKind::BullishEngulfing));
        let c = after_up(&[candle(102.0, 104.5, 101.5, 104.0), candle(104.5, 105.0, 100.5, 101.0)]);
        assert!(has(&c, PatternKind::BearishEngulfing));
    }

    #[test]
    fn harami() {
        let c = after_down(&[candle(99.0, 99.5, 93.5, 94.0), candle(95.0, 96.5, 94.5, 96.0)]);
        assert!(has(&c, PatternKind::BullishHarami));
        let c = after_up(&[candle(101.0, 106.5, 100.5, 106.0), candle(105.0, 105.5, 103.5, 104.0)]);
        assert!(has(&c, PatternKind::BearishHarami));
    }

    #[test]
    fn piercing_line_and_dark_cloud() {
        let c = after_down(&[candle(99.0, 99.5, 94.0, 94.5), candle(94.0, 98.0, 93.5, 97.5)]);
        assert!(has(&c, PatternKind::PiercingLine));
        let c = after_up(&[candle(101.0, 106.5, 100.5, 106.0), candle(106.5, 107.0, 102.5, 103.0)]);
        assert!(has(&c, PatternKind::DarkCloudCover));
    }

    #[test]
    fn morning_and_evening_star() {
        let c = after_down(&[
            candle(99.0, 99.5, 93.5, 94.0),
            candle(93.0, 93.8, 92.2, 93.2),
            candle(93.5, 98.5, 93.3, 98.0),
        ]);
        assert!(has(&c, PatternKind::MorningStar));
        let c = after_up(&[
            candle(101.0, 106.5, 100.5, 106.0),
            candle(107.0, 107.8, 106.2, 106.8),
            candle(106.5, 106.7, 101.5, 102.0),
        ]);
        assert!(has(&c, PatternKind::EveningStar));
    }

    #[test]
    fn three_soldiers_and_crows() {
        let c = after_down(&[
            candle(98.0, 101.2, 97.8, 101.0),
            candle(100.0, 103.2, 99.8, 103.0),
            candle(102.0, 105.2, 101.8, 105.0),
        ]);
        assert!(has(&c, PatternKind::ThreeWhiteSoldiers));
        let c = after_up(&[
            candle(102.0, 102.2, 98.8, 99.0),
            candle(100.0, 100.2, 96.8, 97.0),
            candle(98.0, 98.2, 94.8, 95.0),
        ]);
        assert!(has(&c, PatternKind::ThreeBlackCrows));
    }

    #[test]
    fn reversal_without_matching_trend_is_not_scored() {
        // Bullish engulfing after a rally: reported, but context_ok is false.
        let c = after_up(&[candle(102.0, 102.5, 100.5, 101.0), candle(100.8, 104.5, 100.5, 104.0)]);
        let found = kinds_at_end(&c);
        assert!(found.contains(&(PatternKind::BullishEngulfing, false)), "{found:?}");
    }

    #[test]
    fn single_candle_names_need_a_trend() {
        let flat: Vec<Candle> = (0..8).map(|i| Candle { t: i, ..candle(100.0, 100.3, 99.0, 100.2) }).collect();
        let a = atr_of(&flat, 14);
        assert!(detect(&flat, &a).iter().all(|p| p.kind != PatternKind::Hammer));
    }
}

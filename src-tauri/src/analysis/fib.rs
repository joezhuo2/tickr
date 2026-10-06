//! Fibonacci levels from the last major swing.
//!
//! The swing runs between the highest pivot high and the lowest pivot low
//! (PIVOT_BARS on each side) in the last LOOKBACK bars. The newest PIVOT_BARS
//! bars cannot be confirmed as pivots yet, so they are candidates too; that
//! keeps a fresh breakout from being measured against an old extreme. Without
//! any pivot, the window's absolute extremes are used and the swing is
//! flagged as unconfirmed.

use serde::Serialize;

use super::indicators::{pivot_highs, pivot_lows};
use crate::quote::Candle;

pub const PIVOT_BARS: usize = 5;
pub const LOOKBACK: usize = 120;

const RETRACEMENTS: [f64; 7] = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
/// Past the end of the swing, measured from its start.
const EXTENSIONS: [f64; 3] = [1.272, 1.618, 2.618];
/// Past the start of the swing (a full retracement and beyond).
const DEEP: [f64; 2] = [1.272, 1.618];

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Point {
    pub i: usize,
    pub t: i64,
    pub price: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Swing {
    /// Start and end of the swing, in time order.
    pub from: Point,
    pub to: Point,
    /// True for a move up (low to high).
    pub up: bool,
    /// Both ends are confirmed pivots.
    pub confirmed: bool,
    pub levels: Vec<Level>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LevelKind {
    Retracement,
    Extension,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Level {
    pub ratio: f64,
    pub price: f64,
    pub kind: LevelKind,
    /// "61.8%".
    pub label: String,
}

fn pct(r: f64) -> String {
    let s = format!("{:.1}", r * 100.0);
    format!("{}%", s.strip_suffix(".0").unwrap_or(&s))
}

/// Index of the best candidate by `better`, latest one on ties.
fn pick(cands: &[usize], val: impl Fn(usize) -> f64, better: impl Fn(f64, f64) -> bool) -> Option<usize> {
    cands.iter().copied().reduce(|a, b| if better(val(a), val(b)) { a } else { b })
}

pub fn swing(c: &[Candle]) -> Option<Swing> {
    if c.len() < 2 {
        return None;
    }
    let start = c.len().saturating_sub(LOOKBACK);
    let fresh = c.len().saturating_sub(PIVOT_BARS).max(start)..c.len();
    let collect = |piv: Vec<usize>| -> (Vec<usize>, bool) {
        let mut v: Vec<usize> = piv.into_iter().filter(|&i| i >= start).collect();
        let found = !v.is_empty();
        if found {
            v.extend(fresh.clone());
        } else {
            v.extend(start..c.len());
        }
        (v, found)
    };
    let (highs, hi_ok) = collect(pivot_highs(c, PIVOT_BARS));
    let (lows, lo_ok) = collect(pivot_lows(c, PIVOT_BARS));
    let hi = pick(&highs, |i| c[i].h, |a, b| a > b)?;
    let lo = pick(&lows, |i| c[i].l, |a, b| a < b)?;
    if hi == lo || c[hi].h <= c[lo].l {
        return None;
    }
    let point = |i: usize, price: f64| Point { i, t: c[i].t, price };
    let up = lo < hi;
    let (from, to) = if up { (point(lo, c[lo].l), point(hi, c[hi].h)) } else { (point(hi, c[hi].h), point(lo, c[lo].l)) };
    Some(Swing { from, to, up, confirmed: hi_ok && lo_ok, levels: levels(from.price, to.price) })
}

/// Levels for a move from `a` to `b`, sorted by price.
pub fn levels(a: f64, b: f64) -> Vec<Level> {
    let m = b - a;
    let mut out: Vec<Level> = RETRACEMENTS
        .iter()
        .chain(DEEP.iter())
        .map(|&r| Level { ratio: r, price: b - m * r, kind: LevelKind::Retracement, label: pct(r) })
        .chain(
            EXTENSIONS
                .iter()
                .map(|&e| Level { ratio: e, price: a + m * e, kind: LevelKind::Extension, label: pct(e) }),
        )
        .collect();
    out.sort_by(|x, y| x.price.total_cmp(&y.price));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::indicators::tests::candle;

    fn series(closes: &[f64]) -> Vec<Candle> {
        closes
            .iter()
            .enumerate()
            .map(|(i, &x)| Candle { t: i as i64, ..candle(x, x + 0.5, x - 0.5, x) })
            .collect()
    }

    #[test]
    fn labels() {
        assert_eq!(pct(0.618), "61.8%");
        assert_eq!(pct(0.5), "50%");
        assert_eq!(pct(1.272), "127.2%");
    }

    #[test]
    fn levels_for_an_up_move() {
        let l = levels(100.0, 200.0);
        let find = |label: &str, kind| l.iter().find(|x| x.label == label && x.kind == kind).unwrap().price;
        assert!((find("61.8%", LevelKind::Retracement) - 138.2).abs() < 1e-9);
        assert!((find("0%", LevelKind::Retracement) - 200.0).abs() < 1e-9);
        assert!((find("100%", LevelKind::Retracement) - 100.0).abs() < 1e-9);
        assert!((find("161.8%", LevelKind::Extension) - 261.8).abs() < 1e-9);
        assert!((find("127.2%", LevelKind::Retracement) - 72.8).abs() < 1e-9);
        assert!(l.windows(2).all(|w| w[0].price <= w[1].price));
    }

    #[test]
    fn finds_confirmed_up_swing() {
        // Low at 5, high at 20, then a pullback long enough to confirm both.
        let mut closes: Vec<f64> = (0..=5).map(|i| 110.0 - 2.0 * i as f64).collect();
        closes.extend((1..=15).map(|i| 100.0 + 3.0 * i as f64));
        closes.extend((1..=7).map(|i| 145.0 - 2.0 * i as f64));
        let s = swing(&series(&closes)).unwrap();
        assert!(s.up);
        assert!(s.confirmed);
        assert_eq!(s.from.i, 5);
        assert_eq!(s.to.i, 20);
        assert_eq!(s.from.price, 99.5);
        assert_eq!(s.to.price, 145.5);
    }

    #[test]
    fn short_chart_uses_extremes_unconfirmed() {
        let s = swing(&series(&[10.0, 12.0, 11.0, 9.0])).unwrap();
        assert!(!s.confirmed);
        assert!(!s.up);
        assert_eq!(s.from.i, 1);
        assert_eq!(s.to.i, 3);
    }

    #[test]
    fn fresh_breakout_beats_old_pivot() {
        let mut closes: Vec<f64> = (0..12).map(|i| if i == 5 { 120.0 } else { 100.0 }).collect();
        closes.extend([105.0, 115.0, 130.0]);
        let s = swing(&series(&closes)).unwrap();
        assert_eq!(s.to.price, 130.5);
    }
}

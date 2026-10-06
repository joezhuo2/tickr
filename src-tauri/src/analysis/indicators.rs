//! Indicator math, matching TradingView's conventions:
//! - EMA and RMA (Wilder) are seeded with the SMA of the first `n` values.
//! - RSI is RMA-smoothed gains over losses.
//! - ATR is the RMA of true range; the first bar's true range is high - low.
//!
//! Every series is aligned with its input. Before a full window exists the
//! value comes from an expanding window over the bars so far (lenient
//! warm-up), so short charts still get a value. Callers flag those values as
//! limited using each indicator's `needed` bar count.

use crate::quote::Candle;

/// Simple moving average; the mean of all bars so far before `n` bars exist.
pub fn sma(src: &[f64], n: usize) -> Vec<f64> {
    let n = n.max(1);
    let mut out = Vec::with_capacity(src.len());
    let mut sum = 0.0;
    for (i, &x) in src.iter().enumerate() {
        sum += x;
        if i >= n {
            sum -= src[i - n];
        }
        out.push(sum / (i + 1).min(n) as f64);
    }
    out
}

/// Exponential smoothing with `alpha`, seeded with the SMA of the first `n`
/// values (expanding mean before that).
fn smoothed(src: &[f64], n: usize, alpha: f64) -> Vec<f64> {
    let n = n.max(1);
    let mut out = Vec::with_capacity(src.len());
    let mut sum = 0.0;
    let mut prev = 0.0;
    for (i, &x) in src.iter().enumerate() {
        if i < n {
            sum += x;
            prev = sum / (i + 1) as f64;
        } else {
            prev = alpha * x + (1.0 - alpha) * prev;
        }
        out.push(prev);
    }
    out
}

/// Exponential moving average, alpha = 2 / (n + 1).
pub fn ema(src: &[f64], n: usize) -> Vec<f64> {
    smoothed(src, n, 2.0 / (n.max(1) as f64 + 1.0))
}

/// Wilder's moving average (RMA), alpha = 1 / n.
pub fn rma(src: &[f64], n: usize) -> Vec<f64> {
    smoothed(src, n, 1.0 / n.max(1) as f64)
}

/// Relative strength index. The first bar has no change, so it is None.
/// A flat stretch (no gains and no losses) reads 50.
pub fn rsi(closes: &[f64], n: usize) -> Vec<Option<f64>> {
    if closes.is_empty() {
        return vec![];
    }
    let changes: Vec<f64> = closes.windows(2).map(|w| w[1] - w[0]).collect();
    let gains: Vec<f64> = changes.iter().map(|d| d.max(0.0)).collect();
    let losses: Vec<f64> = changes.iter().map(|d| (-d).max(0.0)).collect();
    let up = rma(&gains, n);
    let down = rma(&losses, n);
    let mut out = Vec::with_capacity(closes.len());
    out.push(None);
    for (u, d) in up.iter().zip(&down) {
        let (u, d) = (*u, *d);
        let v = if d == 0.0 {
            if u == 0.0 {
                50.0
            } else {
                100.0
            }
        } else if u == 0.0 {
            0.0
        } else {
            100.0 - 100.0 / (1.0 + u / d)
        };
        out.push(Some(v));
    }
    out
}

/// True range; the first bar has no previous close and uses high - low.
pub fn true_range(c: &[Candle]) -> Vec<f64> {
    c.iter()
        .enumerate()
        .map(|(i, k)| {
            let hl = k.h - k.l;
            match i.checked_sub(1).map(|j| c[j].c) {
                Some(pc) => hl.max((k.h - pc).abs()).max((k.l - pc).abs()),
                None => hl,
            }
        })
        .collect()
}

/// Average true range (RMA of true range).
pub fn atr(c: &[Candle], n: usize) -> Vec<f64> {
    rma(&true_range(c), n)
}

/// Sample standard deviation of the last `n` log returns (fewer if the chart
/// is shorter). None with fewer than two returns.
pub fn stdev_returns(closes: &[f64], n: usize) -> Option<f64> {
    let rets: Vec<f64> = closes
        .windows(2)
        .filter(|w| w[0] > 0.0 && w[1] > 0.0)
        .map(|w| (w[1] / w[0]).ln())
        .collect();
    let tail = &rets[rets.len().saturating_sub(n)..];
    if tail.len() < 2 {
        return None;
    }
    let mean = tail.iter().sum::<f64>() / tail.len() as f64;
    let var = tail.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / (tail.len() - 1) as f64;
    Some(var.sqrt())
}

/// Indexes of pivot highs: the high is >= the `k` bars before it and > the
/// `k` bars after it (so a flat top marks its last bar).
pub fn pivot_highs(c: &[Candle], k: usize) -> Vec<usize> {
    pivots(c, k, |a, b| a >= b, |a, b| a > b, |x| x.h)
}

/// Indexes of pivot lows, the mirror of `pivot_highs`.
pub fn pivot_lows(c: &[Candle], k: usize) -> Vec<usize> {
    pivots(c, k, |a, b| a <= b, |a, b| a < b, |x| x.l)
}

fn pivots(
    c: &[Candle],
    k: usize,
    left_ok: impl Fn(f64, f64) -> bool,
    right_ok: impl Fn(f64, f64) -> bool,
    val: impl Fn(&Candle) -> f64,
) -> Vec<usize> {
    if c.len() < 2 * k + 1 {
        return vec![];
    }
    (k..c.len() - k)
        .filter(|&i| {
            let v = val(&c[i]);
            (i - k..i).all(|j| left_ok(v, val(&c[j]))) && (i + 1..=i + k).all(|j| right_ok(v, val(&c[j])))
        })
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn candle(o: f64, h: f64, l: f64, c: f64) -> Candle {
        Candle { t: 0, o, h, l, c, v: 0.0 }
    }

    fn close_enough(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol
    }

    #[test]
    fn sma_rolls_and_expands_during_warmup() {
        let s = sma(&[1.0, 2.0, 3.0, 4.0, 5.0], 3);
        assert_eq!(s, vec![1.0, 1.5, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn ema_is_seeded_with_sma() {
        let src = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let e = ema(&src, 3);
        assert_eq!(e[2], 2.0);
        // alpha = 0.5
        assert_eq!(e[3], 0.5 * 4.0 + 0.5 * 2.0);
        assert_eq!(e[4], 0.5 * 5.0 + 0.5 * e[3]);
    }

    #[test]
    fn rma_is_wilder_smoothing() {
        let src = [2.0, 4.0, 6.0, 8.0];
        let r = rma(&src, 2);
        assert_eq!(r[1], 3.0);
        assert_eq!(r[2], 0.5 * 6.0 + 0.5 * 3.0);
    }

    /// Wilder RSI-14 reference data (the widely published StockCharts example).
    #[test]
    fn rsi_matches_reference() {
        let closes = [
            44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931,
            46.0328, 45.6140, 46.2820, 46.2820, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122,
        ];
        let r = rsi(&closes, 14);
        assert_eq!(r[0], None);
        let expect = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93];
        for (k, want) in expect.iter().enumerate() {
            let got = r[14 + k].unwrap();
            assert!(close_enough(got, *want, 0.01), "rsi[{}] = {got}, want {want}", 14 + k);
        }
    }

    #[test]
    fn rsi_extremes() {
        let up: Vec<f64> = (0..20).map(|i| i as f64).collect();
        assert_eq!(rsi(&up, 14).last().unwrap().unwrap(), 100.0);
        let down: Vec<f64> = (0..20).rev().map(|i| i as f64).collect();
        assert_eq!(rsi(&down, 14).last().unwrap().unwrap(), 0.0);
        assert_eq!(rsi(&[5.0; 5], 14).last().unwrap().unwrap(), 50.0);
    }

    #[test]
    fn true_range_uses_previous_close() {
        let c = [candle(10.0, 11.0, 9.0, 10.0), candle(13.0, 14.0, 12.5, 13.0)];
        assert_eq!(true_range(&c), vec![2.0, 4.0]);
        let a = atr(&c, 14);
        assert_eq!(a[1], 3.0);
    }

    #[test]
    fn stdev_of_returns() {
        assert_eq!(stdev_returns(&[1.0, 2.0], 20), None);
        let s = stdev_returns(&[100.0, 101.0, 100.0, 101.0, 100.0], 20).unwrap();
        assert!(s > 0.009 && s < 0.012, "{s}");
        assert!(stdev_returns(&[5.0; 10], 20).unwrap().abs() < 1e-12);
    }

    #[test]
    fn pivots_need_k_bars_each_side() {
        let highs = [1.0, 2.0, 5.0, 2.0, 1.0, 3.0, 1.0];
        let c: Vec<Candle> = highs.iter().map(|&h| candle(h - 0.5, h, h - 1.0, h - 0.5)).collect();
        assert_eq!(pivot_highs(&c, 2), vec![2]);
        assert_eq!(pivot_highs(&c, 1), vec![2, 5]);
        assert!(pivot_highs(&c[..4], 2).is_empty());
        assert_eq!(pivot_lows(&c, 1), vec![4]);
    }
}

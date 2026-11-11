//! Local, deterministic technical analysis of the candles in a chart.
//!
//! Nothing here touches the network or a clock: the same candles always give
//! the same result. The engine computes RSI, moving averages, ATR and return
//! volatility, candlestick patterns and a Fibonacci swing, then folds them
//! into a composite score from -100 (strong bearish) to +100 (strong bullish)
//! with volatility-based targets snapped to nearby Fibonacci levels.
//!
//! Short charts are analyzed anyway (lenient warm-up, see `indicators`), but
//! anything computed from fewer bars than it needs is flagged `limited` and
//! confidence is scaled down.

pub mod fib;
pub mod indicators;
pub mod patterns;

use serde::{Deserialize, Serialize};

use crate::quote::{Candle, Chart};
use fib::Swing;
use patterns::Pattern;

// Indicator settings (TradingView defaults).
pub const RSI_LEN: usize = 14;
pub const ATR_LEN: usize = 14;
pub const STDEV_LEN: usize = 20;
pub const BB_LEN: usize = 20;
pub const RVOL_LEN: usize = 20;
pub const BB_K: f64 = 2.0;
pub const SMA_LENS: [usize; 3] = [20, 50, 200];
pub const EMA_LENS: [usize; 2] = [9, 21];

/// Bars needed for every indicator to be fully warmed up (SMA 200).
pub const FULL_WARMUP: usize = 200;
/// Fewest candles worth analyzing.
pub const MIN_BARS: usize = 3;
/// Projection horizon, in bars of the chart's interval.
pub const HORIZON: usize = 10;

// Score weights; they sum to 1.
pub const W_TREND: f64 = 0.35;
pub const W_MOMENTUM: f64 = 0.25;
pub const W_CROSSES: f64 = 0.15;
pub const W_PATTERNS: f64 = 0.25;

/// Bars over which moving-average slopes are measured.
const SLOPE_BARS: usize = 5;
/// RSI divergence: pivots within this many bars, the newest this recent.
const DIV_LOOKBACK: usize = 60;
const DIV_RECENT: usize = 15;
/// A pattern's weight halves every this many bars.
const PATTERN_HALF_LIFE: f64 = 3.0;
/// Targets move to a Fibonacci level this close, in ATRs.
const SNAP_ATR: f64 = 0.5;
/// Invalidation distance from the close, in ATRs.
const STOP_ATR: f64 = 1.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Bullish,
    Bearish,
    Neutral,
}

impl Direction {
    fn sign(self) -> f64 {
        match self {
            Self::Bullish => 1.0,
            Self::Bearish => -1.0,
            Self::Neutral => 0.0,
        }
    }

    /// Bullish above `dead`, bearish below `-dead`.
    fn of(v: f64, dead: f64) -> Self {
        if v > dead {
            Self::Bullish
        } else if v < -dead {
            Self::Bearish
        } else {
            Self::Neutral
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Bias {
    StrongBearish,
    Bearish,
    Neutral,
    Bullish,
    StrongBullish,
}

impl Bias {
    pub fn from_score(score: i32) -> Self {
        match score {
            s if s >= 50 => Self::StrongBullish,
            s if s >= 15 => Self::Bullish,
            s if s <= -50 => Self::StrongBearish,
            s if s <= -15 => Self::Bearish,
            _ => Self::Neutral,
        }
    }

    fn direction(self) -> Direction {
        match self {
            Self::StrongBullish | Self::Bullish => Direction::Bullish,
            Self::StrongBearish | Self::Bearish => Direction::Bearish,
            Self::Neutral => Direction::Neutral,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Low,
    Medium,
    High,
}

/// One indicator line, aligned with the chart's candles.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Line {
    pub key: &'static str,
    pub label: String,
    pub color: String,
    pub visible: bool,
    pub period: usize,
    pub values: Vec<Option<f64>>,
    /// First index with a full window; earlier values are warm-up estimates.
    pub full_from: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Series {
    /// Candle times, to line the series up with a refreshed chart.
    pub t: Vec<i64>,
    pub mas: Vec<Line>,
    pub rsi: Line,
    pub macd: Vec<Line>,
    pub bollinger: Vec<Line>,
    pub vwap: Line,
    pub opening_range: Vec<Line>,
    /// Prior-day high and low, then premarket high and low.
    pub levels: Vec<Line>,
    pub volume_ma: Line,
}

/// An indicator's latest value.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Reading {
    pub key: &'static str,
    pub label: String,
    pub value: Option<f64>,
    /// Bars needed for a full warm-up.
    pub needed: usize,
    pub limited: bool,
}

/// One part of the composite score; `value` is -1..1.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Component {
    pub key: &'static str,
    pub label: &'static str,
    pub weight: f64,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Signal {
    pub label: String,
    pub direction: Direction,
    pub limited: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Target {
    pub price: f64,
    /// Before snapping to a Fibonacci level.
    pub raw: f64,
    /// The level it snapped to, e.g. "61.8% retracement".
    pub fib: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Targets {
    pub horizon: usize,
    /// ATR × √horizon, the move the targets are built from.
    pub atr_move: f64,
    /// One standard deviation of return over the horizon, in price.
    pub sigma_move: Option<f64>,
    pub upside: Target,
    pub downside: Target,
    /// Where the bias is wrong; None when neutral.
    pub invalidation: Option<Target>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Analysis {
    pub symbol: String,
    pub range: String,
    pub interval: String,
    pub currency: String,
    /// Time of the last candle analyzed.
    pub as_of: i64,
    pub bars: usize,
    /// Fewer bars than FULL_WARMUP: some values are estimates.
    pub limited: bool,
    pub full_warmup: usize,
    pub close: f64,
    pub score: i32,
    pub bias: Bias,
    /// 0..100.
    pub confidence: u8,
    pub confidence_label: Confidence,
    pub components: Vec<Component>,
    pub signals: Vec<Signal>,
    pub readings: Vec<Reading>,
    pub targets: Targets,
    pub fib: Option<Swing>,
    pub patterns: Vec<Pattern>,
    pub series: Series,
}

struct Ma {
    key: &'static str,
    label: String,
    period: usize,
    values: Vec<f64>,
}

fn mas(closes: &[f64]) -> Vec<Ma> {
    let sma = SMA_LENS.iter().zip(["sma20", "sma50", "sma200"]).map(|(&p, key)| Ma {
        key,
        label: format!("SMA {p}"),
        period: p,
        values: indicators::sma(closes, p),
    });
    let ema = EMA_LENS.iter().zip(["ema9", "ema21"]).map(|(&p, key)| Ma {
        key,
        label: format!("EMA {p}"),
        period: p,
        values: indicators::ema(closes, p),
    });
    sma.chain(ema).collect()
}

fn sign(v: f64) -> i8 {
    if v > 0.0 {
        1
    } else if v < 0.0 {
        -1
    } else {
        0
    }
}

/// Current side of `fast` against `slow`, and the index of the last cross.
/// Stretches where they are equal (identical warm-up) are not crosses.
fn cross(fast: &[f64], slow: &[f64]) -> (i8, Option<usize>) {
    let mut prev = 0;
    let mut at = None;
    for (i, (f, s)) in fast.iter().zip(slow).enumerate() {
        let now = sign(f - s);
        if now != 0 {
            if prev != 0 && now != prev {
                at = Some(i);
            }
            prev = now;
        }
    }
    let last = fast.len().checked_sub(1).map(|i| sign(fast[i] - slow[i])).unwrap_or(0);
    (last, at)
}

/// The most recent RSI divergence between the last two pivots, if it is fresh.
fn divergence(c: &[Candle], rsi: &[Option<f64>]) -> Option<(Direction, usize)> {
    let n = c.len();
    let from = n.saturating_sub(DIV_LOOKBACK);
    let recent = n.saturating_sub(DIV_RECENT + 1);
    let check = |piv: Vec<usize>, bearish: bool| -> Option<usize> {
        let p: Vec<usize> = piv.into_iter().filter(|&i| i >= from && rsi[i].is_some()).collect();
        let (&b, rest) = p.split_last()?;
        let &a = rest.last()?;
        if b < recent {
            return None;
        }
        let (ra, rb) = (rsi[a]?, rsi[b]?);
        let hit = if bearish { c[b].h > c[a].h && rb < ra } else { c[b].l < c[a].l && rb > ra };
        hit.then_some(b)
    };
    let bear = check(indicators::pivot_highs(c, fib::PIVOT_BARS), true);
    let bull = check(indicators::pivot_lows(c, fib::PIVOT_BARS), false);
    match (bear, bull) {
        (Some(a), Some(b)) if b > a => Some((Direction::Bullish, b)),
        (Some(a), _) => Some((Direction::Bearish, a)),
        (None, Some(b)) => Some((Direction::Bullish, b)),
        (None, None) => None,
    }
}

fn ago(bars: usize) -> String {
    match bars {
        0 => "last bar".into(),
        1 => "1 bar ago".into(),
        n => format!("{n} bars ago"),
    }
}

/// `raw` moved to the nearest Fibonacci level within SNAP_ATR, on the given
/// side of the close.
fn snap(raw: f64, above: bool, close: f64, atr: f64, swing: Option<&Swing>) -> Target {
    let best = swing.and_then(|s| {
        s.levels
            .iter()
            .filter(|l| if above { l.price > close } else { l.price < close })
            .filter(|l| (l.price - raw).abs() <= SNAP_ATR * atr)
            .min_by(|a, b| (a.price - raw).abs().total_cmp(&(b.price - raw).abs()))
    });
    match best {
        Some(l) => {
            let kind = match l.kind {
                fib::LevelKind::Retracement => "retracement",
                fib::LevelKind::Extension => "extension",
            };
            Target { price: l.price, raw, fib: Some(format!("{} {kind}", l.label)) }
        }
        None => Target { price: raw, raw, fib: None },
    }
}

pub fn reveal_until(chart: &Chart, until: i64) -> Chart {
    Chart {
        candles: chart.candles.iter().filter(|k| k.t <= until).cloned().collect(),
        dividends: chart.dividends.iter().filter(|d| d.t <= until).cloned().collect(),
        splits: chart.splits.iter().filter(|s| s.t <= until).cloned().collect(),
        last_bar_time: chart.candles.iter().map(|k| k.t).filter(|&t| t <= until).max(),
        ..chart.clone()
    }
}

/// The chart's day number when it is intraday and covers a single day, which
/// leaves no earlier session to read the prior-day levels from.
pub fn single_day(chart: &Chart) -> Option<i64> {
    let intraday = chart.interval.ends_with('m') && !chart.interval.ends_with("mo");
    let day = |k: &crate::quote::Candle| (k.t + chart.meta.gmtoffset).div_euclid(86_400);
    let (first, last) = (chart.candles.first()?, chart.candles.last()?);
    (intraday && day(first) == day(last)).then(|| day(first))
}

/// Sets the prior-day high and low from the last daily candle before `day`.
pub fn fill_prior_day(analysis: &mut Analysis, daily: &Chart, day: i64) {
    let Some(k) = daily.candles.iter().rev().find(|k| (k.t + daily.meta.gmtoffset).div_euclid(86_400) < day) else { return };
    for (line, level) in analysis.series.levels.iter_mut().zip([k.h, k.l]) {
        line.values.iter_mut().for_each(|v| *v = Some(level));
    }
}

#[cfg(test)]
pub fn analyze(chart: &Chart) -> Result<Analysis, String> {
    analyze_with_config(chart, &crate::settings::IndicatorConfig::default())
}

pub fn analyze_with_config(chart: &Chart, config: &crate::settings::IndicatorConfig) -> Result<Analysis, String> {
    crate::settings::validate_indicators(config, &[])?;
    let c = &chart.candles;
    let n = c.len();
    if n < MIN_BARS {
        return Err(format!("Need at least {MIN_BARS} candles to analyze; this chart has {n}."));
    }
    let last = n - 1;
    let closes: Vec<f64> = c.iter().map(|k| k.c).collect();
    let close = closes[last];
    let atr_s = indicators::atr(c, ATR_LEN);
    // Guard divisions on a perfectly flat chart.
    let atr = atr_s[last].max(close.abs() * 1e-9).max(f64::MIN_POSITIVE);
    let rsi_s = indicators::rsi(&closes, RSI_LEN);
    let sigma = indicators::stdev_returns(&closes, STDEV_LEN);
    let mas = mas(&closes);
    let (_, bb_up, bb_lo) = indicators::bollinger(&closes, BB_LEN, BB_K);
    let intraday = chart.interval.ends_with('m') && !chart.interval.ends_with("mo");
    let gmt = chart.meta.gmtoffset;
    let vwap_s = indicators::vwap(c, |t| if intraday { (t + gmt).div_euclid(86_400) } else { 0 });
    let vwap_label = if intraday { "VWAP" } else { "VWAP (anchored)" };
    let pats = patterns::detect(c, &atr_s);
    let swing = fib::swing(c);
    let mut signals = Vec::new();

    // Trend: where price sits against each average, and how they slope.
    let pos = mas.iter().map(|m| ((close - m.values[last]) / atr).tanh()).sum::<f64>() / mas.len() as f64;
    for m in &mas {
        let above = close > m.values[last];
        signals.push(Signal {
            label: format!("Price {} {}", if above { "above" } else { "below" }, m.label),
            direction: if above { Direction::Bullish } else { Direction::Bearish },
            limited: n < m.period,
        });
    }
    let back = last.saturating_sub(SLOPE_BARS);
    let mut slopes = 0.0;
    for key in ["sma20", "sma50"] {
        let m = mas.iter().find(|m| m.key == key).expect("known MA");
        let s = ((m.values[last] - m.values[back]) / atr).tanh();
        slopes += s / 2.0;
        let d = Direction::of(s, 0.1);
        let word = match d {
            Direction::Bullish => "rising",
            Direction::Bearish => "falling",
            Direction::Neutral => "flat",
        };
        signals.push(Signal { label: format!("{} {word}", m.label), direction: d, limited: n < m.period });
    }
    let trend = 0.6 * pos + 0.4 * slopes;

    // Momentum: RSI level (overbought/oversold fade) plus divergence.
    let rsi = rsi_s[last].unwrap_or(50.0);
    let mut level = ((rsi - 50.0) / 20.0).clamp(-1.0, 1.0);
    if rsi > 70.0 {
        level -= (rsi - 70.0) / 10.0;
    } else if rsi < 30.0 {
        level += (30.0 - rsi) / 10.0;
    }
    let level = level.clamp(-1.0, 1.0);
    let zone = match rsi {
        r if r > 70.0 => ", overbought",
        r if r < 30.0 => ", oversold",
        _ => "",
    };
    let rsi_limited = n <= RSI_LEN;
    signals.push(Signal {
        label: format!("RSI {rsi:.1}{zone}"),
        direction: Direction::of(level, 0.15),
        limited: rsi_limited,
    });
    let div = divergence(c, &rsi_s);
    if let Some((d, i)) = div {
        let kind = if d == Direction::Bullish { "Bullish" } else { "Bearish" };
        signals.push(Signal { label: format!("{kind} RSI divergence, {}", ago(last - i)), direction: d, limited: rsi_limited });
    }
    let momentum = (level + 0.5 * div.map_or(0.0, |(d, _)| d.sign())).clamp(-1.0, 1.0);

    // Crosses: SMA 50/200 (golden/death) and EMA 9/21.
    let mut crosses = 0.0;
    for (fast, slow, up_name, down_name, period) in [
        ("sma50", "sma200", "Golden cross", "Death cross", 200),
        ("ema9", "ema21", "Bullish EMA cross", "Bearish EMA cross", 21),
    ] {
        let (fm, sm) = (mas.iter().find(|m| m.key == fast).unwrap(), mas.iter().find(|m| m.key == slow).unwrap());
        let (state, at) = cross(&fm.values, &sm.values);
        let age = at.map(|i| last - i);
        let fresh = age.is_some_and(|a| a <= HORIZON);
        crosses += 0.5 * f64::from(state) * if fresh { 1.0 } else { 0.6 };
        let limited = n < period;
        let label = match (state, fresh) {
            (0, _) => format!("{} and {} not separated yet", fm.label, sm.label),
            (1, true) => format!("{up_name} ({} over {}), {}", fm.label, sm.label, ago(age.unwrap_or(0))),
            (-1, true) => format!("{down_name} ({} under {}), {}", fm.label, sm.label, ago(age.unwrap_or(0))),
            (1, false) => format!("{} above {}", fm.label, sm.label),
            _ => format!("{} below {}", fm.label, sm.label),
        };
        signals.push(Signal { label, direction: Direction::of(f64::from(state), 0.0), limited });
    }

    // Patterns: recent reversals with trend context, decaying with age.
    let mut pattern = 0.0;
    for p in pats.iter().filter(|p| p.context_ok && last - p.end <= HORIZON) {
        let age = last - p.end;
        pattern += p.direction.sign() * p.strength * 0.5f64.powf(age as f64 / PATTERN_HALF_LIFE);
        signals.push(Signal { label: format!("{}, {}", p.name, ago(age)), direction: p.direction, limited: p.limited });
    }
    let pattern = pattern.clamp(-1.0, 1.0);

    let components = vec![
        Component { key: "trend", label: "Trend", weight: W_TREND, value: trend },
        Component { key: "momentum", label: "Momentum", weight: W_MOMENTUM, value: momentum },
        Component { key: "crosses", label: "MA crosses", weight: W_CROSSES, value: crosses },
        Component { key: "patterns", label: "Patterns", weight: W_PATTERNS, value: pattern },
    ];
    let total: f64 = components.iter().map(|k| k.weight * k.value).sum();
    let score = ((total * 100.0).round() as i32).clamp(-100, 100);
    let bias = Bias::from_score(score);

    // Confidence: how much of the weight agrees with the verdict, and how
    // strong it is, scaled down when the data is short.
    let agree: f64 = match bias.direction() {
        Direction::Neutral => components.iter().filter(|k| k.value.abs() < 0.3).map(|k| k.weight).sum(),
        d => components.iter().filter(|k| Direction::of(k.value, 0.05) == d).map(|k| k.weight).sum(),
    };
    let raw = 0.5 * agree + 0.5 * f64::from(score.unsigned_abs()) / 100.0;
    let data = if n < FULL_WARMUP { 0.5 + 0.5 * n as f64 / FULL_WARMUP as f64 } else { 1.0 };
    let confidence = (raw * data * 100.0).round().clamp(0.0, 100.0) as u8;
    let confidence_label = match confidence {
        c if c >= 60 => Confidence::High,
        c if c >= 35 => Confidence::Medium,
        _ => Confidence::Low,
    };

    // Targets: ATR × √horizon either way, snapped to Fibonacci levels.
    let h = (HORIZON as f64).sqrt();
    let atr_move = atr * h;
    let targets = Targets {
        horizon: HORIZON,
        atr_move,
        sigma_move: sigma.map(|s| close * s * h),
        upside: snap(close + atr_move, true, close, atr, swing.as_ref()),
        downside: snap(close - atr_move, false, close, atr, swing.as_ref()),
        invalidation: match bias.direction() {
            Direction::Bullish => Some(snap(close - STOP_ATR * atr, false, close, atr, swing.as_ref())),
            Direction::Bearish => Some(snap(close + STOP_ATR * atr, true, close, atr, swing.as_ref())),
            Direction::Neutral => None,
        },
    };

    let mut readings = vec![Reading {
        key: "rsi",
        label: format!("RSI {RSI_LEN}"),
        value: rsi_s[last],
        needed: RSI_LEN + 1,
        limited: rsi_limited,
    }];
    readings.extend(mas.iter().map(|m| Reading {
        key: m.key,
        label: m.label.clone(),
        value: Some(m.values[last]),
        needed: m.period,
        limited: n < m.period,
    }));
    readings.push(Reading {
        key: "atr",
        label: format!("ATR {ATR_LEN}"),
        value: Some(atr_s[last]),
        needed: ATR_LEN,
        limited: n < ATR_LEN,
    });
    readings.push(Reading {
        key: "sigma",
        label: format!("Volatility σ {STDEV_LEN} (% per bar)"),
        value: sigma.map(|s| s * 100.0),
        needed: STDEV_LEN + 1,
        limited: n <= STDEV_LEN,
    });
    for (key, label, v) in [("bb_upper", "Bollinger upper", bb_up[last]), ("bb_lower", "Bollinger lower", bb_lo[last])] {
        readings.push(Reading {
            key,
            label: format!("{label} ({BB_LEN}, {BB_K})"),
            value: Some(v),
            needed: BB_LEN,
            limited: n < BB_LEN,
        });
    }
    readings.push(Reading { key: "rvol", label: format!("Relative volume ({RVOL_LEN})"), value: indicators::rvol(c, RVOL_LEN)[last], needed: RVOL_LEN + 1, limited: n <= RVOL_LEN });
    readings.push(Reading { key: "vwap", label: vwap_label.into(), value: vwap_s[last], needed: 1, limited: false });

    let line = |key, label: String, period: usize, values: Vec<Option<f64>>, color: &str, visible| Line {
        key, label, period, values, color: color.into(), visible, full_from: period - 1,
    };
    let mut display_mas = Vec::new();
    for (kind, entries) in [("sma", &config.sma), ("ema", &config.ema)] {
        for entry in entries {
            let values = if kind == "sma" { indicators::sma(&closes, entry.length) } else { indicators::ema(&closes, entry.length) };
            display_mas.push(line(kind, format!("{} {}", kind.to_uppercase(), entry.length), entry.length,
                values.into_iter().map(Some).collect(), &entry.color, entry.visible));
        }
    }
    let bb = &config.bollinger;
    let (mid, up, lo) = indicators::bollinger(&closes, bb.length, bb.k);
    let mc = &config.macd;
    let (ml, ms, mh) = indicators::macd(&closes, mc.fast, mc.slow, mc.signal);
    let mut rsi = line("rsi", format!("RSI {}", config.rsi.length), config.rsi.length,
        indicators::rsi(&closes, config.rsi.length), &config.rsi.color, config.rsi.visible);
    rsi.full_from = config.rsi.length;
    let (session_open, session_close) = chart.meta.periods.map_or((0, 86_400), |p| {
        let (start, end) = ((p.regular.start + gmt).rem_euclid(86_400), (p.regular.end + gmt).rem_euclid(86_400));
        (start, if end > start { end } else { 86_400 })
    });
    let key_levels = if intraday { indicators::key_levels(c, gmt, session_open, session_close) } else { vec![(None, None); n] };
    let series = Series {
        t: c.iter().map(|k| k.t).collect(),
        mas: display_mas,
        rsi,
        macd: [("macd", format!("MACD {}/{}/{}", mc.fast, mc.slow, mc.signal), ml, &mc.color, mc.slow),
            ("signal", format!("Signal {}", mc.signal), ms, &mc.signal_color, mc.slow + mc.signal - 1),
            ("histogram", "Histogram".into(), mh, &mc.color, mc.slow + mc.signal - 1)]
            .into_iter().map(|(key, label, values, color, period)| line(key, label, period, values.into_iter().map(Some).collect(), color, mc.visible)).collect(),
        bollinger: [("bb_upper", "BB upper".into(), up), ("bb_mid", format!("BB {}, {}", bb.length, bb.k), mid), ("bb_lower", "BB lower".into(), lo)]
            .into_iter().map(|(key, label, values)| line(key, label, bb.length, values.into_iter().map(Some).collect(), &bb.color, bb.visible)).collect(),
        vwap: line("vwap", vwap_label.into(), 1, vwap_s, &config.vwap.color, config.vwap.visible),
        opening_range: {
            let or = &config.opening_range;
            let ranges = if intraday { indicators::opening_range(c, gmt, session_open, or.minutes as i64 * 60) } else { vec![None; n] };
            let ext = or.extension;
            let level = |f: fn(f64, f64, f64) -> f64| ranges.iter().map(|r| r.map(|(h, l)| f(h, l, ext))).collect::<Vec<_>>();
            let mut lines = vec![
                ("or_high", format!("OR {}m", or.minutes), level(|h, _, _| h)),
                ("or_low", "OR low".into(), level(|_, l, _| l)),
                ("or_mid", "OR mid".into(), level(|h, l, _| (h + l) / 2.0)),
            ];
            if ext > 0.0 {
                lines.push(("or_ext_up", format!("OR +{ext}x"), level(|h, l, e| h + (h - l) * e)));
                lines.push(("or_ext_down", format!("OR -{ext}x"), level(|h, l, e| l - (h - l) * e)));
            }
            lines.into_iter().map(|(key, label, values)| line(key, label, 1, values, &or.color, or.visible)).collect()
        },
        volume_ma: {
            let vm = &config.volume_ma;
            let volumes: Vec<f64> = c.iter().map(|k| k.v).collect();
            line("volume_ma", format!("Vol avg {}", vm.length), vm.length, indicators::sma(&volumes, vm.length).into_iter().map(Some).collect(), &vm.color, vm.visible)
        },
        levels: [("pd_high", "PDH"), ("pd_low", "PDL"), ("pm_high", "PMH"), ("pm_low", "PML")].into_iter().enumerate()
            .map(|(i, (key, label))| {
                let values = key_levels.iter().map(|&(prior, pre)| (if i < 2 { prior } else { pre }).map(|(h, l)| if i % 2 == 0 { h } else { l })).collect();
                line(key, label.into(), 1, values, &config.levels.color, config.levels.visible)
            }).collect(),
    };

    Ok(Analysis {
        symbol: chart.meta.symbol.clone(),
        range: chart.range.clone(),
        interval: chart.interval.clone(),
        currency: chart.meta.currency.clone(),
        as_of: c[last].t,
        bars: n,
        limited: n < FULL_WARMUP,
        full_warmup: FULL_WARMUP,
        close,
        score,
        bias,
        confidence,
        confidence_label,
        components,
        signals,
        readings,
        targets,
        fib: swing,
        patterns: pats,
        series,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quote::{parse_chart, Meta};

    const DAY: &[u8] = include_bytes!("../../../fixtures/chart-1d-post.json");
    const MONTH: &[u8] = include_bytes!("../../../fixtures/chart-1mo.json");

    fn chart(closes: impl Iterator<Item = f64>) -> Chart {
        let mut prev: Option<f64> = None;
        let candles = closes
            .enumerate()
            .map(|(i, c)| {
                let o = prev.unwrap_or(c);
                prev = Some(c);
                Candle { t: i as i64 * 86_400, o, h: o.max(c) + 0.5, l: o.min(c) - 0.5, c, v: 1000.0 }
            })
            .collect();
        Chart {
            source: "yahoo".into(),
            meta: Meta {
                symbol: "TEST".into(),
                name: String::new(),
                exchange: String::new(),
                currency: "USD".into(),
                price: 0.0,
                prev_close: None,
                day_high: None,
                day_low: None,
                high_52w: None,
                low_52w: None,
                volume: None,
                market_time: 0,
                gmtoffset: 0,
                timezone: String::new(),
                periods: None,
            },
            range: "1y".into(),
            interval: "1d".into(),
            extended: false,
            candles,
            dividends: Vec::new(),
            splits: Vec::new(),
            last_bar_time: None,
            delay_secs: None,
        }
    }

    fn wave(i: usize) -> f64 {
        2.0 * (i as f64 * 0.7).sin()
    }

    #[test]
    fn display_config_does_not_change_scoring() {
        let c = chart((0..250).map(|i| 100.0 + 0.5 * i as f64 + wave(i)));
        let original = analyze(&c).unwrap();
        let mut config = crate::settings::IndicatorConfig::default();
        config.sma[0].length = 3;
        config.ema.clear();
        config.rsi.length = 2;
        config.bollinger.length = 7;
        config.bollinger.k = 4.0;
        config.macd.fast = 3;
        config.macd.visible = true;
        let changed = analyze_with_config(&c, &config).unwrap();
        assert_ne!(original.series, changed.series);
        assert_eq!(original, Analysis { series: original.series.clone(), ..changed });
    }

    #[test]
    fn default_display_series_match_fixed_indicators() {
        let c = chart((0..250).map(|i| 100.0 + wave(i)));
        let a = analyze(&c).unwrap();
        let closes: Vec<_> = c.candles.iter().map(|c| c.c).collect();
        for (line, fixed) in a.series.mas.iter().zip(mas(&closes)) {
            assert_eq!(line.label, fixed.label);
            assert_eq!(line.values, fixed.values.into_iter().map(Some).collect::<Vec<_>>());
            assert_eq!(line.full_from, fixed.period - 1);
            assert!(line.color.is_empty() && line.visible);
        }
        assert_eq!(a.series.rsi.values, indicators::rsi(&closes, RSI_LEN));
        let (mid, up, lo) = indicators::bollinger(&closes, BB_LEN, BB_K);
        for (line, values) in a.series.bollinger.iter().zip([up, mid, lo]) {
            assert_eq!(line.values, values.into_iter().map(Some).collect::<Vec<_>>());
        }
        assert_eq!(a.series.vwap.values, indicators::vwap(&c.candles, |_| 0));
    }

    #[test]
    fn uptrend_is_bullish_with_ordered_targets() {
        let a = analyze(&chart((0..250).map(|i| 100.0 + 0.5 * i as f64 + wave(i)))).unwrap();
        assert!(!a.limited);
        assert!(a.score >= 15, "score {}", a.score);
        assert!(matches!(a.bias, Bias::Bullish | Bias::StrongBullish));
        let t = &a.targets;
        assert!(t.upside.price > a.close && t.downside.price < a.close);
        assert!(t.invalidation.as_ref().unwrap().price < a.close);
        assert_eq!(a.series.t.len(), 250);
        assert!(a.series.mas.iter().all(|l| l.values.len() == 250));
    }

    #[test]
    fn downtrend_is_bearish() {
        let a = analyze(&chart((0..250).map(|i| 300.0 - 0.5 * i as f64 + wave(i)))).unwrap();
        assert!(a.score <= -15, "score {}", a.score);
        assert!(a.targets.invalidation.as_ref().unwrap().price > a.close);
    }

    #[test]
    fn is_deterministic() {
        let c = chart((0..120).map(|i| 50.0 + wave(i) + 0.1 * i as f64));
        assert_eq!(analyze(&c).unwrap(), analyze(&c).unwrap());
    }

    #[test]
    fn reveal_until_ignores_later_bars() {
        let mut full = chart((0..250).map(|i| 100.0 + 0.3 * i as f64 + wave(i)));
        full.dividends = vec![crate::quote::Dividend { t: 10 * 86_400, amount: 0.5 }, crate::quote::Dividend { t: 200 * 86_400, amount: 0.5 }];
        full.splits = vec![crate::quote::Split { t: 220 * 86_400, ratio: "2:1".into() }];
        let until = 150 * 86_400;
        let cut = reveal_until(&full, until);
        assert_eq!(cut.candles, full.candles[..=150].to_vec());
        assert_eq!(cut.dividends.len(), 1);
        assert!(cut.splits.is_empty());
        assert_eq!(cut.last_bar_time, Some(until));

        let mut altered = full.clone();
        for k in &mut altered.candles[151..] {
            k.c *= 3.0;
            k.h *= 3.0;
            k.v *= 10.0;
        }
        let a = analyze(&cut).unwrap();
        assert_eq!(a, analyze(&reveal_until(&altered, until)).unwrap());
        assert_eq!(a.as_of, until);
        assert_eq!(a.bars, 151);
        assert!(a.series.t.iter().all(|&t| t <= until));
        assert!(a.patterns.iter().all(|p| p.t <= until));
        assert_ne!(a, analyze(&full).unwrap());
    }

    #[test]
    fn reveal_until_between_bars_keeps_earlier_ones() {
        let full = chart((0..40).map(|i| 50.0 + wave(i)));
        assert_eq!(reveal_until(&full, 20 * 86_400 + 3600).candles.len(), 21);
        assert!(reveal_until(&full, -1).candles.is_empty());
    }

    #[test]
    fn bollinger_and_vwap_series() {
        let mut c = chart((0..120).map(|i| 50.0 + wave(i)));
        let a = analyze(&c).unwrap();
        let [up, mid, lo] = [0, 1, 2].map(|k| &a.series.bollinger[k]);
        assert!(up.values.iter().zip(&lo.values).all(|(u, l)| u >= l));
        assert_eq!((mid.values.len(), mid.full_from), (120, BB_LEN - 1));
        assert_eq!(a.series.vwap.label, "VWAP (anchored)");
        assert!(a.series.vwap.values.iter().all(Option::is_some));
        let r = |k| a.readings.iter().find(|r| r.key == k).unwrap().value;
        assert_eq!(r("bb_upper"), up.values[119]);
        assert_eq!(r("vwap"), a.series.vwap.values[119]);
        assert_eq!(a.series.opening_range.len(), 5);
        assert!(a.series.opening_range.iter().all(|l| l.values.iter().all(Option::is_none)));
        c.interval = "5m".into();
        let a = analyze(&c).unwrap();
        assert_eq!(a.series.vwap.label, "VWAP");
        let [hi, lo, mid, up, down] = [0, 1, 2, 3, 4].map(|k| a.series.opening_range[k].values[119].unwrap());
        assert_eq!((hi, lo, mid), (c.candles[119].h, c.candles[119].l, (hi + lo) / 2.0));
        assert_eq!((up, down), (hi + (hi - lo), lo - (hi - lo)));
        let prior = |a: &Analysis, k: usize| a.series.levels[k].values[119];
        assert_eq!([prior(&a, 0), prior(&a, 1)], [Some(c.candles[118].h), Some(c.candles[118].l)]);
        assert_eq!((single_day(&c), a.series.levels.len()), (None, 4));
        assert_eq!((a.series.volume_ma.values[119], a.readings.iter().find(|r| r.key == "rvol").unwrap().value), (Some(1000.0), Some(1.0)));
        c.candles.iter_mut().enumerate().for_each(|(i, k)| k.t = 5 * 86_400 + i as i64 * 60);
        let mut a = analyze(&c).unwrap();
        assert_eq!((single_day(&c), prior(&a, 0)), (Some(5), None));
        let mut daily = c.clone();
        daily.candles.iter_mut().enumerate().for_each(|(i, k)| k.t = i as i64 * 86_400);
        fill_prior_day(&mut a, &daily, 5);
        assert_eq!([prior(&a, 0), prior(&a, 1)], [Some(daily.candles[4].h), Some(daily.candles[4].l)]);
        assert_eq!(a.series.levels[2].values[119], None);
    }

    #[test]
    fn too_few_candles() {
        assert!(analyze(&chart([1.0, 2.0].into_iter())).is_err());
        assert!(analyze(&chart([1.0, 2.0, 3.0].into_iter())).is_ok());
    }

    #[test]
    fn short_history_is_flagged_and_less_confident() {
        let closes = |n: usize| (0..n).map(|i| 100.0 + 0.5 * i as f64 + wave(i));
        let short = analyze(&chart(closes(40))).unwrap();
        assert!(short.limited);
        assert!(short.readings.iter().find(|r| r.key == "sma200").unwrap().limited);
        assert!(!short.readings.iter().find(|r| r.key == "rsi").unwrap().limited);
        assert!(short.signals.iter().any(|s| s.limited));
        let long = analyze(&chart(closes(250))).unwrap();
        assert!(short.confidence < long.confidence, "{} vs {}", short.confidence, long.confidence);
    }

    #[test]
    fn flat_chart_does_not_blow_up() {
        let a = analyze(&chart(std::iter::repeat_n(10.0, 30))).unwrap();
        assert!(a.score.abs() < 15);
        assert_eq!(a.bias, Bias::Neutral);
        assert!(a.targets.invalidation.is_none());
        assert!(a.targets.upside.price.is_finite());
    }

    #[test]
    fn crosses_skip_identical_warmup() {
        // Equal during warm-up, then apart: not a cross.
        let fast = [1.0, 1.0, 2.0, 3.0];
        let slow = [1.0, 1.0, 1.5, 2.0];
        assert_eq!(cross(&fast, &slow), (1, None));
        let fast = [3.0, 2.0, 1.0, 3.0];
        let slow = [2.0, 2.0, 2.0, 2.0];
        assert_eq!(cross(&fast, &slow), (1, Some(3)));
    }

    #[test]
    fn targets_snap_to_nearby_fib_levels() {
        let s = fib::Swing {
            from: fib::Point { i: 0, t: 0, price: 100.0 },
            to: fib::Point { i: 1, t: 1, price: 200.0 },
            up: true,
            confirmed: true,
            levels: fib::levels(100.0, 200.0),
        };
        let t = snap(160.0, true, 150.0, 4.0, Some(&s));
        assert_eq!(t.fib.as_deref(), Some("38.2% retracement"));
        assert!((t.price - 161.8).abs() < 1e-9);
        // Nothing within 0.5 ATR: stays raw.
        let t = snap(170.0, true, 150.0, 4.0, Some(&s));
        assert_eq!((t.price, t.fib), (170.0, None));
        // Never snaps to the wrong side of the close.
        let t = snap(149.0, false, 150.0, 4.0, Some(&s));
        assert!(t.price < 150.0);
    }

    #[test]
    fn analyzes_fixtures() {
        let m = analyze(&parse_chart(MONTH, "1mo", "1d").unwrap()).unwrap();
        assert!(m.limited);
        assert_eq!(m.bars, m.series.t.len());
        assert!((-100..=100).contains(&m.score));
        assert!(m.confidence <= 100);
        let d = analyze(&parse_chart(DAY, "1d", "5m").unwrap()).unwrap();
        assert_eq!(d.symbol, "AAPL");
        assert!(d.targets.upside.price > d.close);
        assert!(d.series.rsi.values[0].is_none());
        assert!(d.series.rsi.values[1..].iter().all(|v| v.is_some_and(|x| (0.0..=100.0).contains(&x))));
    }
}

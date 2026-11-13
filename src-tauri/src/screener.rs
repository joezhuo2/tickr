use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tokio::sync::Semaphore;

use crate::analysis::{indicators, Bias, RSI_LEN};
use crate::fundamentals::Fundamentals;
use crate::quote::Candle;
use crate::state::lock;

pub const RANGE: &str = "1y";
pub const INTERVAL: &str = "1d";
const TTL: i64 = 15 * 60;
const FUNDAMENTALS_TTL: i64 = 6 * 3600;
const CONCURRENCY: usize = 3;

const DAY: i64 = 86_400;
const BASE_SLACK: i64 = 4 * DAY;
const MACD: (usize, usize, usize) = (12, 26, 9);
const ATR_LEN: usize = 14;
const RVOL_LEN: usize = 20;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ScreenRow {
    pub symbol: String,
    pub price: Option<f64>,
    pub change_pct: Option<f64>,
    pub rsi: Option<f64>,
    pub sma20: Option<f64>,
    pub sma50: Option<f64>,
    pub sma200: Option<f64>,
    pub perf_1w: Option<f64>,
    pub perf_1m: Option<f64>,
    pub perf_3m: Option<f64>,
    pub perf_6m: Option<f64>,
    pub perf_ytd: Option<f64>,
    pub perf_1y: Option<f64>,
    pub volume: Option<f64>,
    pub rel_volume: Option<f64>,
    pub from_high_52w: Option<f64>,
    pub from_low_52w: Option<f64>,
    pub atr_pct: Option<f64>,
    pub macd_hist: Option<f64>,
    pub gap_pct: Option<f64>,
    pub score: Option<i32>,
    pub bias: Option<Bias>,
    #[serde(skip)]
    pub rv_range: Option<(f64, f64)>,
    pub error: Option<String>,
}

fn base_back(candles: &[Candle], days: i64) -> Option<&Candle> {
    let target = candles.last()?.t - days * DAY;
    candles.iter().rfind(|c| c.t <= target).or_else(|| candles.first().filter(|c| c.t - target <= BASE_SLACK))
}

fn base_ytd(candles: &[Candle]) -> Option<&Candle> {
    let year = |t: i64| crate::events::ymd(t)[..4].to_string();
    let current = year(candles.last()?.t);
    candles.iter().rfind(|c| year(c.t) < current)
}

fn change_from(price: f64, base: Option<&Candle>) -> Option<f64> {
    base.map(|b| b.c).filter(|c| *c > 0.0).map(|c| (price / c - 1.0) * 100.0)
}

impl ScreenRow {
    pub fn failed(symbol: String, error: String) -> Self {
        Self { symbol, error: Some(error), ..Self::default() }
    }

    pub fn from_candles(symbol: String, candles: &[Candle]) -> Self {
        let closes: Vec<f64> = candles.iter().map(|c| c.c).collect();
        let Some(&price) = closes.last() else {
            return Self::failed(symbol, "No price history".into());
        };
        let last_sma = |n: usize| (closes.len() >= n).then(|| indicators::sma(&closes, n).last().copied()).flatten();
        let previous = closes.len().checked_sub(2).map(|i| closes[i]).filter(|p| *p != 0.0);
        let back = |days: i64| change_from(price, base_back(candles, days));
        let high = candles.iter().map(|c| c.h).fold(f64::MIN, f64::max);
        let low = candles.iter().map(|c| c.l).fold(f64::MAX, f64::min);
        let (fast, slow, signal) = MACD;
        Self {
            symbol,
            price: Some(price),
            change_pct: previous.map(|p| (price - p) / p * 100.0),
            rsi: if closes.len() > RSI_LEN { indicators::rsi(&closes, RSI_LEN).last().copied().flatten() } else { None },
            sma20: last_sma(20),
            sma50: last_sma(50),
            sma200: last_sma(200),
            perf_1w: back(7),
            perf_1m: back(30),
            perf_3m: back(91),
            perf_6m: back(182),
            perf_ytd: change_from(price, base_ytd(candles)),
            perf_1y: back(365),
            volume: candles.last().map(|c| c.v),
            rel_volume: indicators::rvol(candles, RVOL_LEN).last().copied().flatten(),
            from_high_52w: (high > 0.0).then(|| (price / high - 1.0) * 100.0),
            from_low_52w: (low > 0.0).then(|| (price / low - 1.0) * 100.0),
            atr_pct: (candles.len() > ATR_LEN && price > 0.0).then(|| indicators::atr(candles, ATR_LEN).last().map(|a| a / price * 100.0)).flatten(),
            macd_hist: (closes.len() >= slow + signal).then(|| indicators::macd(&closes, fast, slow, signal).2.last().copied()).flatten(),
            gap_pct: candles.last().zip(previous).map(|(c, p)| (c.o - p) / p * 100.0),
            score: None,
            bias: None,
            rv_range: crate::ivrank::rv_range(&closes),
            error: None,
        }
    }
}

struct Entry {
    fetched_at: i64,
    revision: u64,
    row: ScreenRow,
}

pub struct Screener {
    cache: Mutex<HashMap<String, Entry>>,
    fundamentals: Mutex<HashMap<String, (i64, Fundamentals)>>,
    limit: Arc<Semaphore>,
}

impl Screener {
    pub fn new() -> Self {
        Self { cache: Mutex::new(HashMap::new()), fundamentals: Mutex::new(HashMap::new()), limit: Arc::new(Semaphore::new(CONCURRENCY)) }
    }

    pub fn limit(&self) -> Arc<Semaphore> {
        self.limit.clone()
    }

    pub fn cached(&self, symbol: &str, now: i64, revision: u64) -> Option<ScreenRow> {
        lock(&self.cache)
            .get(symbol)
            .filter(|e| e.revision == revision && now - e.fetched_at < TTL)
            .map(|e| e.row.clone())
    }

    pub fn store(&self, row: &ScreenRow, now: i64, revision: u64) {
        let mut cache = lock(&self.cache);
        cache.retain(|_, e| now - e.fetched_at < TTL);
        cache.insert(row.symbol.clone(), Entry { fetched_at: now, revision, row: row.clone() });
    }

    pub fn cached_fundamentals(&self, symbol: &str, now: i64) -> Option<Fundamentals> {
        lock(&self.fundamentals).get(symbol).filter(|(at, _)| now - at < FUNDAMENTALS_TTL).map(|(_, f)| f.clone())
    }

    pub fn store_fundamentals(&self, f: &Fundamentals, now: i64) {
        let mut cache = lock(&self.fundamentals);
        cache.retain(|_, (at, _)| now - *at < FUNDAMENTALS_TTL);
        cache.insert(f.symbol.clone(), (now, f.clone()));
    }
}

impl Default for Screener {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bars(closes: impl IntoIterator<Item = f64>) -> Vec<Candle> {
        closes
            .into_iter()
            .enumerate()
            .map(|(i, c)| Candle { t: i as i64 * 86_400, o: c, h: c, l: c, c, v: 1.0 })
            .collect()
    }

    #[test]
    fn metrics_from_a_full_year() {
        let closes: Vec<f64> = (1..=250).map(f64::from).collect();
        let row = ScreenRow::from_candles("UP".into(), &bars(closes.clone()));
        assert_eq!(row.error, None);
        assert_eq!(row.price, Some(250.0));
        assert_eq!(row.rsi, Some(100.0));
        assert_eq!(row.sma20, Some((231..=250).sum::<i32>() as f64 / 20.0));
        assert_eq!(row.sma50, Some((201..=250).sum::<i32>() as f64 / 50.0));
        assert_eq!(row.sma200, Some((51..=250).sum::<i32>() as f64 / 200.0));
        let pct = row.change_pct.unwrap();
        assert!((pct - 100.0 / 249.0).abs() < 1e-9);
        assert_eq!(row.rsi, indicators::rsi(&closes, RSI_LEN).last().copied().flatten());
        assert_eq!(row.rv_range, crate::ivrank::rv_range(&closes));
        assert!(row.rv_range.is_some());
        let json = serde_json::to_value(&row).unwrap();
        assert!(json["score"].is_null() && json["bias"].is_null() && json.get("rv_range").is_none());
    }

    #[test]
    fn short_history_leaves_long_windows_unknown() {
        let row = ScreenRow::from_candles("NEW".into(), &bars((1..=30).map(f64::from)));
        assert!(row.rsi.is_some());
        assert!(row.sma20.is_some());
        assert_eq!((row.sma50, row.sma200), (None, None));
        let row = ScreenRow::from_candles("NEW".into(), &bars((1..=14).map(f64::from)));
        assert_eq!(row.rsi, None);
        assert_eq!(row.sma20, None);
        assert_eq!(row.price, Some(14.0));
        let row = ScreenRow::from_candles("ONE".into(), &bars([5.0]));
        assert_eq!((row.price, row.change_pct), (Some(5.0), None));
    }

    #[test]
    fn no_candles_is_an_error_and_zero_previous_close_has_no_change() {
        let row = ScreenRow::from_candles("X".into(), &[]);
        assert_eq!(row.error.as_deref(), Some("No price history"));
        assert_eq!(row.price, None);
        assert_eq!(ScreenRow::from_candles("Z".into(), &bars([0.0, 3.0])).change_pct, None);
    }

    #[test]
    fn falling_prices_read_oversold() {
        let row = ScreenRow::from_candles("DN".into(), &bars((1..=60).rev().map(f64::from)));
        assert_eq!(row.rsi, Some(0.0));
        assert!(row.change_pct.unwrap() < 0.0);
        assert!(row.price.unwrap() < row.sma20.unwrap());
    }

    fn dated(closes: impl IntoIterator<Item = f64>) -> Vec<Candle> {
        let start = 1_735_689_600;
        closes
            .into_iter()
            .enumerate()
            .map(|(i, c)| Candle { t: start + i as i64 * 86_400, o: c, h: c, l: c, c, v: 1.0 })
            .collect()
    }

    fn close(a: Option<f64>, b: f64) {
        assert!((a.unwrap() - b).abs() < 1e-9, "{a:?} vs {b}");
    }

    #[test]
    fn performance_and_range_fields_over_a_long_history() {
        let row = ScreenRow::from_candles("UP".into(), &dated((0..400).map(|i| 100.0 + f64::from(i))));
        close(row.perf_1w, (499.0 / 492.0 - 1.0) * 100.0);
        close(row.perf_1m, (499.0 / 469.0 - 1.0) * 100.0);
        close(row.perf_3m, (499.0 / 408.0 - 1.0) * 100.0);
        close(row.perf_6m, (499.0 / 317.0 - 1.0) * 100.0);
        close(row.perf_ytd, (499.0 / 464.0 - 1.0) * 100.0);
        close(row.perf_1y, (499.0 / 134.0 - 1.0) * 100.0);
        close(row.from_high_52w, 0.0);
        close(row.from_low_52w, 399.0);
        close(row.volume, 1.0);
        close(row.rel_volume, 1.0);
        close(row.gap_pct, 1.0 / 498.0 * 100.0);
        assert!(row.atr_pct.unwrap() > 0.0);
        assert!(row.macd_hist.is_some());
    }

    #[test]
    fn short_history_leaves_long_performance_windows_unknown() {
        let row = ScreenRow::from_candles("NEW".into(), &bars((1..=10).map(f64::from)));
        close(row.perf_1w, (10.0 / 3.0 - 1.0) * 100.0);
        assert_eq!((row.perf_1m, row.perf_3m, row.perf_6m, row.perf_ytd, row.perf_1y), (None, None, None, None, None));
        assert_eq!((row.atr_pct, row.macd_hist), (None, None));
        let row = ScreenRow::from_candles("Z".into(), &bars([0.0, 3.0]));
        assert_eq!((row.gap_pct, row.perf_1w), (None, None));
    }

    #[test]
    fn cache_respects_ttl_and_provider_revision() {
        let s = Screener::new();
        let row = ScreenRow::from_candles("AAPL".into(), &bars([1.0, 2.0]));
        s.store(&row, 1000, 0);
        assert_eq!(s.cached("AAPL", 1000 + TTL - 1, 0), Some(row.clone()));
        assert_eq!(s.cached("AAPL", 1000 + TTL, 0), None);
        assert_eq!(s.cached("AAPL", 1000, 1), None);
        assert_eq!(s.cached("MSFT", 1000, 0), None);
        let other = ScreenRow::from_candles("MSFT".into(), &bars([1.0, 2.0]));
        s.store(&other, 1000 + TTL, 0);
        assert_eq!(s.cached("AAPL", 1000 + TTL, 0), None);
        assert_eq!(lock(&s.cache).len(), 1);
    }

    #[test]
    fn fundamentals_cache_expires() {
        let s = Screener::new();
        let f = Fundamentals { symbol: "AAPL".into(), pe: Some(30.0), ..Fundamentals::default() };
        s.store_fundamentals(&f, 1000);
        assert_eq!(s.cached_fundamentals("AAPL", 1000 + FUNDAMENTALS_TTL - 1), Some(f));
        assert_eq!(s.cached_fundamentals("AAPL", 1000 + FUNDAMENTALS_TTL), None);
        assert_eq!(s.cached_fundamentals("MSFT", 1000), None);
    }
}

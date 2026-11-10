use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tokio::sync::Semaphore;

use crate::analysis::{indicators, Bias, RSI_LEN};
use crate::quote::Candle;
use crate::state::lock;

pub const RANGE: &str = "1y";
pub const INTERVAL: &str = "1d";
const TTL: i64 = 15 * 60;
const CONCURRENCY: usize = 3;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScreenRow {
    pub symbol: String,
    pub price: Option<f64>,
    pub change_pct: Option<f64>,
    pub rsi: Option<f64>,
    pub sma20: Option<f64>,
    pub sma50: Option<f64>,
    pub sma200: Option<f64>,
    pub score: Option<i32>,
    pub bias: Option<Bias>,
    #[serde(skip)]
    pub rv_range: Option<(f64, f64)>,
    pub error: Option<String>,
}

impl ScreenRow {
    pub fn failed(symbol: String, error: String) -> Self {
        Self { symbol, price: None, change_pct: None, rsi: None, sma20: None, sma50: None, sma200: None, score: None, bias: None, rv_range: None, error: Some(error) }
    }

    pub fn from_candles(symbol: String, candles: &[Candle]) -> Self {
        let closes: Vec<f64> = candles.iter().map(|c| c.c).collect();
        let Some(&price) = closes.last() else {
            return Self::failed(symbol, "No price history".into());
        };
        let last_sma = |n: usize| (closes.len() >= n).then(|| indicators::sma(&closes, n).last().copied()).flatten();
        let previous = closes.len().checked_sub(2).map(|i| closes[i]).filter(|p| *p != 0.0);
        Self {
            symbol,
            price: Some(price),
            change_pct: previous.map(|p| (price - p) / p * 100.0),
            rsi: if closes.len() > RSI_LEN { indicators::rsi(&closes, RSI_LEN).last().copied().flatten() } else { None },
            sma20: last_sma(20),
            sma50: last_sma(50),
            sma200: last_sma(200),
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
    limit: Arc<Semaphore>,
}

impl Screener {
    pub fn new() -> Self {
        Self { cache: Mutex::new(HashMap::new()), limit: Arc::new(Semaphore::new(CONCURRENCY)) }
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
}

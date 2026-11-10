use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tokio::sync::Semaphore;

use crate::analysis::indicators;
use crate::analyst::Analysts;
use crate::options::{self, Contract, Options};
use crate::state::lock;

const TTL: i64 = 30 * 60;
const CONCURRENCY: usize = 3;
const RV_LEN: usize = 30;
const YEAR: usize = 252;
const MIN_HISTORY: usize = YEAR / 2;
const MIN_EXPIRY_SECS: i64 = 7 * 86_400;
const MIN_IV: f64 = 0.01;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IvRank {
    pub symbol: String,
    pub iv: Option<f64>,
    pub rank: Option<f64>,
    pub error: Option<String>,
}

pub fn rv_range(closes: &[f64]) -> Option<(f64, f64)> {
    let tail = &closes[closes.len().saturating_sub(YEAR + 1)..];
    if tail.len() < MIN_HISTORY {
        return None;
    }
    let annual = (YEAR as f64).sqrt();
    let vols: Vec<f64> = tail.windows(RV_LEN + 1).filter_map(|w| indicators::stdev_returns(w, RV_LEN)).map(|s| s * annual).collect();
    let lo = vols.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = vols.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    (lo.is_finite() && hi > lo).then_some((lo, hi))
}

pub fn rank(iv: f64, (lo, hi): (f64, f64)) -> f64 {
    ((iv - lo) / (hi - lo) * 100.0).clamp(0.0, 100.0)
}

pub fn atm_iv(o: &Options) -> Option<f64> {
    let price = o.price?;
    let nearest = |list: &[Contract]| {
        list.iter()
            .filter(|c| c.iv.is_some_and(|v| v >= MIN_IV))
            .min_by(|a, b| (a.strike - price).abs().total_cmp(&(b.strike - price).abs()))
            .and_then(|c| c.iv)
    };
    let ivs: Vec<f64> = [nearest(&o.calls), nearest(&o.puts)].into_iter().flatten().collect();
    (!ivs.is_empty()).then(|| ivs.iter().sum::<f64>() / ivs.len() as f64)
}

pub fn later_expiry(o: &Options, now: i64) -> Option<i64> {
    if o.expiry.is_some_and(|e| e - now >= MIN_EXPIRY_SECS) {
        return None;
    }
    o.expirations.iter().copied().find(|e| e - now >= MIN_EXPIRY_SECS && Some(*e) != o.expiry)
}

pub struct Cache {
    entries: Mutex<HashMap<String, (i64, Option<f64>)>>,
    limit: Arc<Semaphore>,
}

impl Default for Cache {
    fn default() -> Self {
        Self { entries: Mutex::new(HashMap::new()), limit: Arc::new(Semaphore::new(CONCURRENCY)) }
    }
}

impl Cache {
    pub fn cached(&self, symbol: &str, now: i64) -> Option<Option<f64>> {
        lock(&self.entries).get(symbol).filter(|(at, _)| (0..TTL).contains(&(now - at))).map(|(_, iv)| *iv)
    }

    fn store(&self, symbol: &str, now: i64, iv: Option<f64>) {
        let mut entries = lock(&self.entries);
        entries.retain(|_, (at, _)| (0..TTL).contains(&(now - *at)));
        entries.insert(symbol.to_string(), (now, iv));
    }

    pub async fn iv(&self, analysts: &Analysts, symbol: &str, now: i64) -> Result<Option<f64>, String> {
        if let Some(iv) = self.cached(symbol, now) {
            return Ok(iv);
        }
        let Ok(_permit) = self.limit.clone().acquire_owned().await else {
            return Err("IV rank unavailable".into());
        };
        if let Some(iv) = self.cached(symbol, now) {
            return Ok(iv);
        }
        let iv = match options::fetch(analysts, symbol, None).await {
            Ok(o) => match later_expiry(&o, now) {
                Some(date) => atm_iv(&options::fetch(analysts, symbol, Some(date)).await?),
                None => atm_iv(&o),
            },
            Err(e) if e == "no options" => None,
            Err(e) => return Err(e),
        };
        self.store(symbol, now, iv);
        Ok(iv)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contract(strike: f64, iv: Option<f64>) -> Contract {
        Contract { symbol: String::new(), strike, last: None, bid: None, ask: None, change: None, change_pct: None, volume: None, open_interest: None, iv, last_trade: None, itm: false }
    }

    fn chain(price: Option<f64>, calls: Vec<Contract>, puts: Vec<Contract>) -> Options {
        Options { price, expirations: vec![], expiry: None, calls, puts }
    }

    #[test]
    fn rank_scales_and_clamps() {
        assert!((rank(0.3, (0.2, 0.4)) - 50.0).abs() < 1e-9);
        assert_eq!(rank(0.2, (0.2, 0.4)), 0.0);
        assert_eq!(rank(0.4, (0.2, 0.4)), 100.0);
        assert_eq!(rank(0.1, (0.2, 0.4)), 0.0);
        assert_eq!(rank(0.9, (0.2, 0.4)), 100.0);
    }

    #[test]
    fn realized_vol_range_over_a_year() {
        let calm: Vec<f64> = (0..200).map(|i| 100.0 * if i % 2 == 0 { 1.0 } else { 1.01 }).collect();
        let wild: Vec<f64> = (0..60).map(|i| 100.0 * if i % 2 == 0 { 1.0 } else { 1.05 }).collect();
        let closes: Vec<f64> = calm.into_iter().chain(wild).collect();
        let (lo, hi) = rv_range(&closes).unwrap();
        let daily = |up: f64| {
            let r = (1.0 + up).ln();
            let rets: Vec<f64> = (0..RV_LEN).map(|i| if i % 2 == 0 { r } else { -r }).collect();
            let mean = rets.iter().sum::<f64>() / RV_LEN as f64;
            (rets.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (RV_LEN - 1) as f64).sqrt() * (YEAR as f64).sqrt()
        };
        assert!((lo - daily(0.01)).abs() < 1e-9, "{lo}");
        assert!((hi - daily(0.05)).abs() < 1e-9, "{hi}");
        let r = rank(daily(0.03), (lo, hi));
        assert!(r > 0.0 && r < 100.0);
    }

    #[test]
    fn realized_vol_needs_history_and_movement() {
        let short: Vec<f64> = (0..MIN_HISTORY - 1).map(|i| 100.0 + (i % 3) as f64).collect();
        assert_eq!(rv_range(&short), None);
        assert_eq!(rv_range(&[50.0; 300]), None);
        assert_eq!(rv_range(&[]), None);
    }

    #[test]
    fn atm_iv_averages_the_nearest_call_and_put() {
        let o = chain(
            Some(101.0),
            vec![contract(95.0, Some(0.5)), contract(100.0, Some(0.3)), contract(105.0, Some(0.2))],
            vec![contract(100.0, Some(0.34)), contract(110.0, Some(0.4))],
        );
        assert!((atm_iv(&o).unwrap() - 0.32).abs() < 1e-12);
    }

    #[test]
    fn atm_iv_skips_placeholder_vols_and_handles_missing_data() {
        let o = chain(Some(100.0), vec![contract(100.0, Some(0.00001)), contract(105.0, Some(0.25))], vec![contract(100.0, None)]);
        assert_eq!(atm_iv(&o), Some(0.25));
        assert_eq!(atm_iv(&chain(None, vec![contract(100.0, Some(0.3))], vec![])), None);
        assert_eq!(atm_iv(&chain(Some(100.0), vec![], vec![])), None);
    }

    #[test]
    fn skips_expiries_inside_a_week() {
        let now = 1_000_000;
        let day = 86_400;
        let o = Options { expirations: vec![now + day, now + 3 * day, now + 8 * day, now + 15 * day], expiry: Some(now + day), ..chain(None, vec![], vec![]) };
        assert_eq!(later_expiry(&o, now), Some(now + 8 * day));
        let o = Options { expiry: Some(now + 8 * day), ..o };
        assert_eq!(later_expiry(&o, now), None);
        let o = Options { expirations: vec![now + day], expiry: Some(now + day), ..chain(None, vec![], vec![]) };
        assert_eq!(later_expiry(&o, now), None);
    }

    #[test]
    fn cache_respects_ttl_and_remembers_symbols_without_options() {
        let c = Cache::default();
        c.store("AAPL", 1000, Some(0.3));
        c.store("BTC-USD", 1000, None);
        assert_eq!(c.cached("AAPL", 1000 + TTL - 1), Some(Some(0.3)));
        assert_eq!(c.cached("BTC-USD", 1000), Some(None));
        assert_eq!(c.cached("AAPL", 1000 + TTL), None);
        assert_eq!(c.cached("AAPL", 999), None);
        c.store("MSFT", 1000 + TTL, Some(0.2));
        assert_eq!(lock(&c.entries).len(), 1);
    }

    #[test]
    #[ignore]
    fn live_iv() {
        let iv = tauri::async_runtime::block_on(Cache::default().iv(&Analysts::new(), "AAPL", crate::state::now_secs())).unwrap();
        assert!(iv.is_some_and(|v| v > 0.05 && v < 3.0), "{iv:?}");
    }
}

//! Analyst consensus and 12-month price targets from Yahoo's quoteSummary.
//!
//! Unlike the chart endpoint, quoteSummary needs Yahoo's A3 cookie plus a
//! matching "crumb" token. Both live in a cookie-holding client of their own
//! and are renewed once when Yahoo rejects them. Results, including "no
//! coverage", are cached in memory for 12 hours; errors are not cached.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use crate::quote::USER_AGENT;
use crate::state::lock;

/// Any Yahoo page sets the A3 cookie; this one answers fast (with a 404).
const COOKIE_URL: &str = "https://fc.yahoo.com/";
const CRUMB_URL: &str = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const SUMMARY_URL: &str = "https://query1.finance.yahoo.com/v10/finance/quoteSummary";
const MODULES: &str = "financialData,recommendationTrend";
const TTL: i64 = 12 * 3600;

/// Analyst counts per rating for the current month.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Ratings {
    pub strong_buy: u32,
    pub buy: u32,
    pub hold: u32,
    pub sell: u32,
    pub strong_sell: u32,
}

impl Ratings {
    fn total(&self) -> u32 {
        self.strong_buy + self.buy + self.hold + self.sell + self.strong_sell
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Consensus {
    pub symbol: String,
    /// Yahoo's recommendation key: strong_buy, buy, hold, underperform or sell.
    pub rating: Option<String>,
    /// Mean recommendation, 1 (strong buy) to 5 (strong sell).
    pub score: Option<f64>,
    pub analysts: Option<u32>,
    /// 12-month price targets, in the symbol's trading currency.
    pub target_mean: Option<f64>,
    pub target_median: Option<f64>,
    pub target_high: Option<f64>,
    pub target_low: Option<f64>,
    pub ratings: Option<Ratings>,
}

fn raw(v: &Value) -> Option<f64> {
    v["raw"].as_f64().filter(|x| x.is_finite())
}

fn count(v: &Value) -> u32 {
    v.as_u64().unwrap_or_default() as u32
}

/// Parses a quoteSummary response. Ok(None) means Yahoo has no analyst
/// coverage for the symbol (ETFs, indices, crypto, small caps).
pub fn parse(body: &[u8], symbol: &str) -> Result<Option<Consensus>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let err = &v["quoteSummary"]["error"];
    if err["code"].as_str() == Some("Not Found") {
        return Ok(None);
    }
    if let Some(desc) = err["description"].as_str() {
        return Err(desc.to_string());
    }
    let r = &v["quoteSummary"]["result"][0];
    let fd = &r["financialData"];
    let ratings = r["recommendationTrend"]["trend"]
        .as_array()
        .and_then(|t| t.iter().find(|p| p["period"] == "0m"))
        .map(|p| Ratings {
            strong_buy: count(&p["strongBuy"]),
            buy: count(&p["buy"]),
            hold: count(&p["hold"]),
            sell: count(&p["sell"]),
            strong_sell: count(&p["strongSell"]),
        })
        .filter(|r| r.total() > 0);
    let c = Consensus {
        symbol: symbol.to_string(),
        rating: fd["recommendationKey"].as_str().filter(|k| *k != "none").map(str::to_string),
        score: raw(&fd["recommendationMean"]),
        analysts: raw(&fd["numberOfAnalystOpinions"]).map(|n| n as u32).filter(|n| *n > 0),
        target_mean: raw(&fd["targetMeanPrice"]),
        target_median: raw(&fd["targetMedianPrice"]),
        target_high: raw(&fd["targetHighPrice"]),
        target_low: raw(&fd["targetLowPrice"]),
        ratings,
    };
    let covered = c.target_mean.is_some() || c.rating.is_some() || c.ratings.is_some();
    Ok(covered.then_some(c))
}

fn network(e: reqwest::Error) -> String {
    format!("network: {e}")
}

pub struct Analysts {
    client: reqwest::Client,
    /// Held across the renewal requests so concurrent fetches share one crumb.
    crumb: tokio::sync::Mutex<Option<String>>,
    /// Symbol -> (fetched at, result).
    cache: Mutex<HashMap<String, (i64, Option<Consensus>)>>,
}

impl Default for Analysts {
    fn default() -> Self {
        Self::new()
    }
}

impl Analysts {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("http client");
        Self { client, crumb: tokio::sync::Mutex::new(None), cache: Mutex::new(HashMap::new()) }
    }

    /// The cached result, if fresh: Some(None) means "known to have no coverage".
    pub fn cached(&self, symbol: &str, now: i64) -> Option<Option<Consensus>> {
        lock(&self.cache)
            .get(&symbol.trim().to_uppercase())
            .filter(|(at, _)| now - at < TTL)
            .map(|(_, c)| c.clone())
    }

    pub async fn get(&self, symbol: &str, now: i64) -> Result<Option<Consensus>, String> {
        if let Some(c) = self.cached(symbol, now) {
            return Ok(c);
        }
        let symbol = symbol.trim().to_uppercase();
        let c = self.fetch(&symbol).await?;
        lock(&self.cache).insert(symbol, (now, c.clone()));
        Ok(c)
    }

    async fn crumb(&self, renew: bool) -> Result<String, String> {
        let mut crumb = self.crumb.lock().await;
        if renew {
            *crumb = None;
        }
        if let Some(c) = crumb.as_ref() {
            return Ok(c.clone());
        }
        self.client.get(COOKIE_URL).send().await.map_err(network)?;
        let text = self.client.get(CRUMB_URL).send().await.map_err(network)?.text().await.map_err(network)?;
        let text = text.trim();
        // A rejection comes back as a JSON error body, a consent page as HTML.
        if text.is_empty() || text.len() > 64 || text.starts_with(['{', '<']) {
            return Err("could not start a Yahoo session".into());
        }
        *crumb = Some(text.to_string());
        Ok(text.to_string())
    }

    async fn fetch(&self, symbol: &str) -> Result<Option<Consensus>, String> {
        let url = format!("{SUMMARY_URL}/{symbol}");
        for renew in [false, true] {
            let crumb = self.crumb(renew).await?;
            let res = self
                .client
                .get(&url)
                .query(&[("modules", MODULES), ("crumb", crumb.as_str())])
                .send()
                .await
                .map_err(network)?;
            let status = res.status().as_u16();
            let body = res.bytes().await.map_err(network)?;
            match status {
                // Stale cookie or crumb: renew once.
                401 | 403 => continue,
                429 => return Err("rate limited".into()),
                // Unknown symbols and uncovered ones come back as 404 with a JSON body.
                200..=299 | 404 => return parse(&body, symbol),
                _ => return Err(format!("HTTP {status}")),
            }
        }
        log::warn!("analyst {symbol}: Yahoo rejected the session twice");
        Err("Yahoo rejected the session".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &[u8] = include_bytes!("../../fixtures/analyst-aapl.json");
    const NONE: &[u8] = include_bytes!("../../fixtures/analyst-none.json");

    #[test]
    fn parses_targets_and_ratings() {
        let c = parse(AAPL, "AAPL").unwrap().expect("coverage");
        assert_eq!(c.symbol, "AAPL");
        assert_eq!(c.rating.as_deref(), Some("buy"));
        assert_eq!(c.analysts, Some(39));
        assert_eq!(c.target_high, Some(405.0));
        assert_eq!(c.target_low, Some(215.0));
        assert_eq!(c.target_median, Some(340.0));
        assert!((c.target_mean.unwrap() - 328.09384).abs() < 1e-9);
        assert!((c.score.unwrap() - 2.20455).abs() < 1e-9);
        let r = c.ratings.unwrap();
        assert_eq!((r.strong_buy, r.buy, r.hold, r.sell, r.strong_sell), (6, 19, 13, 3, 3));
    }

    #[test]
    fn no_fundamentals_is_no_coverage() {
        assert_eq!(parse(NONE, "SPY").unwrap(), None);
    }

    #[test]
    fn empty_result_is_no_coverage() {
        let body = br#"{"quoteSummary":{"result":[{"financialData":{"recommendationKey":"none"},"recommendationTrend":{"trend":[{"period":"0m","strongBuy":0,"buy":0,"hold":0,"sell":0,"strongSell":0}]}}],"error":null}}"#;
        assert_eq!(parse(body, "X").unwrap(), None);
    }

    #[test]
    fn auth_error_is_an_error() {
        let body = br#"{"quoteSummary":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}"#;
        assert_eq!(parse(body, "X").unwrap_err(), "Invalid Crumb");
    }

    /// Hits Yahoo. Run with `cargo test -- --ignored live`.
    #[test]
    #[ignore]
    fn live_session_and_fetch() {
        let a = Analysts::new();
        tauri::async_runtime::block_on(async {
            let c = a.fetch("AAPL").await.unwrap().expect("AAPL is covered");
            assert!(c.target_mean.is_some() && c.analysts.is_some(), "{c:?}");
            assert_eq!(a.fetch("SPY").await.unwrap(), None);
            // A stale crumb is renewed transparently.
            *a.crumb.lock().await = Some("stale".into());
            assert!(a.fetch("MSFT").await.unwrap().is_some());
        });
    }

    #[test]
    fn cache_respects_ttl() {
        let a = Analysts::new();
        lock(&a.cache).insert("AAPL".into(), (1000, None));
        assert_eq!(a.cached("aapl", 1000 + TTL - 1), Some(None));
        assert_eq!(a.cached("AAPL", 1000 + TTL), None);
        assert_eq!(a.cached("MSFT", 1000), None);
    }
}

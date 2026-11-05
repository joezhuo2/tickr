use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::Semaphore;

use crate::analyst::Analysts;
use crate::events::{parse_day, ymd};
use crate::state::lock;

const MODULES: &str = "calendarEvents";
const TTL: i64 = 6 * 3600;
const CONCURRENCY: usize = 3;
pub const MAX_SYMBOLS: usize = 100;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EarningsDate {
    pub date: String,
    pub estimated: bool,
    pub eps_estimate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Dates {
    pub symbol: String,
    pub earnings: Option<EarningsDate>,
    pub ex_dividend: Option<String>,
    pub error: Option<String>,
}

impl Dates {
    fn empty(symbol: &str) -> Self {
        Self { symbol: symbol.to_string(), earnings: None, ex_dividend: None, error: None }
    }

    fn failed(symbol: &str, error: String) -> Self {
        Self { error: Some(error), ..Self::empty(symbol) }
    }
}

fn day_of(v: &Value) -> Option<String> {
    if let Some(fmt) = v["fmt"].as_str().filter(|s| parse_day(s).is_some()) {
        return Some(fmt.to_string());
    }
    v["raw"].as_i64().filter(|r| *r > 0).map(ymd)
}

pub fn parse(body: &[u8], symbol: &str) -> Result<Dates, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let err = &v["quoteSummary"]["error"];
    if err["code"].as_str() == Some("Not Found") {
        return Ok(Dates::empty(symbol));
    }
    if let Some(desc) = err["description"].as_str() {
        return Err(desc.to_string());
    }
    let cal = &v["quoteSummary"]["result"][0]["calendarEvents"];
    let e = &cal["earnings"];
    let earnings = e["earningsDate"].as_array().into_iter().flatten().filter_map(day_of).min().map(|date| EarningsDate {
        date,
        estimated: e["isEarningsDateEstimate"].as_bool().unwrap_or(false),
        eps_estimate: e["earningsAverage"]["raw"].as_f64().filter(|x| x.is_finite()),
    });
    Ok(Dates { earnings, ex_dividend: day_of(&cal["exDividendDate"]), ..Dates::empty(symbol) })
}

pub struct Cache {
    entries: Mutex<HashMap<String, (i64, Dates)>>,
    limit: Arc<Semaphore>,
}

impl Default for Cache {
    fn default() -> Self {
        Self { entries: Mutex::new(HashMap::new()), limit: Arc::new(Semaphore::new(CONCURRENCY)) }
    }
}

impl Cache {
    pub fn cached(&self, symbol: &str, now: i64) -> Option<Dates> {
        lock(&self.entries)
            .get(&symbol.trim().to_uppercase())
            .filter(|(at, _)| (0..TTL).contains(&(now - at)))
            .map(|(_, d)| d.clone())
    }

    fn store(&self, now: i64, dates: &Dates) {
        let mut entries = lock(&self.entries);
        entries.retain(|_, (at, _)| (0..TTL).contains(&(now - *at)));
        entries.insert(dates.symbol.clone(), (now, dates.clone()));
    }

    pub fn seed(&self, symbol: &str, summary: &[u8], now: i64) {
        if let Ok(dates) = parse(summary, &symbol.trim().to_uppercase()) {
            self.store(now, &dates);
        }
    }

    pub async fn get(&self, analysts: &Analysts, symbol: &str, now: i64, force: bool) -> Dates {
        let symbol = symbol.trim().to_uppercase();
        if let Some(d) = self.cached(&symbol, now).filter(|_| !force) {
            return d;
        }
        let Ok(_permit) = self.limit.clone().acquire_owned().await else {
            return Dates::failed(&symbol, "Calendar unavailable".into());
        };
        if let Some(d) = self.cached(&symbol, now).filter(|_| !force) {
            return d;
        }
        match analysts.summary(&symbol, MODULES).await.and_then(|b| parse(&b, &symbol)) {
            Ok(d) => {
                self.store(now, &d);
                d
            }
            Err(e) => Dates::failed(&symbol, e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KO: &[u8] = include_bytes!("../../fixtures/calendar-ko.json");
    const AMZN: &[u8] = include_bytes!("../../fixtures/calendar-amzn.json");
    const SPY: &[u8] = include_bytes!("../../fixtures/calendar-spy.json");

    #[test]
    fn parses_earnings_and_ex_dividend() {
        let d = parse(KO, "KO").unwrap();
        assert_eq!(d.symbol, "KO");
        assert_eq!(d.earnings, Some(EarningsDate { date: "2026-10-27".into(), estimated: false, eps_estimate: Some(0.60091) }));
        assert_eq!(d.ex_dividend.as_deref(), Some("2026-12-01"));
        assert_eq!(d.error, None);
    }

    #[test]
    fn empty_dividend_object_is_none() {
        let d = parse(AMZN, "AMZN").unwrap();
        assert_eq!(d.earnings.map(|e| e.date), Some("2026-10-29".into()));
        assert_eq!(d.ex_dividend, None);
    }

    #[test]
    fn symbols_without_calendar_are_empty_not_errors() {
        let d = parse(SPY, "SPY").unwrap();
        assert_eq!((d.earnings, d.ex_dividend, d.error), (None, None, None));
        let d = parse(br#"{"quoteSummary":{"result":[{}],"error":null}}"#, "X").unwrap();
        assert_eq!((d.earnings, d.ex_dividend), (None, None));
        let d = parse(br#"{"quoteSummary":{"result":null,"error":null}}"#, "X").unwrap();
        assert_eq!((d.earnings, d.ex_dividend), (None, None));
    }

    #[test]
    fn errors_are_errors() {
        let auth = br#"{"quoteSummary":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}"#;
        assert_eq!(parse(auth, "X").unwrap_err(), "Invalid Crumb");
        assert!(parse(b"", "X").unwrap_err().starts_with("bad response"));
        assert!(parse(b"<html>", "X").is_err());
    }

    #[test]
    fn reads_raw_when_fmt_is_missing_or_bad_and_picks_the_earliest_date() {
        let body = br#"{"quoteSummary":{"result":[{"calendarEvents":{
            "earnings":{"earningsDate":[{"raw":1796083200,"fmt":"junk"},{"raw":1793750400},{"fmt":"2026-11-05"},{"raw":-5},{}],"isEarningsDateEstimate":true,"earningsAverage":{"raw":"x"}},
            "exDividendDate":{"raw":1796083200}}}],"error":null}}"#;
        let d = parse(body, "X").unwrap();
        let e = d.earnings.unwrap();
        assert_eq!((e.date.as_str(), e.estimated, e.eps_estimate), ("2026-11-04", true, None));
        assert_eq!(d.ex_dividend.as_deref(), Some("2026-12-01"));
    }

    #[test]
    fn junk_dates_are_dropped() {
        let body = br#"{"quoteSummary":{"result":[{"calendarEvents":{
            "earnings":{"earningsDate":[{"raw":"soon"},{"raw":0},{"fmt":"2026-02-30"}]},
            "exDividendDate":{"raw":null,"fmt":"never"}}}],"error":null}}"#;
        let d = parse(body, "X").unwrap();
        assert_eq!((d.earnings, d.ex_dividend), (None, None));
    }

    #[test]
    fn cache_respects_ttl_and_seeds_from_a_summary() {
        let c = Cache::default();
        assert_eq!(c.cached("ko", 1000), None);
        c.seed("ko", KO, 1000);
        assert_eq!(c.cached(" KO ", 1000 + TTL - 1).unwrap().ex_dividend.as_deref(), Some("2026-12-01"));
        assert_eq!(c.cached("KO", 1000 + TTL), None);
        assert_eq!(c.cached("KO", 999), None);
        c.seed("bad", b"nope", 1000);
        assert_eq!(c.cached("BAD", 1000), None);
        c.seed("spy", SPY, 1000);
        assert_eq!(c.cached("SPY", 1000).map(|d| d.earnings), Some(None));
        c.seed("amzn", AMZN, 1000 + TTL);
        assert_eq!(c.cached("KO", 1000 + TTL), None);
        assert!(c.cached("AMZN", 1000 + TTL).is_some());
    }

    #[test]
    fn serializes_for_the_window() {
        let json = serde_json::to_value(parse(KO, "KO").unwrap()).unwrap();
        assert_eq!(json["earnings"]["date"], "2026-10-27");
        assert_eq!(json["earnings"]["estimated"], false);
        assert_eq!(json["ex_dividend"], "2026-12-01");
        assert!(json["error"].is_null());
    }

    #[test]
    #[ignore]
    fn live_calendar_dates() {
        let a = Analysts::new();
        let c = Cache::default();
        tauri::async_runtime::block_on(async {
            let ko = c.get(&a, "KO", 1_000_000_000, true).await;
            assert_eq!(ko.error, None, "{ko:?}");
            assert!(ko.earnings.is_some() && ko.ex_dividend.is_some(), "{ko:?}");
            let spy = c.get(&a, "SPY", 1_000_000_000, true).await;
            assert_eq!((spy.error, spy.earnings), (None, None));
        });
    }
}

//! Yahoo Finance chart and search endpoints: fetch, parse, session detection.
//!
//! These endpoints are unofficial and need a browser-like User-Agent.

use serde::Serialize;
use serde_json::Value;

const CHART_URL: &str = "https://query1.finance.yahoo.com/v8/finance/chart";
pub(crate) const SEARCH_URL: &str = "https://query1.finance.yahoo.com/v1/finance/search";
pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

pub const RANGES: [&str; 8] = ["1d", "5d", "1mo", "6mo", "ytd", "1y", "5y", "max"];

/// Candle interval for a range, and whether pre/post candles are included.
pub fn interval_for(range: &str) -> Option<(&'static str, bool)> {
    Some(match range {
        "1d" => ("5m", true),
        "5d" => ("15m", false),
        "1mo" => ("60m", false),
        "6mo" | "ytd" | "1y" => ("1d", false),
        "5y" => ("1wk", false),
        "max" => ("1mo", false),
        _ => return None,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Candle {
    pub t: i64,
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    pub v: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Period {
    pub start: i64,
    pub end: i64,
}

impl Period {
    fn contains(&self, t: i64) -> bool {
        t >= self.start && t < self.end
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Periods {
    pub pre: Period,
    pub regular: Period,
    pub post: Period,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Meta {
    pub symbol: String,
    pub name: String,
    pub exchange: String,
    pub currency: String,
    pub price: f64,
    pub prev_close: Option<f64>,
    pub day_high: Option<f64>,
    pub day_low: Option<f64>,
    pub high_52w: Option<f64>,
    pub low_52w: Option<f64>,
    pub volume: Option<f64>,
    pub market_time: i64,
    pub gmtoffset: i64,
    pub periods: Option<Periods>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Chart {
    pub meta: Meta,
    pub range: String,
    pub interval: String,
    pub candles: Vec<Candle>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Session {
    Pre,
    Regular,
    Post,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Extended {
    /// "Pre-market" or "After hours".
    pub label: &'static str,
    pub price: f64,
    pub change: f64,
    pub change_pct: f64,
    pub t: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Quote {
    pub symbol: String,
    pub name: String,
    pub exchange: String,
    pub currency: String,
    pub price: f64,
    pub prev_close: Option<f64>,
    pub change: Option<f64>,
    pub change_pct: Option<f64>,
    pub open: Option<f64>,
    pub day_high: Option<f64>,
    pub day_low: Option<f64>,
    pub high_52w: Option<f64>,
    pub low_52w: Option<f64>,
    pub volume: Option<f64>,
    pub session: Session,
    pub extended: Option<Extended>,
    pub market_time: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SearchHit {
    pub symbol: String,
    pub name: String,
    pub exchange: String,
    pub kind: String,
}

fn f(v: &Value) -> Option<f64> {
    v.as_f64().filter(|x| x.is_finite())
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn period(v: &Value) -> Option<Period> {
    Some(Period { start: v["start"].as_i64()?, end: v["end"].as_i64()? })
}

/// Parses a v8 chart response. Candles with any missing field are dropped.
pub fn parse_chart(body: &[u8], range: &str, interval: &str) -> Result<Chart, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let chart = &v["chart"];
    if let Some(desc) = chart["error"]["description"].as_str() {
        return Err(desc.to_string());
    }
    let r = &chart["result"][0];
    let m = &r["meta"];
    let price = f(&m["regularMarketPrice"]).ok_or("no price in response")?;
    let tp = &m["currentTradingPeriod"];
    let periods = match (period(&tp["pre"]), period(&tp["regular"]), period(&tp["post"])) {
        (Some(pre), Some(regular), Some(post)) => Some(Periods { pre, regular, post }),
        _ => None,
    };
    let name = [&m["longName"], &m["shortName"]]
        .iter()
        .find_map(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    let meta = Meta {
        symbol: s(&m["symbol"]),
        name,
        exchange: [&m["fullExchangeName"], &m["exchangeName"]]
            .iter()
            .find_map(|x| x.as_str())
            .unwrap_or_default()
            .to_string(),
        currency: s(&m["currency"]),
        price,
        prev_close: f(&m["previousClose"]).or_else(|| f(&m["chartPreviousClose"])),
        day_high: f(&m["regularMarketDayHigh"]),
        day_low: f(&m["regularMarketDayLow"]),
        high_52w: f(&m["fiftyTwoWeekHigh"]),
        low_52w: f(&m["fiftyTwoWeekLow"]),
        volume: f(&m["regularMarketVolume"]),
        market_time: m["regularMarketTime"].as_i64().unwrap_or_default(),
        gmtoffset: m["gmtoffset"].as_i64().unwrap_or_default(),
        periods,
    };

    let ts = r["timestamp"].as_array().cloned().unwrap_or_default();
    let q = &r["indicators"]["quote"][0];
    let col = |k: &str, i: usize| f(&q[k][i]);
    let candles = ts
        .iter()
        .enumerate()
        .filter_map(|(i, t)| {
            Some(Candle {
                t: t.as_i64()?,
                o: col("open", i)?,
                h: col("high", i)?,
                l: col("low", i)?,
                c: col("close", i)?,
                v: col("volume", i).unwrap_or(0.0),
            })
        })
        .collect();
    Ok(Chart { meta, range: range.into(), interval: interval.into(), candles })
}

pub fn session_at(periods: Option<&Periods>, now: i64) -> Session {
    match periods {
        Some(p) if p.regular.contains(now) => Session::Regular,
        Some(p) if p.pre.contains(now) => Session::Pre,
        Some(p) if p.post.contains(now) => Session::Post,
        _ => Session::Closed,
    }
}

/// Builds the tray/header quote from a 1d chart with pre/post candles.
pub fn quote_from(chart: &Chart, now: i64) -> Quote {
    let m = &chart.meta;
    let session = session_at(m.periods.as_ref(), now);
    let change = m.prev_close.map(|p| m.price - p);
    let change_pct = m.prev_close.filter(|p| *p != 0.0).map(|p| (m.price - p) / p * 100.0);

    let open = m
        .periods
        .and_then(|p| chart.candles.iter().find(|c| p.regular.contains(c.t)))
        .map(|c| c.o);

    // Extended price: the latest candle outside regular hours, when the
    // current session is pre-market, after hours, or closed after the close.
    let extended = m.periods.and_then(|p| {
        let (label, range) = match session {
            Session::Regular => return None,
            Session::Pre => ("Pre-market", p.pre),
            Session::Post => ("After hours", p.post),
            Session::Closed if now >= p.post.start => ("After hours", p.post),
            Session::Closed => return None,
        };
        let last = chart.candles.iter().rev().find(|c| range.contains(c.t))?;
        let change = last.c - m.price;
        Some(Extended {
            label,
            price: last.c,
            change,
            change_pct: if m.price != 0.0 { change / m.price * 100.0 } else { 0.0 },
            t: last.t,
        })
    });

    Quote {
        symbol: m.symbol.clone(),
        name: m.name.clone(),
        exchange: m.exchange.clone(),
        currency: m.currency.clone(),
        price: m.price,
        prev_close: m.prev_close,
        change,
        change_pct,
        open,
        day_high: m.day_high,
        day_low: m.day_low,
        high_52w: m.high_52w,
        low_52w: m.low_52w,
        volume: m.volume,
        session,
        extended,
        market_time: m.market_time,
    }
}

pub fn parse_search(body: &[u8]) -> Result<Vec<SearchHit>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let hits = v["quotes"].as_array().cloned().unwrap_or_default();
    Ok(hits
        .iter()
        .filter_map(|q| {
            let symbol = q["symbol"].as_str()?.to_string();
            Some(SearchHit {
                symbol,
                name: [&q["longname"], &q["shortname"]]
                    .iter()
                    .find_map(|x| x.as_str())
                    .unwrap_or_default()
                    .to_string(),
                exchange: s(&q["exchDisp"]),
                kind: s(&q["typeDisp"]),
            })
        })
        .collect())
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("http client")
}

pub(crate) async fn get(client: &reqwest::Client, url: &str, query: &[(&str, &str)]) -> Result<Vec<u8>, String> {
    let res = client.get(url).query(query).send().await.map_err(|e| format!("network: {e}"))?;
    let status = res.status();
    let body = res.bytes().await.map_err(|e| format!("network: {e}"))?;
    // Yahoo returns a JSON error body with 404 for unknown symbols.
    if status.is_success() || status.as_u16() == 404 {
        Ok(body.to_vec())
    } else if status.as_u16() == 429 {
        Err("rate limited".into())
    } else {
        Err(format!("HTTP {status}"))
    }
}

pub async fn fetch_chart(client: &reqwest::Client, symbol: &str, range: &str) -> Result<Chart, String> {
    let (interval, prepost) = interval_for(range).ok_or("unknown range")?;
    let url = format!("{CHART_URL}/{}", symbol.trim().to_uppercase());
    let prepost = if prepost { "true" } else { "false" };
    let body = get(client, &url, &[("range", range), ("interval", interval), ("includePrePost", prepost)]).await?;
    parse_chart(&body, range, interval)
}

/// 1-minute 1d chart, for the freshest price and extended-hours value.
pub async fn fetch_quote(client: &reqwest::Client, symbol: &str, now: i64) -> Result<Quote, String> {
    let url = format!("{CHART_URL}/{}", symbol.trim().to_uppercase());
    let body = get(client, &url, &[("range", "1d"), ("interval", "1m"), ("includePrePost", "true")]).await?;
    Ok(quote_from(&parse_chart(&body, "1d", "1m")?, now))
}

pub async fn search(client: &reqwest::Client, q: &str) -> Result<Vec<SearchHit>, String> {
    let body = get(client, SEARCH_URL, &[("q", q), ("quotesCount", "8"), ("newsCount", "0")]).await?;
    parse_search(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: &[u8] = include_bytes!("../../fixtures/chart-1d-post.json");
    const MONTH: &[u8] = include_bytes!("../../fixtures/chart-1mo.json");
    const MISSING: &[u8] = include_bytes!("../../fixtures/chart-notfound.json");

    fn day() -> Chart {
        parse_chart(DAY, "1d", "5m").unwrap()
    }

    #[test]
    fn parses_meta_and_candles() {
        let c = day();
        assert_eq!(c.meta.symbol, "AAPL");
        assert_eq!(c.meta.name, "Apple Inc.");
        assert_eq!(c.meta.currency, "USD");
        assert_eq!(c.meta.prev_close, Some(329.4));
        assert!(c.meta.periods.is_some());
        assert!(!c.candles.is_empty());
        assert!(c.candles.windows(2).all(|w| w[0].t < w[1].t));
        assert!(c.candles.iter().all(|k| k.h >= k.l));
    }

    #[test]
    fn parses_daily_range() {
        let c = parse_chart(MONTH, "1mo", "1d").unwrap();
        assert!(c.candles.len() >= 15);
    }

    #[test]
    fn unknown_symbol_is_an_error() {
        let e = parse_chart(MISSING, "1d", "5m").unwrap_err();
        assert!(e.contains("No data found"), "{e}");
    }

    #[test]
    fn sessions() {
        let c = day();
        let p = c.meta.periods.unwrap();
        assert_eq!(session_at(Some(&p), p.pre.start), Session::Pre);
        assert_eq!(session_at(Some(&p), p.regular.start + 60), Session::Regular);
        assert_eq!(session_at(Some(&p), p.post.start), Session::Post);
        assert_eq!(session_at(Some(&p), p.post.end + 1), Session::Closed);
        assert_eq!(session_at(None, 0), Session::Closed);
    }

    #[test]
    fn regular_hours_have_no_extended_price() {
        let c = day();
        let p = c.meta.periods.unwrap();
        let q = quote_from(&c, p.regular.start + 600);
        assert_eq!(q.session, Session::Regular);
        assert!(q.extended.is_none());
        let change = q.change.unwrap();
        assert!((change - (333.02 - 329.4)).abs() < 1e-9);
        assert!(q.open.is_some());
    }

    #[test]
    fn after_hours_uses_last_post_candle() {
        let c = day();
        let p = c.meta.periods.unwrap();
        let last_post = c.candles.iter().rev().find(|k| p.post.contains(k.t)).unwrap();
        for now in [p.post.end - 1, p.post.end + 3600] {
            let q = quote_from(&c, now);
            let ext = q.extended.expect("after-hours price");
            assert_eq!(ext.label, "After hours");
            assert_eq!(ext.price, last_post.c);
            assert!((ext.change - (last_post.c - 333.02)).abs() < 1e-9);
        }
    }

    #[test]
    fn pre_market_uses_last_pre_candle() {
        let c = day();
        let p = c.meta.periods.unwrap();
        let q = quote_from(&c, p.pre.end - 1);
        let ext = q.extended.expect("pre-market price");
        assert_eq!(ext.label, "Pre-market");
        assert!(p.pre.contains(ext.t));
    }

    #[test]
    fn intervals() {
        for r in RANGES {
            assert!(interval_for(r).is_some(), "{r}");
        }
        assert_eq!(interval_for("1d"), Some(("5m", true)));
        assert!(interval_for("2h").is_none());
    }

    #[test]
    fn search_parses() {
        let body = br#"{"quotes":[{"symbol":"AAPL","longname":"Apple Inc.","exchDisp":"NASDAQ","typeDisp":"Equity"},{"shortname":"no symbol"}]}"#;
        let hits = parse_search(body).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "Apple Inc.");
        assert_eq!(hits[0].exchange, "NASDAQ");
    }
}

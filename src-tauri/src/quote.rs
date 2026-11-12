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

pub fn intervals_for(range: &str) -> &'static [&'static str] {
    match range {
        "1d" | "5d" => &["1m", "5m", "15m", "30m", "60m"],
        "1mo" => &["5m", "15m", "30m", "60m", "1d"],
        "6mo" | "ytd" | "1y" => &["60m", "1d", "1wk"],
        "5y" | "max" => &["1d", "1wk", "1mo"],
        _ => &[],
    }
}

pub fn resolve_interval(range: &str, interval: &str, extended: bool) -> Option<(&'static str, bool)> {
    let (default, default_prepost) = interval_for(range)?;
    Some(match intervals_for(range).iter().find(|&&i| i == interval) {
        Some(&i) => (i, extended && range == "1d" && i.ends_with('m')),
        None => (default, extended && default_prepost),
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
    pub timezone: String,
    pub periods: Option<Periods>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Chart {
    pub source: String,
    pub meta: Meta,
    pub range: String,
    pub interval: String,
    pub extended: bool,
    pub candles: Vec<Candle>,
    pub dividends: Vec<Dividend>,
    pub splits: Vec<Split>,
    pub last_bar_time: Option<i64>,
    pub delay_secs: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Dividend {
    pub t: i64,
    pub amount: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Split {
    pub t: i64,
    pub ratio: String,
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
    #[serde(skip)]
    pub periods: Option<Periods>,
    pub source: String,
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
    pub delay_secs: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SearchHit {
    pub symbol: String,
    pub name: String,
    pub exchange: String,
    pub kind: String,
    pub quote_type: String,
    pub currency: String,
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
        timezone: s(&m["exchangeTimezoneName"]),
        periods,
    };

    let ts = r["timestamp"].as_array().cloned().unwrap_or_default();
    let q = &r["indicators"]["quote"][0];
    let col = |k: &str, i: usize| f(&q[k][i]);
    let candles: Vec<Candle> = ts
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
    let events = |kind: &str| r["events"][kind].as_object().map(|o| o.values().cloned().collect::<Vec<_>>()).unwrap_or_default();
    let mut dividends: Vec<Dividend> = events("dividends")
        .iter()
        .filter_map(|d| Some(Dividend { t: d["date"].as_i64()?, amount: f(&d["amount"])? }))
        .collect();
    dividends.sort_by_key(|d| d.t);
    let mut splits: Vec<Split> = events("splits")
        .iter()
        .filter_map(|x| Some(Split { t: x["date"].as_i64()?, ratio: x["splitRatio"].as_str()?.to_string() }))
        .collect();
    splits.sort_by_key(|x| x.t);
    let last_bar_time = candles.last().map(|c| c.t);
    let delay_secs = yahoo_delay(&meta.symbol, &meta.exchange);
    Ok(Chart { source: "yahoo".into(), meta, range: range.into(), interval: interval.into(), extended: false, candles, dividends, splits, last_bar_time, delay_secs })
}

const YAHOO_DELAY_MINUTES: &[(&str, i64)] = &[
    ("CBT", 10), ("CME", 10), ("NYB", 30), ("CMX", 30), ("NYM", 30), ("BA", 30), ("VI", 15), ("AX", 20), ("XA", 0),
    ("BR", 15), ("SA", 15), ("CN", 0), ("NE", 0), ("TO", 0), ("V", 0), ("SN", 15), ("SS", 30), ("SZ", 30), ("CL", 20),
    ("PR", 20), ("CO", 0), ("CA", 20), ("TL", 0), ("XD", 0), ("NX", 15), ("HE", 0), ("PA", 15), ("BE", 15), ("BM", 15),
    ("DU", 15), ("F", 15), ("HM", 15), ("HA", 15), ("MU", 15), ("SG", 15), ("DE", 15), ("AT", 15), ("HK", 15), ("BD", 15),
    ("IC", 0), ("BO", 15), ("NS", 0), ("JK", 10), ("IR", 15), ("TA", 20), ("TI", 20), ("MI", 20), ("T", 20), ("KW", 15),
    ("RG", 0), ("VS", 0), ("KL", 15), ("MX", 20), ("AS", 15), ("NZ", 20), ("OL", 15), ("WA", 15), ("LS", 15), ("QA", 15),
    ("RO", 15), ("SI", 20), ("JO", 15), ("KS", 20), ("KQ", 20), ("MC", 15), ("SAU", 15), ("ST", 0), ("SW", 30), ("TWO", 20),
    ("TW", 20), ("BK", 15), ("IS", 15), ("AE", 15), ("AQ", 15), ("XC", 0), ("L", 20), ("IL", 20), ("CR", 15), ("VN", 15),
];

pub fn yahoo_delay(symbol: &str, exchange: &str) -> Option<i64> {
    let symbol = symbol.trim().to_ascii_uppercase();
    if let Some((_, suffix)) = symbol.rsplit_once('.') {
        return YAHOO_DELAY_MINUTES.iter().find(|(s, _)| *s == suffix).map(|(_, m)| m * 60);
    }
    if symbol.ends_with("=X") || (exchange.starts_with("Nasdaq") && !symbol.starts_with('^')) {
        return Some(0);
    }
    None
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
        periods: m.periods,
        source: chart.source.clone(),
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
        delay_secs: chart.delay_secs,
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
                quote_type: s(&q["quoteType"]),
                currency: s(&q["currency"]),
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

pub async fn fetch_chart(client: &reqwest::Client, symbol: &str, range: &str, interval: &str, extended: bool) -> Result<Chart, String> {
    let (interval, prepost) = resolve_interval(range, interval, extended).ok_or("unknown range")?;
    let url = format!("{CHART_URL}/{}", symbol.trim().to_uppercase());
    let flag = if prepost { "true" } else { "false" };
    let query = [("range", range), ("interval", interval), ("includePrePost", flag), ("events", "div,split")];
    let body = get(client, &url, &query).await?;
    let mut chart = parse_chart(&body, range, interval)?;
    chart.extended = prepost;
    Ok(chart)
}

pub const PERIOD_RANGE: &str = "period";
pub const PERIOD_INTERVALS: [&str; 3] = ["60m", "1d", "1wk"];

pub fn period_query(interval: &str, start: i64, end: i64) -> Result<[(&'static str, String); 5], String> {
    let interval = PERIOD_INTERVALS.iter().find(|&&i| i == interval).ok_or("unsupported interval for a date range")?;
    if start <= 0 || end <= start {
        return Err("bad date range".into());
    }
    Ok([
        ("period1", start.to_string()),
        ("period2", end.to_string()),
        ("interval", (*interval).to_string()),
        ("includePrePost", "false".into()),
        ("events", "div,split".into()),
    ])
}

pub fn parse_period(body: &[u8], interval: &str, start: i64, end: i64) -> Result<Chart, String> {
    let mut chart = parse_chart(body, PERIOD_RANGE, interval)?;
    trim_period(&mut chart, start, end);
    Ok(chart)
}

pub fn trim_period(chart: &mut Chart, start: i64, end: i64) {
    chart.candles.retain(|c| c.t >= start && c.t < end);
    chart.dividends.retain(|d| d.t >= start && d.t < end);
    chart.splits.retain(|s| s.t >= start && s.t < end);
    chart.last_bar_time = chart.candles.last().map(|c| c.t);
}

pub async fn fetch_period(client: &reqwest::Client, symbol: &str, interval: &str, start: i64, end: i64) -> Result<Chart, String> {
    let query = period_query(interval, start, end)?;
    let url = format!("{CHART_URL}/{}", symbol.trim().to_uppercase());
    let pairs: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let body = get(client, &url, &pairs).await?;
    parse_period(&body, interval, start, end)
}

pub const OLDER_INTERVALS: [&str; 8] = ["1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"];

pub async fn fetch_older(client: &reqwest::Client, symbol: &str, interval: &str, start: i64, end: i64, extended: bool) -> Result<Chart, String> {
    let interval = *OLDER_INTERVALS.iter().find(|&&i| i == interval).ok_or("unsupported interval")?;
    if start <= 0 || end <= start {
        return Err("bad date range".into());
    }
    let url = format!("{CHART_URL}/{}", symbol.trim().to_uppercase());
    let (from, to) = (start.to_string(), end.to_string());
    let prepost = extended && interval.ends_with('m');
    let query = [
        ("period1", from.as_str()),
        ("period2", to.as_str()),
        ("interval", interval),
        ("includePrePost", if prepost { "true" } else { "false" }),
        ("events", "div,split"),
    ];
    let body = get(client, &url, &query).await?;
    let mut chart = parse_chart(&body, PERIOD_RANGE, interval)?;
    trim_period(&mut chart, start, end);
    chart.extended = prepost;
    Ok(chart)
}

/// 1-minute 1d chart, for the freshest price and extended-hours value.
pub async fn fetch_quote(client: &reqwest::Client, symbol: &str, now: i64) -> Result<Quote, String> {
    let url = format!("{CHART_URL}/{}", symbol.trim().to_uppercase());
    let body = get(client, &url, &[("range", "1d"), ("interval", "1m"), ("includePrePost", "true")]).await?;
    Ok(quote_from(&parse_chart(&body, "1d", "1m")?, now))
}

const SEARCH_COUNT: &str = "20";

pub async fn search(client: &reqwest::Client, q: &str) -> Result<Vec<SearchHit>, String> {
    let body = get(client, SEARCH_URL, &[("q", q), ("quotesCount", SEARCH_COUNT), ("newsCount", "0")]).await?;
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
    fn parses_dividends_and_splits() {
        let c = parse_chart(include_bytes!("../../fixtures/chart-5y-events.json"), "5y", "1wk").unwrap();
        assert_eq!(c.dividends.len(), 20);
        assert!(c.dividends.windows(2).all(|w| w[0].t < w[1].t));
        assert_eq!(c.dividends[0], Dividend { t: 1636119000, amount: 0.22 });
        assert!(c.splits.is_empty());
        let body = br#"{"chart":{"result":[{"meta":{"regularMarketPrice":1},"events":{"splits":{
            "1598880600":{"date":1598880600,"numerator":4,"denominator":1,"splitRatio":"4:1"}}}}]}}"#;
        let c = parse_chart(body, "max", "1mo").unwrap();
        assert_eq!(c.splits, [Split { t: 1598880600, ratio: "4:1".into() }]);
        assert!(day().dividends.is_empty());
    }

    #[test]
    fn parses_daily_range() {
        let c = parse_chart(MONTH, "1mo", "1d").unwrap();
        assert!(c.candles.len() >= 15);
    }

    #[test]
    fn carries_bar_time_and_delay() {
        let c = day();
        assert_eq!(c.last_bar_time, c.candles.last().map(|k| k.t));
        assert_eq!(c.delay_secs, Some(0));
        let p = c.meta.periods.unwrap();
        let q = quote_from(&c, p.regular.start + 600);
        assert_eq!(q.market_time, c.meta.market_time);
        assert_eq!(q.delay_secs, Some(0));
        let body = br#"{"chart":{"result":[{"meta":{"regularMarketPrice":1,"symbol":"X"}}]}}"#;
        let empty = parse_chart(body, "1d", "5m").unwrap();
        assert_eq!(empty.last_bar_time, None);
        assert_eq!(empty.meta.market_time, 0);
    }

    #[test]
    fn yahoo_delay_only_when_published() {
        assert_eq!(yahoo_delay("AAPL", "NasdaqGS"), Some(0));
        assert_eq!(yahoo_delay("VOD.L", "LSE"), Some(1200));
        assert_eq!(yahoo_delay("SAP.DE", "XETRA"), Some(900));
        assert_eq!(yahoo_delay("SHOP.TO", "Toronto"), Some(0));
        assert_eq!(yahoo_delay("IBM", "NYSE"), None);
        assert_eq!(yahoo_delay("ZZZ.QQ", "Unknown"), None);
        assert_eq!(yahoo_delay("^IXIC", "Nasdaq GIDS"), None);
        assert_eq!(yahoo_delay("EURUSD=X", "CCY"), Some(0));
    }

    #[test]
    fn parses_a_date_range() {
        let body: &[u8] = include_bytes!("../../fixtures/chart-period-1d.json");
        let c = parse_period(body, "1d", 1735689600, 1743465600).unwrap();
        assert_eq!(c.range, PERIOD_RANGE);
        assert_eq!(c.interval, "1d");
        assert!(!c.extended);
        assert_eq!(c.meta.symbol, "AAPL");
        assert_eq!(c.candles.len(), 60);
        assert_eq!(c.candles[0].t, 1735828200);
        assert_eq!(c.last_bar_time, Some(1743427800));
        assert!(c.candles.windows(2).all(|w| w[0].t < w[1].t));
        assert_eq!(c.dividends, [Dividend { t: 1739197800, amount: 0.25 }]);
        let trimmed = parse_period(body, "1d", 1736000000, 1739197800).unwrap();
        assert!(trimmed.candles.iter().all(|k| k.t >= 1736000000 && k.t < 1739197800));
        assert!(trimmed.candles.len() < 60 && !trimmed.candles.is_empty());
        assert!(trimmed.dividends.is_empty());
        assert_eq!(trimmed.last_bar_time, trimmed.candles.last().map(|k| k.t));
        let json = serde_json::to_value(&c).unwrap();
        assert_eq!(json["range"], "period");
        assert!(json["candles"][0]["o"].is_f64());
    }

    #[test]
    fn date_range_query() {
        let q = period_query("1d", 100, 200).unwrap();
        assert_eq!(q[0], ("period1", "100".to_string()));
        assert_eq!(q[1], ("period2", "200".to_string()));
        assert_eq!(q[2], ("interval", "1d".to_string()));
        assert_eq!(q[3], ("includePrePost", "false".to_string()));
        for i in PERIOD_INTERVALS { assert!(period_query(i, 1, 2).is_ok()); }
        assert!(period_query("5m", 100, 200).is_err());
        assert!(period_query("1d", 200, 200).is_err());
        assert!(period_query("1d", 0, 200).is_err());
        assert!(resolve_interval(PERIOD_RANGE, "1d", false).is_none());
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
    fn supported_intervals() {
        for range in ["1d", "5d"] {
            assert_eq!(intervals_for(range), ["1m", "5m", "15m", "30m", "60m"]);
        }
        assert_eq!(intervals_for("1mo"), ["5m", "15m", "30m", "60m", "1d"]);
        for range in ["6mo", "ytd", "1y"] {
            assert_eq!(intervals_for(range), ["60m", "1d", "1wk"]);
        }
        for range in ["5y", "max"] {
            assert_eq!(intervals_for(range), ["1d", "1wk", "1mo"]);
        }
        assert!(intervals_for("2h").is_empty());
    }

    #[test]
    fn resolves_intervals_and_falls_back_to_auto() {
        for (range, expected) in RANGES.into_iter().zip(["5m", "15m", "60m", "1d", "1d", "1d", "1wk", "1mo"]) {
            assert_eq!(resolve_interval(range, "auto", true), Some((expected, range == "1d")));
            assert_eq!(resolve_interval(range, "invalid", true), interval_for(range));
            for &interval in intervals_for(range) {
                assert_eq!(resolve_interval(range, interval, true), Some((interval, range == "1d")));
            }
        }
        assert_eq!(resolve_interval("1y", "5m", true), Some(("1d", false)));
        assert_eq!(resolve_interval("1d", "1d", true), Some(("5m", true)));
        assert_eq!(resolve_interval("2h", "auto", true), None);
        assert_eq!(resolve_interval("2h", "1m", true), None);
    }

    #[test]
    fn extended_hours_off_drops_prepost_everywhere() {
        for range in RANGES {
            assert_eq!(resolve_interval(range, "auto", false).map(|(i, _)| i), interval_for(range).map(|(i, _)| i));
            for interval in ["auto", "invalid"].into_iter().chain(intervals_for(range).iter().copied()) {
                assert!(!resolve_interval(range, interval, false).unwrap().1, "{range} {interval}");
            }
        }
        assert_eq!(resolve_interval("1d", "1m", false), Some(("1m", false)));
        assert_eq!(resolve_interval("1d", "1m", true), Some(("1m", true)));
    }

    #[test]
    fn carries_exchange_timezone() {
        let c = day();
        assert_eq!(c.meta.timezone, "America/New_York");
        assert!(!c.extended);
        let body = br#"{"chart":{"result":[{"meta":{"regularMarketPrice":1,"symbol":"X"}}]}}"#;
        assert_eq!(parse_chart(body, "1d", "5m").unwrap().meta.timezone, "");
    }

    #[test]
    fn search_parses() {
        let body = br#"{"quotes":[{"symbol":"AAPL","longname":"Apple Inc.","exchDisp":"NASDAQ","typeDisp":"Equity"},{"shortname":"no symbol"}]}"#;
        let hits = parse_search(body).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "Apple Inc.");
        assert_eq!(hits[0].exchange, "NASDAQ");
        assert_eq!(hits[0].quote_type, "");
        assert_eq!(hits[0].currency, "");
    }

    #[test]
    fn search_carries_type_and_listing_fields() {
        let hits = parse_search(include_bytes!("../../fixtures/search-shop.json")).unwrap();
        let rows: Vec<_> = hits.iter().map(|h| (h.symbol.as_str(), h.exchange.as_str(), h.quote_type.as_str(), h.kind.as_str())).collect();
        assert_eq!(rows.len(), 7);
        assert_eq!(rows[0], ("SHOP", "NASDAQ", "EQUITY", "Equity"));
        assert_eq!(rows[1], ("SHOP.TO", "Toronto", "EQUITY", "Equity"));
        assert_eq!(rows[2], ("SHPU", "NASDAQ", "ETF", "ETF"));
        assert_eq!(hits[1].name, "Shopify Inc.");
        assert_eq!(hits[2].name, "Direxion Daily SHOP Bull 2X ETF");
        assert!(hits.iter().all(|h| h.currency.is_empty()));
    }

    #[test]
    fn search_passes_currency_through_when_present() {
        let body = br#"{"quotes":[{"symbol":"BTC-USD","quoteType":"CRYPTOCURRENCY","currency":"USD"},{"symbol":"X","quoteType":null,"currency":5}]}"#;
        let hits = parse_search(body).unwrap();
        assert_eq!((hits[0].quote_type.as_str(), hits[0].currency.as_str()), ("CRYPTOCURRENCY", "USD"));
        assert_eq!((hits[1].quote_type.as_str(), hits[1].currency.as_str()), ("", ""));
    }
}

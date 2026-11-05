use std::path::Path;
use serde_json::Value;
use crate::provider::Feed;
use crate::quote::{Candle, Chart, Extended, Meta, Quote, Session};

const KEY_ID: &str = "TICKR_ALPACA_KEY_ID";
const SECRET: &str = "TICKR_ALPACA_SECRET";

#[derive(Clone, PartialEq, Eq)]
pub struct AlpacaCreds { pub key_id: String, pub secret: String }

pub fn validate_key(value: &str) -> Result<(), String> {
    if (1..=128).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_alphanumeric()) { Ok(()) }
    else { Err("Keys must contain 1 to 128 ASCII letters or digits".into()) }
}

pub fn load_keys(path: &Path) -> Option<AlpacaCreds> {
    let text = std::fs::read_to_string(path).ok()?;
    let keys = AlpacaCreds { key_id: crate::ai::env_get(&text, KEY_ID)?, secret: crate::ai::env_get(&text, SECRET)? };
    validate_key(&keys.key_id).ok()?;
    validate_key(&keys.secret).ok()?;
    Some(keys)
}

pub fn save_keys(path: &Path, keys: Option<&AlpacaCreds>) -> std::io::Result<()> {
    crate::ai::save_env(path, &[(KEY_ID, keys.map_or("", |k| k.key_id.as_str())), (SECRET, keys.map_or("", |k| k.secret.as_str()))])
}

async fn get(client: &reqwest::Client, keys: &AlpacaCreds, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    let response = client.get(format!("https://data.alpaca.markets{path}"))
        .header("APCA-API-KEY-ID", &keys.key_id).header("APCA-API-SECRET-KEY", &keys.secret)
        .query(query).send().await.map_err(|_| "Alpaca network error")?;
    let status = response.status();
    if !status.is_success() { return Err(format!("Alpaca HTTP {}", status.as_u16())); }
    let body = response.bytes().await.map_err(|_| "Alpaca response error")?;
    serde_json::from_slice(&body).map_err(|_| "Invalid Alpaca response".into())
}

pub async fn snapshot(client: &reqwest::Client, keys: &AlpacaCreds, feed: Feed, symbol: &str) -> Result<Value, String> {
    get(client, keys, &format!("/v2/stocks/{symbol}/snapshot"), &[("feed", feed.name())]).await
}

fn number(v: &Value) -> Option<f64> { v.as_f64().filter(|n| n.is_finite()) }

pub fn trade(quote: &mut Quote, price: f64, t: i64, feed: Feed) {
    if matches!(quote.session, Session::Pre | Session::Post) || (quote.session == Session::Closed && quote.extended.is_some()) {
        let change = price - quote.price;
        quote.extended = Some(Extended {
            label: if quote.session == Session::Pre { "Pre-market" } else { "After hours" },
            price, change, change_pct: if quote.price != 0.0 { change / quote.price * 100.0 } else { 0.0 }, t,
        });
    } else {
        quote.extended = None;
        quote.price = price;
        quote.change = quote.prev_close.map(|p| price - p);
        quote.change_pct = quote.prev_close.filter(|p| *p != 0.0).map(|p| (price - p) / p * 100.0);
        quote.market_time = t;
    }
    quote.source = feed.source().into();
    quote.delay_secs = Some(0);
}

pub fn overlay(quote: &mut Quote, v: &Value, feed: Feed) -> Result<(), String> {
    let price = number(&v["latestTrade"]["p"]).filter(|p| *p > 0.0).ok_or("Missing Alpaca trade")?;
    let t = v["latestTrade"]["t"].as_str().and_then(parse_time).unwrap_or(quote.market_time);
    quote.open = number(&v["dailyBar"]["o"]).or(quote.open);
    quote.day_high = number(&v["dailyBar"]["h"]).or(quote.day_high);
    quote.day_low = number(&v["dailyBar"]["l"]).or(quote.day_low);
    quote.prev_close = number(&v["prevDailyBar"]["c"]).or(quote.prev_close);
    quote.change = quote.prev_close.map(|p| quote.price - p);
    quote.change_pct = quote.prev_close.filter(|p| *p != 0.0).map(|p| (quote.price - p) / p * 100.0);
    trade(quote, price, t, feed);
    Ok(())
}

fn leap(y: i64) -> bool { y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) }
fn month_days(y: i64, m: i64) -> i64 { match m { 2 => if leap(y) { 29 } else { 28 }, 4 | 6 | 9 | 11 => 30, _ => 31 } }
fn days_before_year(y: i64) -> i64 { let y = y - 1; 365 * y + y / 4 - y / 100 + y / 400 }

pub fn parse_time(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || !s.is_ascii() || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' { return None; }
    let n = |a: usize, z: usize| -> Option<i64> {
        if !b[a..z].iter().all(u8::is_ascii_digit) { return None; }
        s[a..z].parse().ok()
    };
    let (y, m, d, h, min, sec) = (n(0,4)?, n(5,7)?, n(8,10)?, n(11,13)?, n(14,16)?, n(17,19)?);
    if y < 1 || !(1..=12).contains(&m) || !(1..=month_days(y,m)).contains(&d) || h > 23 || min > 59 || sec > 59 { return None; }
    let tail = &s[19..];
    let zone = if let Some(fraction) = tail.strip_prefix('.') {
        let len = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if len == 0 { return None; }
        &fraction[len..]
    } else { tail };
    let offset = if zone == "Z" { 0 } else {
        let z = zone.as_bytes();
        if z.len() != 6 || !matches!(z[0], b'+' | b'-') || z[3] != b':' || ![z[1],z[2],z[4],z[5]].iter().all(u8::is_ascii_digit) { return None; }
        let h: i64 = zone[1..3].parse().ok()?;
        let m: i64 = zone[4..6].parse().ok()?;
        if h > 23 || m > 59 { return None; }
        (h*3600 + m*60) * if z[0] == b'+' { 1 } else { -1 }
    };
    let days = days_before_year(y) - days_before_year(1970) + (1..m).map(|m| month_days(y,m)).sum::<i64>() + d - 1;
    Some(days*86400 + h*3600 + min*60 + sec - offset)
}

pub fn format_time(t: i64) -> String {
    let mut days = t.div_euclid(86400);
    let mut y = 1970;
    while days < 0 { y -= 1; days += if leap(y) {366} else {365}; }
    while days >= if leap(y) {366} else {365} { days -= if leap(y) {366} else {365}; y += 1; }
    let mut m = 1;
    while days >= month_days(y,m) { days -= month_days(y,m); m += 1; }
    let seconds = t.rem_euclid(86400);
    format!("{y:04}-{m:02}-{:02}T{:02}:{:02}:{:02}Z", days+1, seconds/3600, seconds/60%60, seconds%60)
}

pub fn parse_bars(v: &Value) -> Result<Vec<Candle>, String> {
    v["bars"].as_array().ok_or_else(|| "Missing Alpaca bars".to_string())?.iter().map(|b| {
        let candle = || Some(Candle { t: parse_time(b["t"].as_str()?)?, o: number(&b["o"])?, h: number(&b["h"])?, l: number(&b["l"])?, c: number(&b["c"])?, v: number(&b["v"])? });
        candle().ok_or_else(|| "Invalid Alpaca bar".into())
    }).collect()
}

pub fn regular_bar(t: i64, meta: &Meta) -> bool {
    if let Some(p) = meta.periods {
        if (t + meta.gmtoffset).div_euclid(86400) == (p.regular.start + meta.gmtoffset).div_euclid(86400) {
            return t >= p.regular.start && t < p.regular.end;
        }
    }
    let seconds = (t + meta.gmtoffset).rem_euclid(86400);
    (34200..57600).contains(&seconds)
}

pub fn next_page(v: &Value, page: usize) -> Option<&str> {
    if page >= 9 { return None; }
    v["next_page_token"].as_str().filter(|s| !s.is_empty())
}

pub async fn bars(client: &reqwest::Client, keys: &AlpacaCreds, feed: Feed, chart: &Chart) -> Result<Vec<Candle>, String> {
    let start = format_time(chart.candles.first().ok_or("No Yahoo candles")?.t);
    let timeframe = match chart.interval.as_str() {
        "1m" => "1Min", "5m" => "5Min", "15m" => "15Min", "30m" => "30Min", "60m" => "1Hour", "1d" => "1Day", "1wk" => "1Week", "1mo" => "1Month", _ => return Err("Unknown interval".into()),
    };
    let prepost = crate::quote::resolve_interval(&chart.range, &chart.interval).is_some_and(|(_, p)| p);
    let intraday = chart.interval.ends_with('m');
    let mut token = String::new();
    let mut candles = Vec::new();
    for page in 0..10 {
        let mut query = vec![("timeframe", timeframe), ("start", &start), ("adjustment", "split"), ("limit", "10000"), ("feed", feed.name())];
        if !token.is_empty() { query.push(("page_token", &token)); }
        let v = get(client, keys, &format!("/v2/stocks/{}/bars", chart.meta.symbol), &query).await?;
        candles.extend(parse_bars(&v)?.into_iter().filter(|b| !intraday || prepost || regular_bar(b.t, &chart.meta)));
        match next_page(&v, page) { Some(next) if next != token => token = next.to_string(), _ => break }
    }
    candles.sort_by_key(|b| b.t);
    candles.dedup_by_key(|b| b.t);
    Ok(candles)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn chart() -> Chart { crate::quote::parse_chart(include_bytes!("../../fixtures/chart-1d-post.json"), "1d", "5m").unwrap() }
    const SNAPSHOT: &str = r#"{"latestTrade":{"p":340,"t":"2026-01-02T21:30:00.123456789Z"},"dailyBar":{"o":330,"h":345,"l":325,"c":339,"v":10},"prevDailyBar":{"c":320}}"#;

    #[test]
    fn snapshot_sessions_and_volume() {
        let c = chart();
        let periods = c.meta.periods.unwrap();
        for (now, extended) in [(periods.regular.start, false), (periods.post.start, true), (periods.pre.start, true)] {
            let mut q = crate::quote::quote_from(&c, now);
            let original_price = q.price;
            let original_volume = q.volume;
            overlay(&mut q, &serde_json::from_str(SNAPSHOT).unwrap(), Feed::Iex).unwrap();
            assert_eq!(q.volume, original_volume);
            assert_eq!(q.open, Some(330.0));
            assert_eq!(q.day_high, Some(345.0));
            assert_eq!(q.day_low, Some(325.0));
            assert_eq!(q.prev_close, Some(320.0));
            assert_eq!(q.source, "alpaca-iex");
            assert_eq!(q.delay_secs, Some(0));
            if extended {
                assert_eq!(q.price, original_price);
                let ext = q.extended.unwrap();
                assert_eq!(ext.price, 340.0);
                assert_eq!(ext.change, 340.0-original_price);
            } else {
                assert_eq!(q.price, 340.0);
                assert_eq!(q.change, Some(20.0));
                assert_eq!(q.change_pct, Some(6.25));
            }
        }
    }

    #[test]
    fn stream_trade_session_transition() {
        let c = chart();
        let p = c.meta.periods.unwrap();
        let mut q = crate::quote::quote_from(&c, p.pre.start);
        trade(&mut q, 340.0, p.pre.start, Feed::Sip);
        assert!(q.extended.is_some());
        q.session = Session::Regular;
        trade(&mut q, 341.0, p.regular.start, Feed::Sip);
        assert_eq!(q.price, 341.0);
        assert!(q.extended.is_none());
        assert_eq!(q.source, "alpaca-sip");
        q.session = Session::Post;
        trade(&mut q, 342.0, p.post.start, Feed::Sip);
        assert_eq!(q.price, 341.0);
        assert_eq!(q.extended.unwrap().change, 1.0);
    }

    #[test]
    fn failed_overlay_preserves_yahoo_source_and_values() {
        let c = chart();
        let mut q = crate::quote::quote_from(&c, c.meta.market_time);
        let original = q.clone();
        assert!(overlay(&mut q, &serde_json::json!({"latestTrade":null,"dailyBar":{"o":1}}), Feed::Sip).is_err());
        assert_eq!(q, original);
        assert_eq!(q.source, "yahoo");
        assert_eq!(c.source, "yahoo");
    }

    #[test]
    fn timestamps() {
        for (text, t) in [("1970-01-01T00:00:00Z",0), ("1969-12-31T23:59:59Z",-1), ("2000-02-29T12:34:56Z",951827696), ("2026-01-02T15:00:00Z",1767366000)] {
            assert_eq!(parse_time(text), Some(t));
            assert_eq!(format_time(t), text);
        }
        assert_eq!(parse_time("1970-01-01T00:00:00.123456789Z"), Some(0));
        assert_eq!(parse_time("1970-01-01T01:30:00+01:30"), Some(0));
        for text in ["", "garbage", "1970-01-01T00:00:00Zgarbage", "1970-01-01T00:00:00.Z", "2025-02-29T00:00:00Z", "1900-02-29T00:00:00Z", "2026-00-01T00:00:00Z", "2026-01-00T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z", "2026-01-01T00:00:60Z", "2026-01-01T00:00:00+24:00", "2026-01-01T00:00:00", "??????????"] { assert!(parse_time(text).is_none(), "{text}"); }
    }

    #[test]
    fn bars_and_page_limit() {
        let v: Value = serde_json::from_str(r#"{"bars":[{"t":"2026-01-02T15:00:00Z","o":1,"h":3,"l":1,"c":2,"v":42}],"next_page_token":"next"}"#).unwrap();
        let parsed = parse_bars(&v).unwrap();
        assert_eq!(parsed, vec![Candle { t: parse_time("2026-01-02T15:00:00Z").unwrap(), o:1.0,h:3.0,l:1.0,c:2.0,v:42.0 }]);
        assert_eq!(next_page(&v,0), Some("next"));
        assert_eq!(next_page(&v,8), Some("next"));
        assert_eq!(next_page(&v,9), None);
        assert_eq!(next_page(&serde_json::json!({"next_page_token": null}),0), None);
        assert_eq!(next_page(&serde_json::json!({"next_page_token": ""}),0), None);
        assert!(parse_bars(&serde_json::json!({"bars":[]})).unwrap().is_empty());
        assert!(parse_bars(&serde_json::json!({"bars":[{"t":"bad"}]})).is_err());
    }

    #[test]
    fn session_filter() {
        let c = chart();
        let p = c.meta.periods.unwrap();
        assert!(!regular_bar(p.regular.start-1, &c.meta));
        assert!(regular_bar(p.regular.start, &c.meta));
        assert!(regular_bar(p.regular.end-1, &c.meta));
        assert!(!regular_bar(p.regular.end, &c.meta));
        let mut meta = c.meta;
        meta.gmtoffset = -18000;
        for (time, keep) in [("2020-01-02T14:29:59Z",false),("2020-01-02T14:30:00Z",true),("2020-01-02T20:59:59Z",true),("2020-01-02T21:00:00Z",false)] {
            assert_eq!(regular_bar(parse_time(time).unwrap(), &meta),keep);
        }
        meta.periods.as_mut().unwrap().regular.end = p.regular.start + 3600;
        assert!(!regular_bar(p.regular.start+3600,&meta));
    }

    #[test]
    fn keys_validation_and_env_preservation() {
        for value in ["", "a b", "a\nb", "a\rb", "a=b", "é", &"x".repeat(129)] { assert!(validate_key(value).is_err()); }
        for value in ["a", "TESTONLY", &"x".repeat(128)] { assert!(validate_key(value).is_ok()); }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".env.local");
        let ai = crate::ai::AiConfig { api_key: "test only AI secret".into(), model: "test".into(), ..Default::default() };
        crate::ai::save_config(&path,&ai).unwrap();
        let keys = AlpacaCreds { key_id: "TESTONLY".into(), secret: "TESTONLYSECRET".into() };
        save_keys(&path,Some(&keys)).unwrap();
        assert_eq!(crate::ai::load_config(&path),ai);
        crate::ai::save_config(&path,&ai).unwrap();
        assert!(load_keys(&path).is_some_and(|k| k == keys));
        save_keys(&path,None).unwrap();
        assert!(load_keys(&path).is_none());
        assert_eq!(crate::ai::load_config(&path),ai);
    }
}

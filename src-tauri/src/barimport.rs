use std::path::{Path, PathBuf};
use serde::Serialize;
use crate::barcache;
use crate::quote::{Candle, Meta};

pub const INTERVALS: [(&str, i64); 3] = [("1m", 60), ("5m", 300), ("15m", 900)];
pub const MAX_ROWS: usize = 3_000_000;
pub const WINDOW: usize = 2_000;
const PREFIX: &str = "import";
const DAY: i64 = 86_400;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Series {
    pub symbol: String,
    pub interval: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Imported {
    pub symbol: String,
    pub interval: String,
    pub bars: usize,
    pub first: i64,
    pub last: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub symbol: Option<String>,
    pub interval: &'static str,
    pub candles: Vec<Candle>,
}

pub fn dir(settings_path: &Path) -> PathBuf {
    settings_path.with_file_name("imports")
}

pub fn secs(interval: &str) -> Option<i64> {
    INTERVALS.iter().find(|(i, _)| *i == interval).map(|(_, s)| *s)
}

pub fn fetch_span(interval: &str) -> i64 {
    if interval == "1m" { 7 * DAY } else { 59 * DAY }
}

fn key(symbol: &str, interval: &str) -> String {
    barcache::key(PREFIX, symbol, interval, false)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

// shortcut: a timestamp without an offset is read as UTC (Alpaca's export default); add a time zone option if local-time CSVs show up.
pub fn parse_time(s: &str) -> Option<i64> {
    if let Ok(n) = s.parse::<i64>() {
        return Some(if n > 100_000_000_000 { n / 1000 } else { n });
    }
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || !matches!(b[10], b' ' | b'T') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r).filter(|x| x.bytes().all(|c| c.is_ascii_digit()))?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    let mut rest = &s[19..];
    if let Some(r) = rest.strip_prefix('.') {
        rest = r.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    let offset = match rest {
        "" | "Z" | "z" => 0,
        _ => {
            let sign = match rest.as_bytes()[0] { b'+' => 1, b'-' => -1, _ => return None };
            let digits: String = rest[1..].chars().filter(|c| *c != ':').collect();
            if digits.len() != 4 || !digits.bytes().all(|c| c.is_ascii_digit()) {
                return None;
            }
            sign * (digits[..2].parse::<i64>().ok()? * 3600 + digits[2..].parse::<i64>().ok()? * 60)
        }
    };
    Some(days_from_civil(y, mo, d) * DAY + h * 3600 + mi * 60 + se - offset)
}

pub fn detect(candles: &[Candle]) -> Option<&'static str> {
    let mut counts = [0usize; INTERVALS.len()];
    for w in candles.windows(2) {
        if let Some(k) = INTERVALS.iter().position(|(_, s)| w[1].t - w[0].t == *s) {
            counts[k] += 1;
        }
    }
    let (k, n) = counts.iter().enumerate().max_by_key(|(_, n)| **n)?;
    (*n > 0).then_some(INTERVALS[k].0)
}

pub fn parse_csv(text: &str) -> Result<Parsed, String> {
    let mut lines = text.lines().enumerate().filter(|(_, l)| !l.trim().is_empty());
    let header: Vec<String> = lines.next().ok_or("The CSV is empty")?.1.split(',').map(|h| h.trim().trim_matches('"').to_ascii_lowercase()).collect();
    let col = |names: &[&str]| header.iter().position(|h| names.contains(&h.as_str()));
    let tc = col(&["timestamp", "time", "datetime", "date", "t"]).ok_or("The CSV needs a timestamp column")?;
    let (Some(oc), Some(hc), Some(lc), Some(cc)) = (col(&["open", "o"]), col(&["high", "h"]), col(&["low", "l"]), col(&["close", "c"])) else {
        return Err("The CSV needs open, high, low and close columns".into());
    };
    let (vc, sc) = (col(&["volume", "v"]), col(&["symbol"]));
    let mut symbol = None;
    let mut candles = Vec::new();
    for (n, line) in lines {
        if candles.len() >= MAX_ROWS {
            return Err(format!("The CSV has more than {MAX_ROWS} rows"));
        }
        let f: Vec<&str> = line.split(',').map(|x| x.trim().trim_matches('"')).collect();
        let num = |i: usize| f.get(i).and_then(|x| x.parse::<f64>().ok()).filter(|x| x.is_finite());
        let bad = || format!("Line {} is not a valid bar", n + 1);
        let t = f.get(tc).and_then(|x| parse_time(x)).ok_or_else(bad)?;
        let (Some(o), Some(h), Some(l), Some(c)) = (num(oc), num(hc), num(lc), num(cc)) else { return Err(bad()) };
        let v = match vc { Some(i) => num(i).ok_or_else(bad)?, None => 0.0 };
        if !(o > 0.0 && c > 0.0 && l > 0.0 && h >= l && v >= 0.0) {
            return Err(bad());
        }
        if symbol.is_none() {
            symbol = sc.and_then(|i| f.get(i)).filter(|s| !s.is_empty()).map(|s| s.to_string());
        }
        candles.push(Candle { t, o, h, l, c, v });
    }
    candles.sort_by_key(|c| c.t);
    candles.dedup_by_key(|c| c.t);
    let interval = detect(&candles).ok_or("Only 1-minute, 5-minute or 15-minute bars can be imported")?;
    Ok(Parsed { symbol, interval, candles })
}

pub fn clean_symbol(raw: &str) -> Result<String, String> {
    let s = raw.trim().to_uppercase();
    if (1..=16).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-')) {
        Ok(s)
    } else {
        Err(format!("Could not tell the symbol from \"{raw}\"; name the file like QQQ_5m.csv"))
    }
}

fn file_symbol(name: &str) -> &str {
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    stem.split(['_', ' ']).next().unwrap_or(stem)
}

pub fn merge(cached: &[Candle], fresh: &[Candle]) -> Vec<Candle> {
    let mut out = [fresh, cached].concat();
    out.sort_by_key(|c| c.t);
    out.dedup_by_key(|c| c.t);
    out
}

pub fn import(dir: &Path, name: &str, text: &str) -> Result<Imported, String> {
    let parsed = parse_csv(text)?;
    let symbol = clean_symbol(parsed.symbol.as_deref().unwrap_or_else(|| file_symbol(name)))?;
    let key = key(&symbol, parsed.interval);
    let bars = merge(&barcache::load(dir, &key), &parsed.candles);
    barcache::write(dir, &key, &bars).map_err(|e| format!("Could not save the imported bars: {e}"))?;
    Ok(Imported { symbol, interval: parsed.interval.into(), bars: bars.len(), first: bars[0].t, last: bars[bars.len() - 1].t })
}

pub fn list(dir: &Path) -> Vec<Series> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<Series> = entries
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter_map(|n| {
            let (symbol, interval) = n.strip_suffix(".json")?.strip_prefix(PREFIX)?.strip_prefix('_')?.rsplit_once('_')?;
            secs(interval)?;
            Some(Series { symbol: symbol.into(), interval: interval.into() })
        })
        .collect();
    out.sort_by(|a, b| (&a.symbol, secs(&a.interval)).cmp(&(&b.symbol, secs(&b.interval))));
    out
}

pub fn resample(bars: &[Candle], secs: i64) -> Vec<Candle> {
    let mut out: Vec<Candle> = Vec::new();
    for b in bars {
        let t = b.t - b.t.rem_euclid(secs);
        match out.last_mut() {
            Some(x) if x.t == t => {
                x.h = x.h.max(b.h);
                x.l = x.l.min(b.l);
                x.c = b.c;
                x.v += b.v;
            }
            _ => out.push(Candle { t, ..*b }),
        }
    }
    out
}

pub fn load(dir: &Path, symbol: &str, interval: &str) -> Vec<Candle> {
    let Some(want) = secs(interval) else { return Vec::new() };
    for (finer, s) in INTERVALS.iter().rev().filter(|(_, s)| *s <= want && want % s == 0) {
        let bars = barcache::load(dir, &key(symbol, finer));
        if !bars.is_empty() {
            return if *s == want { bars } else { resample(&bars, want) };
        }
    }
    Vec::new()
}

pub fn window(bars: &[Candle], start: i64, end: i64, pick: f64) -> Vec<Candle> {
    let lo = bars.partition_point(|c| c.t < start);
    let hi = bars.partition_point(|c| c.t < end);
    let n = hi.saturating_sub(lo);
    if n <= WINDOW {
        return bars[lo..lo + n].to_vec();
    }
    let off = ((n - WINDOW) as f64 * if pick.is_finite() { pick.clamp(0.0, 1.0) } else { 0.5 }) as usize;
    bars[lo + off..lo + off + WINDOW].to_vec()
}

pub fn fallback_meta(symbol: &str) -> Meta {
    Meta {
        symbol: symbol.into(),
        name: symbol.into(),
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
        gmtoffset: -5 * 3600,
        timezone: "America/New_York".into(),
        periods: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(t: i64, c: f64) -> Candle { Candle { t, o: c, h: c + 1.0, l: c - 1.0, c, v: 10.0 } }

    #[test]
    fn parses_offsets_utc_and_epochs() {
        assert_eq!(parse_time("1970-01-01 00:00:00Z"), Some(0));
        assert_eq!(parse_time("2015-12-31 19:00:00-05:00"), Some(1_451_606_400));
        assert_eq!(parse_time("2016-01-01T00:00:00+00:00"), Some(1_451_606_400));
        assert_eq!(parse_time("2016-01-01 00:00:00.123+0000"), Some(1_451_606_400));
        assert_eq!(parse_time("2024-02-29 14:30:00"), Some(1_709_217_000));
        assert_eq!(parse_time("1451606400"), Some(1_451_606_400));
        assert_eq!(parse_time("1451606400000"), Some(1_451_606_400));
        for bad in ["", "2016-13-01 00:00:00", "2016-01-01 00:00:00+5", "2016-01-01 00:00:00x", "yesterday", "2016-01-01 0é:00:00"] {
            assert_eq!(parse_time(bad), None, "{bad}");
        }
    }

    #[test]
    fn parses_an_alpaca_csv() {
        let csv = "timestamp,open,high,low,close,volume,vwap,trade_count\n\
            2016-01-04 09:35:00-05:00,2,3,1,2.5,100,2.2,4\n\
            2016-01-04 09:30:00-05:00,1,2,1,1.5,50,1.2,2\n\
            \n\
            2016-01-04 09:40:00-05:00,2.5,3,2,3,0,2.7,1\n";
        let p = parse_csv(csv).unwrap();
        assert_eq!(p.interval, "5m");
        assert_eq!(p.symbol, None);
        assert_eq!(p.candles.iter().map(|c| c.t - p.candles[0].t).collect::<Vec<_>>(), [0, 300, 600]);
        assert_eq!(p.candles[0].c, 1.5);
        assert_eq!(parse_csv("symbol,timestamp,open,high,low,close\nspy,60,1,1,1,1\nspy,120,1,1,1,1\n").unwrap().symbol.as_deref(), Some("spy"));
        assert!(parse_csv("").is_err());
        assert!(parse_csv("timestamp,open,high,low\n").is_err());
        assert!(parse_csv("t,o,h,l,c\n60,1,2,1,NaN\n120,1,2,1,1\n").unwrap_err().contains("Line 2"));
        assert!(parse_csv("t,o,h,l,c\n60,1,0.5,1,1\n120,1,2,1,1\n").is_err());
        assert!(parse_csv("t,o,h,l,c\n0,1,1,1,1\n86400,1,1,1,1\n").is_err());
    }

    #[test]
    fn symbols_come_from_the_file_name() {
        assert_eq!(file_symbol("QQQ_5m.csv"), "QQQ");
        assert_eq!(file_symbol("brk-b 1m.csv"), "brk-b");
        assert_eq!(clean_symbol(" brk.b ").unwrap(), "BRK.B");
        assert!(clean_symbol("../x").is_err() && clean_symbol("").is_err());
    }

    #[test]
    fn resamples_on_aligned_buckets() {
        let five: Vec<_> = (0..6).map(|i| k(870 * 60 + i * 300, 10.0 + i as f64)).collect();
        let q = resample(&five, 900);
        assert_eq!(q.len(), 2);
        assert_eq!((q[0].t, q[0].o, q[0].h, q[0].l, q[0].c, q[0].v), (870 * 60, 10.0, 13.0, 9.0, 12.0, 30.0));
        assert_eq!(q[1].c, 15.0);
    }

    #[test]
    fn imports_merge_list_and_serve_coarser_intervals() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        let a = import(d, "qqq_5m.csv", "timestamp,open,high,low,close\n0,1,1,1,1\n300,1,1,1,1\n").unwrap();
        assert_eq!((a.symbol.as_str(), a.interval.as_str(), a.bars), ("QQQ", "5m", 2));
        let b = import(d, "QQQ_5m.csv", "timestamp,open,high,low,close\n300,2,2,2,2\n600,2,2,2,2\n").unwrap();
        assert_eq!((b.bars, b.first, b.last), (3, 0, 600));
        assert_eq!(load(d, "QQQ", "5m")[1].c, 2.0);
        assert_eq!(load(d, "QQQ", "15m").len(), 1);
        assert!(load(d, "QQQ", "1m").is_empty() && load(d, "QQQ", "60m").is_empty());
        std::fs::write(d.join("notes.json"), b"[]").unwrap();
        assert_eq!(list(d), [Series { symbol: "QQQ".into(), interval: "5m".into() }]);
        assert!(list(&d.join("missing")).is_empty());
    }

    #[test]
    fn window_caps_the_bars_around_the_pick() {
        let bars: Vec<_> = (0..(WINDOW as i64 + 100)).map(|t| k(t, 1.0)).collect();
        assert_eq!(window(&bars, 10, 20, 0.5).len(), 10);
        let w = window(&bars, 0, i64::MAX, 1.0);
        assert_eq!((w.len(), w[0].t), (WINDOW, 100));
        assert_eq!(window(&bars, 0, i64::MAX, 0.0)[0].t, 0);
        assert_eq!(window(&bars, 0, i64::MAX, f64::NAN)[0].t, 50);
        assert!(window(&bars, 5000, 6000, 0.5).is_empty());
    }
}

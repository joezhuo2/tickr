use crate::alpaca::{self, AlpacaCreds};
use crate::quote::{self, Candle, Chart, Quote};
use crate::state::{lock, Shared};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Feed { Iex, Sip }

impl Feed {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s { "iex" => Ok(Self::Iex), "sip" => Ok(Self::Sip), _ => Err("Unknown Alpaca feed".into()) }
    }
    pub fn name(self) -> &'static str { match self { Self::Iex => "iex", Self::Sip => "sip" } }
    pub fn source(self) -> &'static str { match self { Self::Iex => "alpaca-iex", Self::Sip => "alpaca-sip" } }
    pub fn stream_url(self) -> &'static str {
        match self { Self::Iex => "wss://stream.data.alpaca.markets/v2/iex", Self::Sip => "wss://stream.data.alpaca.markets/v2/sip" }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum Provider { Yahoo, Alpaca(AlpacaCreds, Feed) }

pub fn eligible(symbol: &str) -> bool {
    (1..=5).contains(&symbol.len()) && symbol.bytes().all(|b| b.is_ascii_uppercase())
}

impl Provider {
    pub fn current(shared: &Shared) -> Self { lock(&shared.provider).clone() }
    pub fn load(settings: &crate::settings::Settings) -> Self {
        if settings.data_provider == "alpaca" {
            if let (Some(keys), Ok(feed)) = (alpaca::load_keys(&crate::ai::env_path()), Feed::parse(&settings.alpaca_feed)) {
                return Self::Alpaca(keys, feed);
            }
        }
        Self::Yahoo
    }
    pub async fn fetch_quote(&self, client: &reqwest::Client, symbol: &str, now: i64) -> Result<Quote, String> {
        let mut quote = quote::fetch_quote(client, symbol, now).await?;
        if let Self::Alpaca(keys, feed) = self {
            if eligible(symbol) {
                match alpaca::snapshot(client, keys, *feed, symbol).await.and_then(|v| alpaca::overlay(&mut quote, &v, *feed)) {
                    Ok(()) => {},
                    Err(e) => log::warn!("Alpaca quote: {e}; using Yahoo"),
                }
            }
        }
        Ok(quote)
    }
    pub async fn overlay_quotes(&self, client: &reqwest::Client, mut quotes: Vec<&mut Quote>) {
        let Self::Alpaca(keys, feed) = self else { return };
        quotes.retain(|q| eligible(&q.symbol));
        if quotes.is_empty() { return; }
        let symbols: Vec<String> = quotes.iter().map(|q| q.symbol.clone()).collect();
        match alpaca::snapshots(client, keys, *feed, &symbols).await {
            Ok(v) => {
                for q in quotes {
                    let snapshot = &v[q.symbol.as_str()];
                    if let Err(e) = alpaca::overlay(q, snapshot, *feed) { log::warn!("Alpaca quote {}: {e}; using Yahoo", q.symbol); }
                }
            },
            Err(e) => log::warn!("Alpaca quotes: {e}; using Yahoo"),
        }
    }
    pub fn bar_source(&self, symbol: &str) -> &'static str {
        match self { Self::Alpaca(_, feed) if eligible(symbol) => feed.source(), _ => "yahoo" }
    }
    pub async fn fetch_older(&self, client: &reqwest::Client, symbol: &str, interval: &str, start: i64, end: i64, extended: bool) -> Result<(&'static str, Vec<Candle>), String> {
        if let Self::Alpaca(keys, feed) = self {
            if eligible(symbol) {
                match alpaca::older_bars(client, keys, *feed, symbol, interval, extended && interval.ends_with('m'), (start, end)).await {
                    Ok(candles) if !candles.is_empty() => return Ok((feed.source(), candles)),
                    Ok(_) => log::warn!("Alpaca returned no older bars; using Yahoo"),
                    Err(e) => log::warn!("Alpaca older bars: {e}; using Yahoo"),
                }
            }
        }
        Ok(("yahoo", quote::fetch_older(client, symbol, interval, start, end, extended).await?.candles))
    }
    pub async fn fetch_chart(&self, client: &reqwest::Client, symbol: &str, range: &str, interval: &str, extended: bool) -> Result<Chart, String> {
        let mut chart = quote::fetch_chart(client, symbol, range, interval, extended).await?;
        self.overlay_bars(client, symbol, &mut chart).await;
        Ok(chart)
    }
    pub async fn fetch_period(&self, client: &reqwest::Client, symbol: &str, interval: &str, start: i64, end: i64) -> Result<Chart, String> {
        let mut chart = quote::fetch_period(client, symbol, interval, start, end).await?;
        self.overlay_bars(client, symbol, &mut chart).await;
        quote::trim_period(&mut chart, start, end);
        Ok(chart)
    }
    async fn overlay_bars(&self, client: &reqwest::Client, symbol: &str, chart: &mut Chart) {
        if let Self::Alpaca(keys, feed) = self {
            if eligible(symbol) {
                let result = alpaca::bars(client, keys, *feed, chart).await;
                apply_bars(chart, result, *feed);
            }
        }
    }
}

fn apply_bars(chart: &mut Chart, result: Result<Vec<Candle>, String>, feed: Feed) {
    match result {
        Ok(candles) if !candles.is_empty() => {
            chart.last_bar_time = candles.last().map(|c| c.t);
            chart.candles = candles;
            chart.source = feed.source().into();
            chart.delay_secs = Some(0);
        },
        Ok(_) => log::warn!("Alpaca returned no bars; using Yahoo"),
        Err(e) => log::warn!("Alpaca chart: {e}; using Yahoo"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chart_fallback_source() {
        let original = quote::parse_chart(include_bytes!("../../fixtures/chart-1d-post.json"), "1d", "5m").unwrap();
        for result in [Err("Alpaca HTTP 401".into()), Ok(vec![])] {
            let mut chart = original.clone();
            apply_bars(&mut chart, result, Feed::Sip);
            assert_eq!(chart, original);
            assert_eq!(chart.source, "yahoo");
        }
        let bars = alpaca::parse_bars(&serde_json::from_str(r#"{"bars":[{"t":"2026-01-02T15:00:00Z","o":1,"h":3,"l":1,"c":2,"v":42}]}"#).unwrap()).unwrap();
        for feed in [Feed::Iex, Feed::Sip] {
            let mut chart = original.clone();
            apply_bars(&mut chart, Ok(bars.clone()), feed);
            assert_eq!(chart.source, feed.source());
            assert_eq!(chart.candles, bars);
            assert_eq!(chart.last_bar_time, bars.last().map(|c| c.t));
            assert_eq!(chart.delay_secs, Some(0));
            assert_eq!(chart.range, original.range);
            assert_eq!(chart.interval, original.interval);
            assert_eq!(chart.meta, original.meta);
            assert_eq!(chart.dividends, original.dividends);
            assert_eq!(chart.splits, original.splits);
        }
    }
    #[test]
    fn symbol_gate() {
        for s in ["A", "AAPL", "GOOGL"] { assert!(eligible(s)); }
        for s in ["", "aapl", "ABCDEF", "^GSPC", "BTC-USD", "BRK-B", "SHOP.TO", "A1", "É"] { assert!(!eligible(s)); }
    }
}

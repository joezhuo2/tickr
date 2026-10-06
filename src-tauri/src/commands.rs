//! Commands invoked by the window.

use std::sync::Arc;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::analysis::Analysis;
use crate::analyst::Consensus;
use crate::news::Article;
use crate::quote::{self, Chart, Quote, SearchHit};
use crate::settings::{ChartMode, DEFAULT_HOTKEY};
use crate::state::{lock, now_secs, QuoteState, Shared};

#[derive(Serialize)]
pub struct Init {
    symbol: String,
    range: String,
    chart_mode: ChartMode,
    hotkey: String,
    default_hotkey: &'static str,
    /// Why the hotkey is not registered, if it is not.
    hotkey_error: Option<String>,
    quote: QuoteState,
    /// Last chart viewed, when it matches the current symbol and range.
    chart: Option<Chart>,
    /// Logo data URI; only meaningful when `logo_known`.
    logo: Option<String>,
    logo_known: bool,
    /// Analyst consensus; only meaningful when `analyst_known`.
    analyst: Option<Consensus>,
    analyst_known: bool,
    /// Starred symbols, in order.
    watchlist: Vec<String>,
}

fn data_uri(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

/// Everything the window needs for its first frame. Also injected into the
/// page before it loads, so a re-created window renders without waiting.
pub fn init_payload(shared: &Shared) -> Init {
    let s = lock(&shared.settings).clone();
    let chart = lock(&shared.last_chart)
        .clone()
        .filter(|c| c.meta.symbol.eq_ignore_ascii_case(&s.symbol) && c.range == s.range);
    let logo = lock(&shared.logo).clone().filter(|(sym, _)| *sym == s.symbol);
    let analyst = shared.analysts.cached(&s.symbol, now_secs());
    Init {
        symbol: s.symbol,
        range: s.range,
        chart_mode: s.chart_mode,
        hotkey: s.hotkey,
        default_hotkey: DEFAULT_HOTKEY,
        hotkey_error: lock(&shared.hotkey_error).clone(),
        quote: lock(&shared.quote).clone(),
        chart,
        logo_known: logo.is_some(),
        logo: logo.and_then(|(_, b)| b).map(|b| data_uri(&b)),
        analyst_known: analyst.is_some(),
        analyst: analyst.flatten(),
        watchlist: s.watchlist,
    }
}

/// Called by the page after its first paint; shows the hidden window.
#[tauri::command]
pub fn window_ready(window: tauri::WebviewWindow) {
    crate::window::reveal(&window);
}

#[tauri::command]
pub fn get_init(shared: State<'_, Arc<Shared>>) -> Init {
    init_payload(&shared)
}

#[tauri::command]
pub async fn get_chart(shared: State<'_, Arc<Shared>>, symbol: String, range: String) -> Result<Chart, String> {
    let chart = quote::fetch_chart(&shared.http, &symbol, &range).await?;
    *lock(&shared.last_chart) = Some(chart.clone());
    Ok(chart)
}

/// Technical analysis of the chart on screen. Runs only when the user asks.
/// Reuses the last fetched chart when it matches, so the analysis covers the
/// same candles the window shows; fetches otherwise.
#[tauri::command]
pub async fn analyze(shared: State<'_, Arc<Shared>>, symbol: String, range: String) -> Result<Analysis, String> {
    let cached = lock(&shared.last_chart)
        .clone()
        .filter(|c| c.meta.symbol.eq_ignore_ascii_case(symbol.trim()) && c.range == range);
    let chart = match cached {
        Some(c) => c,
        None => {
            let c = quote::fetch_chart(&shared.http, &symbol, &range).await?;
            *lock(&shared.last_chart) = Some(c.clone());
            c
        }
    };
    crate::analysis::analyze(&chart).inspect_err(|e| log::info!("analyze {symbol} {range}: {e}"))
}

#[tauri::command]
pub async fn search(shared: State<'_, Arc<Shared>>, q: String) -> Result<Vec<SearchHit>, String> {
    let q = q.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    quote::search(&shared.http, q).await
}

/// Validates the symbol with a live fetch, then switches to it.
#[tauri::command]
pub async fn set_symbol(app: AppHandle, shared: State<'_, Arc<Shared>>, symbol: String) -> Result<QuoteState, String> {
    let symbol = symbol.trim().to_uppercase();
    if symbol.is_empty() {
        return Err("empty symbol".into());
    }
    let q = quote::fetch_quote(&shared.http, &symbol, now_secs()).await?;
    let state = QuoteState { quote: Some(q), error: None, updated_at: now_secs() };
    shared.update_settings(|s| s.symbol = symbol.clone());
    *lock(&shared.quote) = state.clone();
    crate::tray::update(&app, &shared);
    shared.wake.notify_one();
    Ok(state)
}

#[tauri::command]
pub fn set_range(shared: State<'_, Arc<Shared>>, range: String) -> Result<(), String> {
    if quote::interval_for(&range).is_none() {
        return Err(format!("unknown range {range}"));
    }
    shared.update_settings(|s| s.range = range);
    Ok(())
}

#[tauri::command]
pub fn set_chart_mode(shared: State<'_, Arc<Shared>>, mode: ChartMode) {
    shared.update_settings(|s| s.chart_mode = mode);
}

#[tauri::command]
pub fn set_hotkey(app: AppHandle, shared: State<'_, Arc<Shared>>, hotkey: String) -> Result<String, String> {
    let old = lock(&shared.settings).hotkey.clone();
    crate::hotkey::swap(&app, &old, &hotkey)?;
    shared.update_settings(|s| s.hotkey = hotkey.clone());
    *lock(&shared.hotkey_error) = None;
    crate::tray::update(&app, &shared);
    Ok(hotkey)
}

/// Opens the logo provider's page; its free tier requires the link.
#[tauri::command]
pub fn open_logo_credit() {
    crate::tray::open_url(crate::logo::CREDIT_URL);
}

/// Logo as a data: URI, or None when the symbol has no logo.
#[tauri::command]
pub async fn get_logo(shared: State<'_, Arc<Shared>>, symbol: String) -> Result<Option<String>, String> {
    let bytes = crate::logo::get(&shared.http, &symbol).await;
    Ok(bytes.map(|b| data_uri(&b)))
}

/// Analyst consensus and 12-month price target, or None without coverage.
#[tauri::command]
pub async fn get_analyst(shared: State<'_, Arc<Shared>>, symbol: String) -> Result<Option<Consensus>, String> {
    shared.analysts.get(&symbol, now_secs()).await.inspect_err(|e| log::warn!("analyst {symbol}: {e}"))
}

/// Recent headlines for the symbol, newest first.
#[tauri::command]
pub async fn get_news(shared: State<'_, Arc<Shared>>, symbol: String) -> Result<Vec<Article>, String> {
    crate::news::fetch(&shared.http, &symbol).await.inspect_err(|e| log::warn!("news {symbol}: {e}"))
}

/// Opens a headline in the default browser.
#[tauri::command]
pub fn open_news(url: String) -> Result<(), String> {
    if !crate::news::is_web_url(&url) {
        return Err("not a web link".into());
    }
    crate::tray::open_url(&url);
    Ok(())
}

/// Upper-cased, trimmed, without blanks or repeats; order kept.
fn clean_symbols(symbols: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(symbols.len());
    for s in symbols {
        let s = s.trim().to_uppercase();
        if !s.is_empty() && !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// Replaces the watchlist (star, unstar and reorder all send the full list).
#[tauri::command]
pub fn set_watchlist(shared: State<'_, Arc<Shared>>, symbols: Vec<String>) -> Vec<String> {
    let symbols = clean_symbols(symbols);
    shared.update_settings(|s| s.watchlist = symbols.clone());
    symbols
}

#[derive(Serialize)]
pub struct WatchQuote {
    symbol: String,
    quote: Option<Quote>,
    error: Option<String>,
}

/// Quotes for the watchlist, fetched in parallel; one failure does not fail the rest.
#[tauri::command]
pub async fn get_watch_quotes(shared: State<'_, Arc<Shared>>, symbols: Vec<String>) -> Result<Vec<WatchQuote>, String> {
    let now = now_secs();
    let tasks: Vec<_> = clean_symbols(symbols)
        .into_iter()
        .map(|symbol| {
            let http = shared.http.clone();
            tauri::async_runtime::spawn(async move {
                let r = quote::fetch_quote(&http, &symbol, now).await;
                WatchQuote { symbol, quote: r.as_ref().ok().cloned(), error: r.err() }
            })
        })
        .collect();
    let mut out = Vec::with_capacity(tasks.len());
    for t in tasks {
        out.push(t.await.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_symbols_dedupes_and_normalizes() {
        let got = clean_symbols(vec![" aapl ".into(), "MSFT".into(), "".into(), "AAPL".into(), "brk-b".into()]);
        assert_eq!(got, ["AAPL", "MSFT", "BRK-B"]);
    }
}

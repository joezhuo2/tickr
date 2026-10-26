//! Commands invoked by the window.

use std::sync::Arc;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_notification::NotificationExt;

use crate::alerts::{self, Direction, PriceAlert};
use crate::analysis::Analysis;
use crate::analyst::Consensus;
use crate::earnings::Earnings;
use crate::grades::RatingChange;
use crate::market::Market;
use crate::stats::Section;
use crate::news::Article;
use crate::quote::{self, Chart, Quote, SearchHit};
use crate::settings::{ChartMode, Dots, Group, Keybinds, DEFAULT_HOTKEY};
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
    groups: Vec<Group>,
    keybinds: Keybinds,
    dots: Dots,
    alerts: Vec<PriceAlert>,
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
        groups: s.groups,
        keybinds: s.keybinds,
        dots: s.dots,
        alerts: s.alerts,
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
pub fn refresh_quote(shared: State<'_, Arc<Shared>>) {
    shared.wake.notify_one();
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

#[tauri::command]
pub fn set_keybinds(shared: State<'_, Arc<Shared>>, keybinds: Keybinds) {
    shared.update_settings(|s| s.keybinds = keybinds);
}

#[tauri::command]
pub fn set_dots(shared: State<'_, Arc<Shared>>, dots: Dots) {
    shared.update_settings(|s| s.dots = dots);
}

fn notification_permission(app: &AppHandle) -> Result<(), String> {
    let permission = app.notification().request_permission().map_err(|e| e.to_string())?;
    if permission != tauri::plugin::PermissionState::Granted {
        return Err("Allow tickr notifications in your system settings before arming an alert.".into());
    }
    Ok(())
}

/// Save before returning success; a failed disk write must not look like a saved alert.
fn edit_alerts(shared: &Shared, edit: impl FnOnce(&mut Vec<PriceAlert>) -> Result<(), String>) -> Result<Vec<PriceAlert>, String> {
    let mut settings = lock(&shared.settings);
    let mut next = settings.clone();
    edit(&mut next.alerts)?;
    next.save(&shared.settings_path).map_err(|e| format!("Could not save alerts: {e}"))?;
    *settings = next;
    // Each edit resets baselines only for alerts that are no longer armed.
    lock(&shared.alert_prices).retain(|id, _| settings.alerts.iter().any(|a| a.id == *id && a.enabled));
    Ok(settings.alerts.clone())
}

#[tauri::command]
pub fn add_alert(app: AppHandle, shared: State<'_, Arc<Shared>>, symbol: String, direction: Direction, level: f64) -> Result<Vec<PriceAlert>, String> {
    let symbol = alerts::validate(&symbol, level)?;
    notification_permission(&app)?;
    let result = edit_alerts(&shared, |alerts| {
        if alerts.len() >= alerts::MAX_ALERTS {
            return Err(format!("You can save up to {} alerts. Delete one first.", alerts::MAX_ALERTS));
        }
        if alerts.iter().any(|a| a.symbol == symbol && a.direction == direction && a.level == level) {
            return Err("An alert for this symbol, direction and price already exists.".into());
        }
        let id = alerts.iter().map(|a| a.id).max().unwrap_or(0).checked_add(1).ok_or("Alert IDs exhausted.")?;
        alerts.push(PriceAlert { id, symbol, direction, level, enabled: true, triggered_at: None });
        Ok(())
    })?;
    shared.wake.notify_one();
    Ok(result)
}

#[tauri::command]
pub fn set_alert_enabled(app: AppHandle, shared: State<'_, Arc<Shared>>, id: u32, enabled: bool) -> Result<Vec<PriceAlert>, String> {
    if enabled {
        notification_permission(&app)?;
    }
    let result = edit_alerts(&shared, |alerts| {
        let alert = alerts.iter_mut().find(|a| a.id == id).ok_or("Alert no longer exists.")?;
        alert.enabled = enabled;
        if enabled {
            alert.triggered_at = None;
        }
        Ok(())
    })?;
    shared.wake.notify_one();
    Ok(result)
}

#[tauri::command]
pub fn delete_alert(shared: State<'_, Arc<Shared>>, id: u32) -> Result<Vec<PriceAlert>, String> {
    let result = edit_alerts(&shared, |alerts| {
        alerts.retain(|a| a.id != id);
        Ok(())
    })?;
    shared.wake.notify_one();
    Ok(result)
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

#[tauri::command]
pub async fn get_earnings(shared: State<'_, Arc<Shared>>, symbol: String) -> Result<Option<Earnings>, String> {
    crate::earnings::fetch(&shared.analysts, &symbol).await.inspect_err(|e| log::warn!("earnings {symbol}: {e}"))
}

#[tauri::command]
pub async fn get_rating_changes(shared: State<'_, Arc<Shared>>, symbol: String) -> Result<Vec<RatingChange>, String> {
    crate::grades::fetch(&shared.analysts, &symbol).await.inspect_err(|e| log::warn!("rating changes {symbol}: {e}"))
}

#[tauri::command]
pub async fn get_stats(shared: State<'_, Arc<Shared>>, symbol: String) -> Result<Vec<Section>, String> {
    crate::stats::fetch(&shared.analysts, &symbol).await.inspect_err(|e| log::warn!("stats {symbol}: {e}"))
}

#[tauri::command]
pub async fn get_market(shared: State<'_, Arc<Shared>>) -> Result<Market, String> {
    crate::market::fetch(&shared.analysts).await.inspect_err(|e| log::warn!("market: {e}"))
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

/// Trims and dedupes group names, and keeps only starred symbols in each.
fn clean_groups(groups: Vec<Group>, watchlist: &[String]) -> Vec<Group> {
    let mut out: Vec<Group> = Vec::with_capacity(groups.len());
    for g in groups {
        let name = g.name.trim().to_string();
        if name.is_empty() || out.iter().any(|o| o.name.eq_ignore_ascii_case(&name)) {
            continue;
        }
        let symbols = clean_symbols(g.symbols).into_iter().filter(|s| watchlist.contains(s)).collect();
        out.push(Group { name, symbols });
    }
    out
}

/// Replaces the watchlist (star, unstar and reorder all send the full list).
#[tauri::command]
pub fn set_watchlist(shared: State<'_, Arc<Shared>>, symbols: Vec<String>) -> Vec<String> {
    let symbols = clean_symbols(symbols);
    shared.update_settings(|s| {
        s.watchlist = symbols.clone();
        s.groups = clean_groups(std::mem::take(&mut s.groups), &s.watchlist);
    });
    symbols
}

/// Replaces the watchlist groups (add, rename, delete and edit all send the full list).
#[tauri::command]
pub fn set_groups(shared: State<'_, Arc<Shared>>, groups: Vec<Group>) -> Vec<Group> {
    shared.update_settings(|s| s.groups = clean_groups(groups, &s.watchlist)).groups
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
    fn alert_edits_save_and_clear_paused_or_deleted_baselines() {
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        edit_alerts(&shared, |alerts| {
            alerts.push(PriceAlert { id: 1, symbol: "AAPL".into(), direction: Direction::Above, level: 100.0, enabled: true, triggered_at: None });
            Ok(())
        }).unwrap();
        lock(&shared.alert_prices).insert(1, 99.0);
        edit_alerts(&shared, |alerts| { alerts[0].enabled = false; Ok(()) }).unwrap();
        assert!(lock(&shared.alert_prices).is_empty());
        assert!(!crate::settings::Settings::load(&shared.settings_path).alerts[0].enabled);
        edit_alerts(&shared, |alerts| { alerts[0].enabled = true; Ok(()) }).unwrap();
        assert!(lock(&shared.alert_prices).is_empty());
        lock(&shared.alert_prices).insert(1, 99.0);
        edit_alerts(&shared, |alerts| { alerts.clear(); Ok(()) }).unwrap();
        assert!(lock(&shared.alert_prices).is_empty());
        assert!(crate::settings::Settings::load(&shared.settings_path).alerts.is_empty());
    }

    #[test]
    fn failed_alert_save_does_not_change_live_settings() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("file");
        std::fs::write(&blocker, "not a directory").unwrap();
        let shared = Shared::new(blocker.join("settings.json"), Default::default());
        assert!(edit_alerts(&shared, |alerts| {
            alerts.push(PriceAlert { id: 1, symbol: "AAPL".into(), direction: Direction::Above, level: 100.0, enabled: true, triggered_at: None });
            Ok(())
        }).is_err());
        assert!(lock(&shared.settings).alerts.is_empty());
    }

    #[test]
    fn clean_symbols_dedupes_and_normalizes() {
        let got = clean_symbols(vec![" aapl ".into(), "MSFT".into(), "".into(), "AAPL".into(), "brk-b".into()]);
        assert_eq!(got, ["AAPL", "MSFT", "BRK-B"]);
    }

    #[test]
    fn clean_groups_trims_dedupes_and_drops_unstarred() {
        let g = |name: &str, symbols: &[&str]| Group { name: name.into(), symbols: symbols.iter().map(|s| s.to_string()).collect() };
        let watchlist = vec!["AAPL".to_string(), "NVDA".to_string()];
        let got = clean_groups(vec![g(" Tech ", &["aapl", "TSLA", "NVDA"]), g("tech", &["AAPL"]), g("  ", &["AAPL"]), g("Empty", &[])], &watchlist);
        assert_eq!(got, [g("Tech", &["AAPL", "NVDA"]), g("Empty", &[])]);
    }
}

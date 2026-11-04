//! Commands invoked by the window.

use std::sync::Arc;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;

use crate::ai::AiConfig;
use crate::alerts::{self, AlertKind, Direction, PriceAlert};
use crate::analysis::Analysis;
use crate::analyst::Consensus;
use crate::earnings::Earnings;
use crate::grades::RatingChange;
use crate::market::Market;
use crate::options::Options;
use crate::stats::Section;
use crate::news::Article;
use crate::quote::{self, Chart, Quote, SearchHit};
use crate::settings::{RefreshMode, ChartMode, ChartScale, Dots, Group, Keybinds, IndicatorConfig, IndicatorPreset, Settings, validate_indicators, DEFAULT_HOTKEY};
use crate::state::{lock, now_secs, QuoteState, Shared};

#[derive(Serialize)]
pub struct Init {
    data_provider: DataProvider,
    symbol: String,
    range: String,
    interval: String,
    chart_mode: ChartMode,
    refresh_mode: RefreshMode,
    chart_scale: ChartScale,
    hotkey: String,
    default_hotkey: &'static str,
    /// Why the hotkey is not registered, if it is not.
    hotkey_error: Option<String>,
    quote: QuoteState,
    /// Last chart viewed, when it matches the current symbol, range and interval.
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
    indicators: IndicatorConfig,
    drawings: std::collections::HashMap<String, Vec<crate::settings::Drawing>>,
    indicator_presets: Vec<IndicatorPreset>,
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
        .filter(|c| c.meta.symbol.eq_ignore_ascii_case(&s.symbol) && c.range == s.range
            && quote::resolve_interval(&s.range, &s.interval).is_some_and(|(i, _)| c.interval == i));
    let logo = lock(&shared.logo).clone().filter(|(sym, _)| *sym == s.symbol);
    let analyst = shared.analysts.cached(&s.symbol, now_secs());
    Init {
        data_provider: provider_payload(shared),
        symbol: s.symbol,
        range: s.range,
        interval: s.interval,
        chart_mode: s.chart_mode,
        refresh_mode: s.refresh_mode,
        chart_scale: s.chart_scale,
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
        indicators: s.indicators,
        drawings: s.drawings,
        indicator_presets: s.indicator_presets,
        alerts: s.alerts,
    }
}

#[tauri::command]
pub fn get_init(shared: State<'_, Arc<Shared>>) -> Init {
    init_payload(&shared)
}

#[tauri::command]
pub async fn get_chart(shared: State<'_, Arc<Shared>>, symbol: String, range: String, interval: String) -> Result<Chart, String> {
    let revision = shared.revision();
    let chart = crate::provider::Provider::current(&shared).fetch_chart(&shared.http, &symbol, &range, &interval).await?;
    let _settings = lock(&shared.settings);
    if shared.revision() != revision { return Err("Market data settings changed; try again".into()); }
    *lock(&shared.last_chart) = Some(chart.clone());
    Ok(chart)
}

/// Technical analysis of the chart on screen.
/// Reuses the last fetched chart when it matches, so the analysis covers the
/// same candles the window shows; fetches otherwise.
#[tauri::command]
pub async fn analyze(shared: State<'_, Arc<Shared>>, symbol: String, range: String, interval: String) -> Result<Analysis, String> {
    let revision = shared.revision();
    let cached = lock(&shared.last_chart)
        .clone()
        .filter(|c| c.meta.symbol.eq_ignore_ascii_case(symbol.trim()) && c.range == range
            && quote::resolve_interval(&range, &interval).is_some_and(|(i, _)| c.interval == i));
    let chart = match cached {
        Some(c) => c,
        None => {
            let c = crate::provider::Provider::current(&shared).fetch_chart(&shared.http, &symbol, &range, &interval).await?;
            let _settings = lock(&shared.settings);
            if shared.revision() != revision { return Err("Market data settings changed; try again".into()); }
            *lock(&shared.last_chart) = Some(c.clone());
            c
        }
    };
    crate::analysis::analyze_with_config(&chart, &lock(&shared.settings).indicators).inspect_err(|e| log::info!("analyze {symbol} {range}: {e}"))
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
    let revision = shared.revision();
    let q = crate::provider::Provider::current(&shared).fetch_quote(&shared.http, &symbol, now_secs()).await?;
    let mut settings = lock(&shared.settings);
    if shared.revision() != revision { return Err("Market data settings changed; try again".into()); }
    let state = QuoteState { quote: Some(q), error: None, updated_at: now_secs() };
    settings.symbol = symbol.clone();
    if let Err(e) = settings.save(&shared.settings_path) { log::warn!("save settings: {e}"); }
    *lock(&shared.quote) = state.clone();
    drop(settings);
    shared.stream_wake.notify_one();
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
    shared.update_settings(|s| {
        if !quote::intervals_for(&range).contains(&s.interval.as_str()) {
            s.interval = "auto".into();
        }
        s.range = range;
    });
    Ok(())
}

#[tauri::command]
pub fn set_interval(shared: State<'_, Arc<Shared>>, interval: String) -> Result<(), String> {
    if interval != "auto" && !quote::intervals_for(&lock(&shared.settings).range).contains(&interval.as_str()) {
        return Err(format!("unknown interval {interval}"));
    }
    shared.update_settings(|s| s.interval = interval);
    Ok(())
}

#[tauri::command]
pub fn set_chart_mode(shared: State<'_, Arc<Shared>>, mode: ChartMode) {
    shared.update_settings(|s| s.chart_mode = mode);
}

#[tauri::command]
pub fn set_refresh_mode(shared: State<'_, Arc<Shared>>, mode: RefreshMode) {
    shared.update_settings(|s| s.refresh_mode = mode);
    shared.wake.notify_one();
}

#[tauri::command]
pub fn set_chart_scale(shared: State<'_, Arc<Shared>>, scale: ChartScale) {
    shared.update_settings(|s| s.chart_scale = scale);
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

#[derive(Serialize, Deserialize)]
pub struct AiPrefs {
    pub enabled: bool,
    #[serde(flatten)]
    pub config: AiConfig,
}

#[tauri::command]
pub fn get_ai_config(shared: State<'_, Arc<Shared>>) -> AiPrefs {
    AiPrefs { enabled: lock(&shared.settings).ai_news, config: crate::ai::load_config(&crate::ai::env_path()) }
}

#[tauri::command]
pub fn set_ai_config(shared: State<'_, Arc<Shared>>, prefs: AiPrefs) -> Result<(), String> {
    crate::ai::save_config(&crate::ai::env_path(), &prefs.config).map_err(|e| format!("Could not save AI settings: {e}"))?;
    shared.update_settings(|s| s.ai_news = prefs.enabled);
    Ok(())
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
#[allow(clippy::too_many_arguments)]
pub fn add_alert(app: AppHandle, shared: State<'_, Arc<Shared>>, symbol: String, kind: AlertKind, direction: Direction, level: f64, recurring: bool, cooldown_mins: u32, regular_only: bool) -> Result<Vec<PriceAlert>, String> {
    let symbol = alerts::validate(&symbol, level, kind, direction)?;
    if cooldown_mins > alerts::MAX_COOLDOWN_MINS {
        return Err(format!("Cooldown can be at most {} minutes.", alerts::MAX_COOLDOWN_MINS));
    }
    notification_permission(&app)?;
    let result = edit_alerts(&shared, |alerts| {
        if alerts.len() >= alerts::MAX_ALERTS {
            return Err(format!("You can save up to {} alerts. Delete one first.", alerts::MAX_ALERTS));
        }
        if alerts.iter().any(|a| a.symbol == symbol && a.kind == kind && a.direction == direction && a.level == level) {
            return Err("An alert for this symbol, kind, direction and level already exists.".into());
        }
        let id = alerts.iter().map(|a| a.id).max().unwrap_or(0).checked_add(1).ok_or("Alert IDs exhausted.")?;
        alerts.push(PriceAlert { id, symbol, direction, level, enabled: true, triggered_at: None, kind, reference: None, recurring, cooldown_mins, regular_only });
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
            alert.reference = None;
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

#[tauri::command]
pub async fn get_options(shared: State<'_, Arc<Shared>>, symbol: String, date: Option<i64>) -> Result<Options, String> {
    crate::options::fetch(&shared.analysts, &symbol, date).await.inspect_err(|e| log::warn!("options {symbol}: {e}"))
}

/// Recent headlines for the symbol, newest first.
#[tauri::command]
pub async fn get_news(shared: State<'_, Arc<Shared>>, symbol: String) -> Result<Vec<Article>, String> {
    let mut list = crate::news::fetch(&shared.http, &symbol).await.inspect_err(|e| log::warn!("news {symbol}: {e}"))?;
    crate::ai::apply(&shared, symbol.trim(), &mut list).await;
    Ok(list)
}

#[tauri::command]
pub async fn get_news_feed(shared: State<'_, Arc<Shared>>, symbols: Vec<String>) -> Result<Vec<crate::news::FeedArticle>, String> {
    let cleaned = clean_symbols(symbols);
    if cleaned.len() > 50 {
        return Err("News feed supports at most 50 symbols".into());
    }
    let tasks: Vec<_> = cleaned.into_iter().map(|symbol| {
        let shared = Arc::clone(shared.inner());
        tauri::async_runtime::spawn(async move {
            let mut list = crate::news::fetch(&shared.http, &symbol).await
                .inspect_err(|e| log::warn!("news {symbol}: {e}"))?;
            crate::ai::apply(&shared, &symbol, &mut list).await;
            Ok::<_, String>((symbol, list))
        })
    }).collect();
    let count = tasks.len();
    let mut lists = Vec::new();
    for task in tasks {
        match task.await {
            Ok(Ok(list)) => lists.push(list),
            Ok(Err(_)) => {},
            Err(e) => log::warn!("news feed: {e}"),
        }
    }
    if count > 0 && lists.is_empty() {
        return Err("Could not load news for any symbol".into());
    }
    Ok(crate::news::merge(lists))
}

/// US economic events for the next week from Yahoo's calendar, cached for 15 minutes unless `force`.
#[tauri::command]
pub async fn get_events(shared: State<'_, Arc<Shared>>, force: bool) -> Result<crate::events::EventsReport, String> {
    crate::events::fetch(&shared.analysts, force).await.inspect_err(|e| log::warn!("events: {e}"))
}

/// AI analysis of one event, run when the user opens it.
#[tauri::command]
pub async fn analyze_event(shared: State<'_, Arc<Shared>>, event: crate::events::MarketEvent) -> Result<crate::events::EventAnalysis, String> {
    crate::events::analyze(&shared.http, &event).await.inspect_err(|e| log::warn!("event analysis {}: {e}", event.name))
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

fn edit_indicators(shared: &Shared, edit: impl FnOnce(&mut Settings) -> Result<(), String>) -> Result<Settings, String> {
    let mut settings = lock(&shared.settings);
    let mut next = settings.clone();
    edit(&mut next)?;
    validate_indicators(&next.indicators, &next.indicator_presets)?;
    next.save(&shared.settings_path).map_err(|e| format!("Could not save indicators: {e}"))?;
    *settings = next.clone();
    Ok(next)
}

#[tauri::command]
pub fn set_indicators(shared: State<'_, Arc<Shared>>, config: IndicatorConfig) -> Result<IndicatorConfig, String> {
    Ok(edit_indicators(&shared, |s| { s.indicators = config; Ok(()) })?.indicators)
}

#[tauri::command]
pub fn save_indicator_preset(shared: State<'_, Arc<Shared>>, name: String) -> Result<Vec<IndicatorPreset>, String> {
    Ok(edit_indicators(&shared, |s| s.save_indicator_preset(&name))?.indicator_presets)
}

#[tauri::command]
pub fn delete_indicator_preset(shared: State<'_, Arc<Shared>>, name: String) -> Result<Vec<IndicatorPreset>, String> {
    Ok(edit_indicators(&shared, |s| s.delete_indicator_preset(&name))?.indicator_presets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drawing_edits_validate_and_persist_atomically() {
        use crate::settings::{Drawing, DrawingPoint};
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        let d = Drawing { id: 1, kind: "hline".into(), points: vec![DrawingPoint { t: 100, price: 10.0 }], text: String::new() };
        edit_drawings(&shared, "aapl".into(), vec![d.clone()]).unwrap();
        let saved = Settings::load(&shared.settings_path);
        assert_eq!(saved.drawings["AAPL"], vec![d.clone()]);
        assert_eq!(init_payload(&shared).drawings, saved.drawings);
        let mut invalid = Vec::new();
        let mut bad = d.clone(); bad.kind = "fib".into(); invalid.push(vec![bad]);
        for kind in ["hline", "text", "trend"] {
            let mut bad = d.clone(); bad.kind = kind.into(); bad.points.clear(); invalid.push(vec![bad]);
        }
        for price in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut bad = d.clone(); bad.points[0].price = price; invalid.push(vec![bad]);
        }
        for text in ["".to_string(), " ".into(), "x".repeat(201)] {
            let mut bad = d.clone(); bad.kind = "text".into(); bad.text = text; invalid.push(vec![bad]);
        }
        for kind in ["hline", "trend"] {
            let mut bad = d.clone(); bad.kind = kind.into(); bad.text = "no".into();
            if kind == "trend" { bad.points.push(bad.points[0].clone()); }
            invalid.push(vec![bad]);
        }
        invalid.push(vec![d.clone(), d.clone()]);
        invalid.push((0..201).map(|id| Drawing { id, ..d.clone() }).collect());
        for drawings in invalid {
            assert!(edit_drawings(&shared, "AAPL".into(), drawings).is_err());
            assert_eq!(*lock(&shared.settings), saved);
            assert_eq!(Settings::load(&shared.settings_path), saved);
        }
        assert!(edit_drawings(&shared, " ".into(), vec![]).is_err());
        let mut text = d.clone(); text.kind = "text".into(); text.text = "?".repeat(200);
        let mut trend = d.clone(); trend.id = 2; trend.kind = "trend".into(); trend.points.push(trend.points[0].clone());
        edit_drawings(&shared, "AAPL".into(), vec![text, trend]).unwrap();
        edit_drawings(&shared, "AAPL".into(), vec![]).unwrap();
        assert!(Settings::load(&shared.settings_path).drawings.is_empty());
        {
            let mut settings = lock(&shared.settings);
            settings.drawings = (0..500).map(|i| (format!("S{i}"), vec![d.clone()])).collect();
            settings.save(&shared.settings_path).unwrap();
        }
        let saved = Settings::load(&shared.settings_path);
        assert!(edit_drawings(&shared, "NEW".into(), vec![d.clone()]).is_err());
        assert_eq!(*lock(&shared.settings), saved);
        assert_eq!(Settings::load(&shared.settings_path), saved);
        edit_drawings(&shared, "S0".into(), vec![d.clone()]).unwrap();
        let blocker = dir.path().join("file");
        std::fs::write(&blocker, "not a directory").unwrap();
        let shared = Shared::new(blocker.join("settings.json"), Default::default());
        assert!(edit_drawings(&shared, "AAPL".into(), vec![d]).is_err());
        assert!(lock(&shared.settings).drawings.is_empty());
    }

    #[test]
    fn indicator_edits_persist_and_rejections_leave_settings_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        edit_indicators(&shared, |s| { s.indicators.rsi.length = 7; s.save_indicator_preset("Custom") }).unwrap();
        let saved = Settings::load(&shared.settings_path);
        assert_eq!(saved.indicators.rsi.length, 7);
        assert_eq!(init_payload(&shared).indicators, saved.indicators);
        assert_eq!(init_payload(&shared).indicator_presets, saved.indicator_presets);
        assert!(edit_indicators(&shared, |s| { s.indicators.rsi.length = 0; Ok(()) }).is_err());
        assert_eq!(*lock(&shared.settings), saved);
        assert_eq!(Settings::load(&shared.settings_path), saved);
        edit_indicators(&shared, |s| s.delete_indicator_preset("Custom")).unwrap();
        assert!(Settings::load(&shared.settings_path).indicator_presets.is_empty());
        let blocker = dir.path().join("file");
        std::fs::write(&blocker, "not a directory").unwrap();
        let shared = Shared::new(blocker.join("settings.json"), Default::default());
        assert!(edit_indicators(&shared, |s| { s.indicators.rsi.length = 7; Ok(()) }).is_err());
        assert_eq!(lock(&shared.settings).indicators, IndicatorConfig::default());
    }

    #[test]
    fn init_chart_matches_resolved_interval() {
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        let chart = quote::parse_chart(include_bytes!("../../fixtures/chart-1d-post.json"), "1d", "5m").unwrap();
        *lock(&shared.last_chart) = Some(chart);
        for interval in ["auto", "5m", "invalid"] {
            lock(&shared.settings).interval = interval.into();
            assert!(init_payload(&shared).chart.is_some());
        }
        lock(&shared.settings).interval = "60m".into();
        assert!(init_payload(&shared).chart.is_none());
    }

    #[test]
    fn alert_edits_save_and_clear_paused_or_deleted_baselines() {
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        edit_alerts(&shared, |alerts| {
            alerts.push(PriceAlert { id: 1, symbol: "AAPL".into(), direction: Direction::Above, level: 100.0, enabled: true, triggered_at: None, kind: AlertKind::Price, reference: None, recurring: false, cooldown_mins: 15, regular_only: false });
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
            alerts.push(PriceAlert { id: 1, symbol: "AAPL".into(), direction: Direction::Above, level: 100.0, enabled: true, triggered_at: None, kind: AlertKind::Price, reference: None, recurring: false, cooldown_mins: 15, regular_only: false });
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

#[derive(Clone, Serialize)]
pub struct DataProvider {
    provider: String,
    feed: String,
    has_keys: bool,
    stream: crate::stream::Status,
}

fn provider_payload(shared: &Shared) -> DataProvider {
    let s = lock(&shared.settings);
    DataProvider {
        provider: s.data_provider.clone(), feed: s.alpaca_feed.clone(),
        has_keys: crate::alpaca::load_keys(&crate::ai::env_path()).is_some(),
        stream: lock(&shared.stream_status).clone(),
    }
}

#[tauri::command]
pub fn get_data_provider(shared: State<'_, Arc<Shared>>) -> DataProvider { provider_payload(&shared) }

fn provider_changed(app: &AppHandle, shared: &Shared) -> DataProvider {
    crate::stream::set_status(app, shared, crate::stream::Status::Off);
    shared.stream_wake.notify_one();
    shared.wake.notify_one();
    let payload = provider_payload(shared);
    let _ = app.emit_to(crate::window::LABEL, "data-provider", &payload);
    payload
}

#[tauri::command]
pub fn set_data_provider(app: AppHandle, shared: State<'_, Arc<Shared>>, provider: String, feed: String, key_id: Option<String>, secret: Option<String>) -> Result<DataProvider, String> {
    use crate::alpaca::{load_keys, save_keys, validate_key, AlpacaCreds};
    use crate::provider::{Feed, Provider};
    if !matches!(provider.as_str(), "yahoo" | "alpaca") { return Err("Unknown data provider".into()); }
    let parsed_feed = Feed::parse(&feed)?;
    let mut settings = lock(&shared.settings);
    let path = crate::ai::env_path();
    let old = load_keys(&path);
    let keep = |value: Option<String>, stored: Option<&str>| -> Result<String, String> {
        match value {
            Some(v) if !v.is_empty() => { validate_key(&v)?; Ok(v) },
            _ => Ok(stored.unwrap_or_default().to_string()),
        }
    };
    let keys = AlpacaCreds {
        key_id: keep(key_id, old.as_ref().map(|k| k.key_id.as_str()))?,
        secret: keep(secret, old.as_ref().map(|k| k.secret.as_str()))?,
    };
    let has_keys = !keys.key_id.is_empty() && !keys.secret.is_empty();
    if (!keys.key_id.is_empty() || !keys.secret.is_empty() || provider == "alpaca") && !has_keys { return Err("Both Alpaca keys are required".into()); }
    let mut next = settings.clone();
    next.data_provider = provider.clone();
    next.alpaca_feed = feed;
    if has_keys { save_keys(&path, Some(&keys)).map_err(|_| "Could not save Alpaca keys")?; }
    if next.save(&shared.settings_path).is_err() {
        if has_keys { let _ = save_keys(&path, old.as_ref()); }
        return Err("Could not save market data settings".into());
    }
    *settings = next;
    *lock(&shared.provider) = if provider == "alpaca" { Provider::Alpaca(keys, parsed_feed) } else { Provider::Yahoo };
    shared.provider_revision.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    *lock(&shared.last_chart) = None;
    drop(settings);
    Ok(provider_changed(&app, &shared))
}

#[tauri::command]
pub fn clear_alpaca_keys(app: AppHandle, shared: State<'_, Arc<Shared>>) -> Result<DataProvider, String> {
    let mut settings = lock(&shared.settings);
    let mut next = settings.clone();
    next.data_provider = "yahoo".into();
    next.save(&shared.settings_path).map_err(|_| "Could not save market data settings")?;
    if crate::alpaca::save_keys(&crate::ai::env_path(), None).is_err() {
        let _ = settings.save(&shared.settings_path);
        return Err("Could not clear Alpaca keys".into());
    }
    *settings = next;
    *lock(&shared.provider) = crate::provider::Provider::Yahoo;
    shared.provider_revision.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    *lock(&shared.last_chart) = None;
    drop(settings);
    Ok(provider_changed(&app, &shared))
}

#[tauri::command]
pub async fn test_alpaca(shared: State<'_, Arc<Shared>>) -> Result<(), String> {
    let keys = crate::alpaca::load_keys(&crate::ai::env_path()).ok_or("No saved Alpaca keys")?;
    let feed = crate::provider::Feed::parse(&lock(&shared.settings).alpaca_feed)?;
    crate::alpaca::snapshot(&shared.http, &keys, feed, "AAPL").await.map(|_| ())
}

#[cfg(test)]
mod provider_tests {
    use super::*;
    #[test]
    fn status_has_no_credentials() {
        let payload = DataProvider { provider: "alpaca".into(), feed: "iex".into(), has_keys: true, stream: crate::stream::Status::Error("Authentication failed (402)".into()) };
        let json = serde_json::to_string(&payload).unwrap();
        for forbidden in ["TESTONLYSECRET", "secret", "key_id", "api_key"] { assert!(!json.contains(forbidden)); }
        assert!(json.contains("has_keys"));
    }
}

fn edit_drawings(shared: &Shared, symbol: String, drawings: Vec<crate::settings::Drawing>) -> Result<(), String> {
    let mut settings = lock(&shared.settings);
    let mut next = settings.clone();
    let symbol = symbol.trim().to_uppercase();
    if symbol.is_empty() { return Err("Invalid drawing symbol.".into()); }
    if drawings.is_empty() { next.drawings.remove(&symbol); }
    else { next.drawings.insert(symbol, drawings); }
    crate::settings::validate_drawings(&next.drawings)?;
    next.save(&shared.settings_path).map_err(|e| format!("Could not save drawings: {e}"))?;
    *settings = next;
    Ok(())
}

#[tauri::command]
pub fn set_drawings(shared: State<'_, Arc<Shared>>, symbol: String, drawings: Vec<crate::settings::Drawing>) -> Result<(), String> {
    edit_drawings(&shared, symbol, drawings)
}

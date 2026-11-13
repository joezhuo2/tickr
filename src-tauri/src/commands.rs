//! Commands invoked by the window.

use std::sync::Arc;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::ai::AiConfig;
use crate::alerts::{self, AlertKind, Direction, PriceAlert};
use crate::analysis::Analysis;
use crate::analyst::Consensus;
use crate::earnings::Earnings;
use crate::financials::Financials;
use crate::fundamentals::Fundamentals;
use crate::grades::RatingChange;
use crate::market::Market;
use crate::sp500::HeatQuote;
use crate::options::Options;
use crate::stats::Section;
use crate::news::Article;
use crate::barcache;
use crate::quote::{self, Candle, Chart, Quote, SearchHit};
use crate::ivrank::{self, IvRank};
use crate::screener::{self, ScreenRow};
use crate::settings::{EventFilter, ChartLayout, ChartTimeZone, Theme, Palette, validate_text_size, RefreshMode, ChartMode, ChartScale, Dots, Group, WatchlistSort, WatchlistView, WatchlistColumns, SavedScreen, ScreenRule, Keybinds, IndicatorConfig, IndicatorPreset, Settings, validate_indicators, DEFAULT_HOTKEY};
use crate::state::{lock, now_secs, QuoteState, Shared};
use crate::paper::{Costs as PaperCosts, PaperAccount};
use crate::practice::{PracticeRun, PracticeRuns};

#[derive(Serialize)]
pub struct Init {
    data_provider: DataProvider,
    symbol: String,
    range: String,
    interval: String,
    theme: Theme,
    text_size: u16,
    palette: Palette,
    chart_mode: ChartMode,
    refresh_mode: RefreshMode,
    background_chart_alerts: bool,
    chart_scale: ChartScale,
    chart_extended_hours: bool,
    chart_shade_sessions: bool,
    chart_time_zone: ChartTimeZone,
    chart_layout: ChartLayout,
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
    watchlist_sort: WatchlistSort,
    watchlist_view: WatchlistView,
    watchlist_columns: WatchlistColumns,
    screens: Vec<SavedScreen>,
    screen_columns: Vec<String>,
    event_filter: EventFilter,
    keybinds: Keybinds,
    dots: Dots,
    indicators: IndicatorConfig,
    drawings: std::collections::HashMap<String, Vec<crate::settings::Drawing>>,
    indicator_presets: Vec<IndicatorPreset>,
    alerts: Vec<PriceAlert>,
    recent_symbols: Vec<String>,
    recent_intervals: Vec<String>,
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
            && quote::resolve_interval(&s.range, &s.interval, s.chart_extended_hours).is_some_and(|(i, p)| c.interval == i && c.extended == p));
    let logo = lock(&shared.logo).clone().filter(|(sym, _)| *sym == s.symbol);
    let analyst = shared.analysts.cached(&s.symbol, now_secs());
    Init {
        data_provider: provider_payload(shared),
        symbol: s.symbol,
        range: s.range,
        interval: s.interval,
        theme: s.theme,
        text_size: s.text_size,
        palette: s.palette,
        chart_mode: s.chart_mode,
        refresh_mode: s.refresh_mode,
        background_chart_alerts: s.background_chart_alerts,
        chart_scale: s.chart_scale,
        chart_extended_hours: s.chart_extended_hours,
        chart_shade_sessions: s.chart_shade_sessions,
        chart_time_zone: s.chart_time_zone,
        chart_layout: s.chart_layout,
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
        watchlist_sort: s.watchlist_sort,
        watchlist_view: s.watchlist_view,
        watchlist_columns: s.watchlist_columns,
        screens: s.screens,
        screen_columns: s.screen_columns,
        event_filter: s.event_filter,
        keybinds: s.keybinds,
        dots: s.dots,
        indicators: s.indicators,
        drawings: s.drawings,
        indicator_presets: s.indicator_presets,
        alerts: s.alerts,
        recent_symbols: s.recent_symbols,
        recent_intervals: s.recent_intervals,
    }
}

#[tauri::command]
pub fn get_init(shared: State<'_, Arc<Shared>>) -> Init {
    init_payload(&shared)
}

#[tauri::command]
pub async fn get_chart(shared: State<'_, Arc<Shared>>, symbol: String, range: String, interval: String, extended: bool, secondary: Option<bool>) -> Result<Chart, String> {
    let revision = shared.revision();
    let chart = crate::provider::Provider::current(&shared).fetch_chart(&shared.http, &symbol, &range, &interval, extended).await?;
    if secondary != Some(true) && barcache::cacheable(&chart.interval) {
        let _bars = lock(&shared.bar_cache);
        barcache::record(&barcache::dir(&shared.settings_path), &barcache::key(&chart.source, &chart.meta.symbol, &chart.interval, chart.extended), &chart.candles);
    }
    let _settings = lock(&shared.settings);
    if shared.revision() != revision { return Err("Market data settings changed; try again".into()); }
    if secondary != Some(true) { *lock(&shared.last_chart) = Some(chart.clone()); }
    Ok(chart)
}

#[tauri::command]
pub async fn get_history(shared: State<'_, Arc<Shared>>, symbol: String, interval: String, start: i64, end: i64) -> Result<Chart, String> {
    let revision = shared.revision();
    let chart = crate::provider::Provider::current(&shared).fetch_period(&shared.http, &symbol, &interval, start, end).await?;
    let _settings = lock(&shared.settings);
    if shared.revision() != revision { return Err("Market data settings changed; try again".into()); }
    *lock(&shared.history) = Some(chart.clone());
    Ok(chart)
}

#[tauri::command]
pub async fn get_older(shared: State<'_, Arc<Shared>>, symbol: String, interval: String, start: i64, end: i64, extended: bool) -> Result<Vec<Candle>, String> {
    let symbol = symbol.trim().to_uppercase();
    let provider = crate::provider::Provider::current(&shared);
    let result = provider.fetch_older(&shared.http, &symbol, &interval, start, end, extended).await;
    if !barcache::cacheable(&interval) { return result.map(|(_, candles)| candles); }
    let prepost = extended && interval.ends_with('m');
    let dir = barcache::dir(&shared.settings_path);
    let _bars = lock(&shared.bar_cache);
    match result {
        Ok((source, candles)) if !candles.is_empty() => {
            barcache::record(&dir, &barcache::key(source, &symbol, &interval, prepost), &candles);
            Ok(candles)
        }
        other => {
            let cached = barcache::older_slice(&barcache::load(&dir, &barcache::key(provider.bar_source(&symbol), &symbol, &interval, prepost)), start, end);
            if cached.is_empty() { other.map(|(_, candles)| candles) } else { Ok(cached) }
        }
    }
}

#[tauri::command]
pub fn clear_bar_cache(shared: State<'_, Arc<Shared>>) -> Result<(), String> {
    let _bars = lock(&shared.bar_cache);
    match std::fs::remove_dir_all(barcache::dir(&shared.settings_path)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Could not clear cached history: {e}")),
        _ => Ok(()),
    }
}

fn history_for(shared: &Shared, symbol: &str, interval: &str) -> Result<Chart, String> {
    lock(&shared.history)
        .clone()
        .filter(|c| c.meta.symbol.eq_ignore_ascii_case(symbol.trim()) && c.interval == interval)
        .ok_or_else(|| "No history loaded for this symbol; start a new setup".into())
}

/// Technical analysis of the chart on screen.
/// Reuses the last fetched chart when it matches, so the analysis covers the
/// same candles the window shows; fetches otherwise.
#[tauri::command]
pub async fn analyze(shared: State<'_, Arc<Shared>>, symbol: String, range: String, interval: String, extended: bool, until: Option<i64>, candles: Option<Vec<Candle>>) -> Result<Analysis, String> {
    let revision = shared.revision();
    let cached = if range == quote::PERIOD_RANGE {
        Some(history_for(&shared, &symbol, &interval)?)
    } else {
        lock(&shared.last_chart)
            .clone()
            .filter(|c| c.meta.symbol.eq_ignore_ascii_case(symbol.trim()) && c.range == range
                && quote::resolve_interval(&range, &interval, extended).is_some_and(|(i, p)| c.interval == i && c.extended == p))
    };
    let chart = match cached {
        Some(c) => c,
        None => {
            let c = crate::provider::Provider::current(&shared).fetch_chart(&shared.http, &symbol, &range, &interval, extended).await?;
            let _settings = lock(&shared.settings);
            if shared.revision() != revision { return Err("Market data settings changed; try again".into()); }
            *lock(&shared.last_chart) = Some(c.clone());
            c
        }
    };
    let chart = match candles {
        Some(candles) => Chart { last_bar_time: candles.last().map(|c| c.t), candles, ..chart },
        None => chart,
    };
    let chart = match until {
        Some(t) => crate::analysis::reveal_until(&chart, t),
        None => chart,
    };
    let config = lock(&shared.settings).indicators.clone();
    let mut analysis = crate::analysis::analyze_with_config(&chart, &config).inspect_err(|e| log::info!("analyze {symbol} {range}: {e}"))?;
    if let Some(day) = crate::analysis::single_day(&chart).filter(|_| config.levels.visible) {
        let daily = crate::provider::Provider::current(&shared).fetch_chart(&shared.http, &symbol, "1mo", "1d", false).await;
        if let Ok(daily) = daily {
            crate::analysis::fill_prior_day(&mut analysis, &daily, day);
        }
    }
    Ok(analysis)
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
    crate::settings::push_recent(&mut settings.recent_symbols, &symbol);
    if let Err(e) = settings.save(&shared.settings_path) { log::warn!("save settings: {e}"); }
    *lock(&shared.quote) = state.clone();
    drop(settings);
    shared.stream_wake.notify_one();
    crate::tray::update(&app, &shared);
    shared.wake.notify_one();
    Ok(state)
}

#[tauri::command]
pub async fn open_chart_window(app: AppHandle, symbol: String) -> Result<(), String> {
    let symbol = symbol.trim().to_uppercase();
    if symbol.is_empty() {
        return Err("empty symbol".into());
    }
    crate::window::open_chart(&app, &symbol).map_err(|e| e.to_string())
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
        if !quote::interval_supported(&range, &s.interval) {
            s.interval = "auto".into();
        }
        s.range = range;
    });
    Ok(())
}

#[tauri::command]
pub fn set_interval(shared: State<'_, Arc<Shared>>, interval: String) -> Result<(), String> {
    if interval != "auto" && !quote::interval_supported(&lock(&shared.settings).range, &interval) {
        return Err(format!("unknown interval {interval}"));
    }
    shared.update_settings(|s| {
        crate::settings::remember_interval(&mut s.recent_intervals, &interval);
        s.interval = interval;
    });
    Ok(())
}

#[tauri::command]
pub fn set_theme(app: AppHandle, shared: State<'_, Arc<Shared>>, theme: Theme) -> Result<(), String> {
    for win in app.webview_windows().into_values() {
        win.set_background_color(Some(crate::window::background(theme))).map_err(|e| e.to_string())?;
    }
    shared.update_settings(|s| s.theme = theme);
    crate::tray::update(&app, &shared);
    Ok(())
}

#[tauri::command]
pub fn set_text_size(app: AppHandle, shared: State<'_, Arc<Shared>>, percent: u16) -> Result<(), String> {
    validate_text_size(percent)?;
    for win in app.webview_windows().into_values() {
        win.set_zoom(f64::from(percent) / 100.0).map_err(|e| e.to_string())?;
    }
    shared.update_settings(|s| s.text_size = percent);
    Ok(())
}

#[tauri::command]
pub fn set_palette(app: AppHandle, shared: State<'_, Arc<Shared>>, palette: Palette) {
    shared.update_settings(|s| s.palette = palette);
    crate::tray::update(&app, &shared);
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
pub fn set_background_chart_alerts(shared: State<'_, Arc<Shared>>, enabled: bool) {
    shared.update_settings(|s| s.background_chart_alerts = enabled);
}

#[tauri::command]
pub fn set_chart_scale(shared: State<'_, Arc<Shared>>, scale: ChartScale) {
    shared.update_settings(|s| s.chart_scale = scale);
}

#[tauri::command]
pub fn set_chart_extended_hours(shared: State<'_, Arc<Shared>>, enabled: bool) {
    shared.update_settings(|s| s.chart_extended_hours = enabled);
}

#[tauri::command]
pub fn set_chart_shade_sessions(shared: State<'_, Arc<Shared>>, enabled: bool) {
    shared.update_settings(|s| s.chart_shade_sessions = enabled);
}

#[tauri::command]
pub fn set_chart_time_zone(shared: State<'_, Arc<Shared>>, zone: ChartTimeZone) {
    shared.update_settings(|s| s.chart_time_zone = zone);
}

#[tauri::command]
pub fn set_chart_layout(shared: State<'_, Arc<Shared>>, layout: ChartLayout) -> Result<ChartLayout, String> {
    let layout = layout.cleaned()?;
    shared.update_settings(|s| {
        crate::settings::remember_interval(&mut s.recent_intervals, &layout.interval);
        s.chart_layout = layout.clone();
    });
    Ok(layout)
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
pub fn export_settings(shared: State<'_, Arc<Shared>>) -> Result<String, String> {
    crate::backup::export(&lock(&shared.settings), env!("CARGO_PKG_VERSION"), now_secs())
}

#[tauri::command]
pub fn import_settings(app: AppHandle, shared: State<'_, Arc<Shared>>, text: String) -> Result<(), String> {
    let mut next = crate::backup::parse(&text)?;
    let mut settings = lock(&shared.settings);
    next.data_provider = settings.data_provider.clone();
    next.alpaca_feed = settings.alpaca_feed.clone();
    next.geometry = settings.geometry;
    next.autostart = settings.autostart;
    let old_hotkey = settings.hotkey.clone();
    crate::hotkey::swap(&app, &old_hotkey, &next.hotkey)?;
    if let Err(e) = next.save(&shared.settings_path) {
        let _ = crate::hotkey::swap(&app, &next.hotkey, &old_hotkey);
        return Err(format!("Could not save imported settings: {e}"));
    }
    *settings = next;
    let (theme, text_size) = (settings.theme, settings.text_size);
    drop(settings);
    lock(&shared.alert_prices).clear();
    *lock(&shared.hotkey_error) = None;
    for win in app.webview_windows().into_values() {
        let _ = win.set_background_color(Some(crate::window::background(theme)));
        let _ = win.set_zoom(f64::from(text_size) / 100.0);
    }
    crate::tray::update(&app, &shared);
    shared.wake.notify_one();
    Ok(())
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
    #[serde(default)]
    pub has_key: bool,
}

fn ai_prefs_for_page(enabled: bool, mut config: AiConfig) -> AiPrefs {
    let has_key = !config.api_key.trim().is_empty();
    config.api_key.clear();
    AiPrefs { enabled, config, has_key }
}

fn keep_stored_key(mut config: AiConfig, stored: AiConfig) -> AiConfig {
    if config.api_key.trim().is_empty() {
        config.api_key = stored.api_key;
    }
    config
}

#[tauri::command]
pub fn get_ai_config(shared: State<'_, Arc<Shared>>) -> AiPrefs {
    ai_prefs_for_page(lock(&shared.settings).ai_news, crate::ai::load_config(&crate::ai::env_path()))
}

#[tauri::command]
pub fn set_ai_config(shared: State<'_, Arc<Shared>>, prefs: AiPrefs) -> Result<(), String> {
    let path = crate::ai::env_path();
    let config = keep_stored_key(prefs.config, crate::ai::load_config(&path));
    crate::ai::save_config(&path, &config).map_err(|e| format!("Could not save AI settings: {e}"))?;
    shared.update_settings(|s| s.ai_news = prefs.enabled);
    Ok(())
}

#[derive(Serialize)]
pub struct AiTestResult {
    model: String,
    ok: bool,
    ms: u64,
    error: Option<String>,
}

#[tauri::command]
pub async fn test_ai(shared: State<'_, Arc<Shared>>) -> Result<Vec<AiTestResult>, String> {
    let cfg = crate::ai::load_config(&crate::ai::env_path());
    let models = crate::ai::test_models(&cfg);
    if cfg.base_url.trim().is_empty() || models.is_empty() {
        return Err("Base URL and a model are needed to test AI.".into());
    }
    let mut results = Vec::new();
    for model in models {
        let start = std::time::Instant::now();
        let result = crate::ai::chat(&shared.http, &cfg, crate::ai::test_body(&model), std::time::Duration::from_secs(20))
            .await.and_then(|body| crate::ai::reply_content(&body));
        lock(&shared.connections).ai.record(&result, now_secs());
        results.push(AiTestResult { model, ok: result.is_ok(), ms: start.elapsed().as_millis() as u64, error: result.err() });
    }
    Ok(results)
}

#[tauri::command]
pub fn clear_ai_key() -> Result<(), String> {
    let path = crate::ai::env_path();
    let config = AiConfig { api_key: String::new(), ..crate::ai::load_config(&path) };
    crate::ai::save_config(&path, &config).map_err(|e| format!("Could not clear the AI key: {e}"))
}

#[tauri::command]
pub fn send_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    notification_permission(&app)?;
    let clip = |s: String, n: usize| s.chars().take(n).collect::<String>();
    app.notification()
        .builder()
        .title(clip(title, 80))
        .body(clip(body, 240))
        .show()
        .map_err(|e| e.to_string())
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
    let result = edit_alerts(&shared, |alerts| alerts::add(alerts, symbol, kind, direction, level, recurring, cooldown_mins, regular_only))?;
    shared.wake.notify_one();
    Ok(result)
}

#[tauri::command]
pub fn update_alert(shared: State<'_, Arc<Shared>>, id: u32, level: f64, direction: Direction) -> Result<Vec<PriceAlert>, String> {
    let result = edit_alerts(&shared, |alerts| alerts::update(alerts, id, level, direction))?;
    lock(&shared.alert_prices).remove(&id);
    shared.wake.notify_one();
    Ok(result)
}

#[tauri::command]
pub fn duplicate_alert(shared: State<'_, Arc<Shared>>, id: u32) -> Result<Vec<PriceAlert>, String> {
    edit_alerts(&shared, |alerts| alerts::duplicate(alerts, id))
}

#[tauri::command]
pub fn set_alert_enabled(app: AppHandle, shared: State<'_, Arc<Shared>>, id: u32, enabled: bool) -> Result<Vec<PriceAlert>, String> {
    if enabled {
        notification_permission(&app)?;
    }
    let result = edit_alerts(&shared, |alerts| alerts::set_enabled(alerts, id, enabled))?;
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
pub async fn get_analyst(shared: State<'_, Arc<Shared>>, symbol: String, force: Option<bool>) -> Result<Option<Consensus>, String> {
    shared.analysts.get(&symbol, now_secs(), force.unwrap_or(false)).await.inspect_err(|e| log::warn!("analyst {symbol}: {e}"))
}

#[tauri::command]
pub async fn get_earnings(shared: State<'_, Arc<Shared>>, symbol: String) -> Result<Option<Earnings>, String> {
    crate::earnings::fetch(&shared.analysts, &shared.calendar, &symbol).await.inspect_err(|e| log::warn!("earnings {symbol}: {e}"))
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
pub async fn get_financials(shared: State<'_, Arc<Shared>>, symbol: String, force: Option<bool>) -> Result<Option<Financials>, String> {
    crate::financials::get(&shared.analysts, &shared.financials, &symbol, now_secs(), force.unwrap_or(false))
        .await
        .inspect_err(|e| log::warn!("financials {symbol}: {e}"))
}

#[tauri::command]
pub async fn get_market(shared: State<'_, Arc<Shared>>) -> Result<Market, String> {
    crate::market::fetch(&shared.analysts).await.inspect_err(|e| log::warn!("market: {e}"))
}

#[tauri::command]
pub async fn get_heatmap(shared: State<'_, Arc<Shared>>) -> Result<Vec<HeatQuote>, String> {
    crate::sp500::fetch(&shared.analysts).await.inspect_err(|e| log::warn!("heatmap: {e}"))
}

#[tauri::command]
pub async fn get_options(shared: State<'_, Arc<Shared>>, symbol: String, date: Option<i64>) -> Result<Options, String> {
    crate::options::fetch(&shared.analysts, &symbol, date).await.inspect_err(|e| log::warn!("options {symbol}: {e}"))
}

/// Recent headlines for the symbol, newest first.
#[tauri::command]
pub async fn get_news(shared: State<'_, Arc<Shared>>, symbol: String) -> Result<Vec<Article>, String> {
    let result = crate::news::fetch(&shared.http, &symbol).await;
    lock(&shared.connections).news.record(&result, now_secs());
    let mut list = result.inspect_err(|e| log::warn!("news {symbol}: {e}"))?;
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
            let result = crate::news::fetch(&shared.http, &symbol).await;
            lock(&shared.connections).news.record(&result, now_secs());
            let mut list = result.inspect_err(|e| log::warn!("news {symbol}: {e}"))?;
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

#[tauri::command]
pub async fn get_events(shared: State<'_, Arc<Shared>>, force: bool, start: Option<String>) -> Result<crate::events::EventsReport, String> {
    crate::events::fetch(&shared.analysts, start.as_deref(), force).await.inspect_err(|e| log::warn!("events: {e}"))
}

#[tauri::command]
pub fn set_event_filter(shared: State<'_, Arc<Shared>>, filter: EventFilter) -> Result<EventFilter, String> {
    let filter = filter.cleaned()?;
    shared.update_settings(|s| s.event_filter = filter.clone());
    Ok(filter)
}

#[tauri::command]
pub async fn get_watch_calendar(shared: State<'_, Arc<Shared>>, force: Option<bool>) -> Result<Vec<crate::calendar::Dates>, String> {
    let symbols = clean_symbols(lock(&shared.settings).watchlist.clone());
    if symbols.len() > crate::calendar::MAX_SYMBOLS {
        return Err(format!("The calendar supports at most {} watchlist symbols", crate::calendar::MAX_SYMBOLS));
    }
    let (now, force) = (now_secs(), force.unwrap_or(false));
    let shared: Arc<Shared> = shared.inner().clone();
    let tasks: Vec<_> = symbols
        .into_iter()
        .map(|symbol| {
            let shared = shared.clone();
            tauri::async_runtime::spawn(async move { shared.calendar.get(&shared.analysts, &symbol, now, force).await })
        })
        .collect();
    let mut out = Vec::with_capacity(tasks.len());
    for t in tasks {
        out.push(t.await.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// AI analysis of one event, run when the user opens it.
#[tauri::command]
pub async fn analyze_event(shared: State<'_, Arc<Shared>>, event: crate::events::MarketEvent, force: Option<bool>) -> Result<crate::events::EventAnalysis, String> {
    let start = now_secs();
    let result = crate::events::analyze(&shared.http, &event, force.unwrap_or(false)).await;
    if result.as_ref().map_or(true, |a| a.generated >= start) {
        lock(&shared.connections).ai.record(&result, now_secs());
    }
    result.inspect_err(|e| log::warn!("event analysis {}: {e}", event.name))
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
pub(crate) fn clean_symbols(symbols: Vec<String>) -> Vec<String> {
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
pub(crate) fn clean_groups(groups: Vec<Group>, watchlist: &[String]) -> Vec<Group> {
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

#[tauri::command]
pub fn set_watchlist_sort(shared: State<'_, Arc<Shared>>, sort: WatchlistSort) {
    shared.update_settings(|s| s.watchlist_sort = sort);
}

#[tauri::command]
pub fn set_watchlist_view(shared: State<'_, Arc<Shared>>, view: WatchlistView) {
    shared.update_settings(|s| s.watchlist_view = view);
}

#[tauri::command]
pub fn set_watchlist_columns(shared: State<'_, Arc<Shared>>, columns: WatchlistColumns) {
    shared.update_settings(|s| s.watchlist_columns = columns);
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
    let provider = crate::provider::Provider::current(&shared);
    provider.overlay_quotes(&shared.http, out.iter_mut().filter_map(|w| w.quote.as_mut()).collect()).await;
    Ok(out)
}

async fn screen_symbol(shared: &Shared, provider: &crate::provider::Provider, symbol: String, revision: u64) -> ScreenRow {
    if let Some(row) = shared.screener.cached(&symbol, now_secs(), revision) {
        return row;
    }
    let Ok(_permit) = shared.screener.limit().acquire_owned().await else {
        return ScreenRow::failed(symbol, "Screener unavailable".into());
    };
    if let Some(row) = shared.screener.cached(&symbol, now_secs(), revision) {
        return row;
    }
    match provider.fetch_chart(&shared.http, &symbol, screener::RANGE, screener::INTERVAL, false).await {
        Ok(chart) => {
            let mut row = ScreenRow::from_candles(symbol, &chart.candles);
            if let Ok(a) = crate::analysis::analyze_with_config(&chart, &Default::default()) {
                (row.score, row.bias) = (Some(a.score), Some(a.bias));
            }
            if row.error.is_none() && shared.revision() == revision {
                shared.screener.store(&row, now_secs(), revision);
            }
            row
        }
        Err(e) => ScreenRow::failed(symbol, e),
    }
}

#[tauri::command]
pub async fn get_screener_data(shared: State<'_, Arc<Shared>>, symbols: Vec<String>) -> Result<Vec<ScreenRow>, String> {
    let starred = lock(&shared.settings).watchlist.clone();
    let symbols: Vec<String> = clean_symbols(symbols).into_iter().filter(|s| starred.contains(s)).collect();
    let revision = shared.revision();
    let provider = crate::provider::Provider::current(&shared);
    let shared: Arc<Shared> = shared.inner().clone();
    let tasks: Vec<_> = symbols
        .into_iter()
        .map(|symbol| {
            let (shared, provider) = (shared.clone(), provider.clone());
            tauri::async_runtime::spawn(async move { screen_symbol(&shared, &provider, symbol, revision).await })
        })
        .collect();
    let mut out = Vec::with_capacity(tasks.len());
    for t in tasks {
        out.push(t.await.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

async fn fundamentals_for(shared: &Shared, symbol: String) -> Fundamentals {
    if let Some(f) = shared.screener.cached_fundamentals(&symbol, now_secs()) {
        return f;
    }
    let Ok(_permit) = shared.screener.limit().acquire_owned().await else {
        return Fundamentals { symbol, error: Some("Screener unavailable".into()), ..Fundamentals::default() };
    };
    if let Some(f) = shared.screener.cached_fundamentals(&symbol, now_secs()) {
        return f;
    }
    match crate::fundamentals::fetch(&shared.analysts, &symbol).await {
        Ok(f) => {
            shared.screener.store_fundamentals(&f, now_secs());
            f
        }
        Err(e) => Fundamentals { symbol, error: Some(e), ..Fundamentals::default() },
    }
}

#[tauri::command]
pub async fn get_screener_fundamentals(shared: State<'_, Arc<Shared>>, symbols: Vec<String>) -> Result<Vec<Fundamentals>, String> {
    let starred = lock(&shared.settings).watchlist.clone();
    let symbols: Vec<String> = clean_symbols(symbols).into_iter().filter(|s| starred.contains(s)).collect();
    let shared: Arc<Shared> = shared.inner().clone();
    let tasks: Vec<_> = symbols
        .into_iter()
        .map(|symbol| {
            let shared = shared.clone();
            tauri::async_runtime::spawn(async move { fundamentals_for(&shared, symbol).await })
        })
        .collect();
    let mut out = Vec::with_capacity(tasks.len());
    for t in tasks {
        out.push(t.await.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn set_screen_columns(shared: State<'_, Arc<Shared>>, columns: Vec<String>) {
    shared.update_settings(|s| s.screen_columns = columns.into_iter().filter(|c| !c.is_empty() && c.len() <= 32).take(40).collect());
}

#[tauri::command]
pub async fn get_iv_ranks(shared: State<'_, Arc<Shared>>, symbols: Vec<String>) -> Result<Vec<IvRank>, String> {
    let starred = lock(&shared.settings).watchlist.clone();
    let symbols: Vec<String> = clean_symbols(symbols).into_iter().filter(|s| starred.contains(s)).collect();
    let revision = shared.revision();
    let provider = crate::provider::Provider::current(&shared);
    let shared: Arc<Shared> = shared.inner().clone();
    let tasks: Vec<_> = symbols
        .into_iter()
        .map(|symbol| {
            let (shared, provider) = (shared.clone(), provider.clone());
            tauri::async_runtime::spawn(async move {
                let (iv, error) = match shared.ivrank.iv(&shared.analysts, &symbol, now_secs()).await {
                    Ok(iv) => (iv, None),
                    Err(e) => (None, Some(e)),
                };
                let range = match iv {
                    Some(_) => screen_symbol(&shared, &provider, symbol.clone(), revision).await.rv_range,
                    None => None,
                };
                IvRank { rank: iv.zip(range).map(|(iv, r)| ivrank::rank(iv, r)), symbol, iv, error }
            })
        })
        .collect();
    let mut out = Vec::with_capacity(tasks.len());
    for t in tasks {
        out.push(t.await.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn edit_screens(shared: &Shared, edit: impl FnOnce(&mut Settings) -> Result<(), String>) -> Result<Vec<SavedScreen>, String> {
    let mut settings = lock(&shared.settings);
    let mut next = settings.clone();
    edit(&mut next)?;
    next.save(&shared.settings_path).map_err(|e| format!("Could not save filters: {e}"))?;
    *settings = next.clone();
    Ok(next.screens)
}

#[tauri::command]
pub fn save_screen(shared: State<'_, Arc<Shared>>, name: String, rules: Vec<ScreenRule>) -> Result<Vec<SavedScreen>, String> {
    edit_screens(&shared, |s| s.save_screen(&name, rules))
}

#[tauri::command]
pub fn delete_screen(shared: State<'_, Arc<Shared>>, name: String) -> Result<Vec<SavedScreen>, String> {
    edit_screens(&shared, |s| {
        s.delete_screen(&name);
        Ok(())
    })
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

fn store_paper(shared: &Shared, account: PaperAccount) -> Result<PaperAccount, String> {
    account.validate()?;
    let mut current = lock(&shared.paper);
    account.save(&shared.paper_path).map_err(|e| format!("Could not save paper account: {e}"))?;
    *current = account.clone();
    Ok(account)
}

#[tauri::command]
pub fn get_paper(shared: State<'_, Arc<Shared>>) -> PaperAccount {
    lock(&shared.paper).clone()
}

#[tauri::command]
pub fn save_paper(shared: State<'_, Arc<Shared>>, account: PaperAccount) -> Result<PaperAccount, String> {
    store_paper(&shared, account)
}

#[tauri::command]
pub fn reset_paper(shared: State<'_, Arc<Shared>>, starting_cash: f64, costs: Option<PaperCosts>) -> Result<PaperAccount, String> {
    let costs = costs.unwrap_or(lock(&shared.paper).costs);
    store_paper(&shared, PaperAccount::new(starting_cash, costs))
}

fn store_practice(shared: &Shared, edit: impl FnOnce(&PracticeRuns) -> Result<PracticeRuns, String>) -> Result<Vec<PracticeRun>, String> {
    let mut current = lock(&shared.practice);
    let next = edit(&current)?;
    next.save(&shared.practice_path).map_err(|e| format!("Could not save practice runs: {e}"))?;
    *current = next;
    Ok(current.runs.clone())
}

#[tauri::command]
pub fn practice_runs(shared: State<'_, Arc<Shared>>) -> Vec<PracticeRun> {
    lock(&shared.practice).runs.clone()
}

#[tauri::command]
pub fn save_practice_run(shared: State<'_, Arc<Shared>>, run: PracticeRun) -> Result<Vec<PracticeRun>, String> {
    store_practice(&shared, |runs| runs.upsert(run))
}

#[tauri::command]
pub fn delete_practice_run(shared: State<'_, Arc<Shared>>, id: u64) -> Result<Vec<PracticeRun>, String> {
    store_practice(&shared, |runs| Ok(PracticeRuns { runs: runs.runs.iter().filter(|r| r.id != id).cloned().collect() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_account_saves_to_its_own_file_and_rejections_change_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        assert_eq!(*lock(&shared.paper), PaperAccount::default());
        let mut account = PaperAccount::new(25_000.0, PaperCosts { commission: 1.0, commission_bps: 0.0, slippage_bps: 5.0 });
        account.cash = 24_000.0;
        let saved = store_paper(&shared, account.clone()).unwrap();
        assert_eq!(saved, account);
        assert_eq!(PaperAccount::load(&dir.path().join("paper.json")), account);
        let mut bad = account.clone();
        bad.cash = f64::NAN;
        assert!(store_paper(&shared, bad).is_err());
        assert_eq!(*lock(&shared.paper), account);
        assert_eq!(PaperAccount::load(&shared.paper_path), account);
        assert!(store_paper(&shared, PaperAccount::new(1.0, account.costs)).is_err());
        let costs = lock(&shared.paper).costs;
        let reset = store_paper(&shared, PaperAccount::new(50_000.0, costs)).unwrap();
        assert_eq!(reset.cash, 50_000.0);
        assert_eq!(reset.costs, account.costs);
        let reloaded = Shared::new(dir.path().join("settings.json"), Default::default());
        assert_eq!(lock(&reloaded.paper).cash, 50_000.0);
        let blocker = dir.path().join("file");
        std::fs::write(&blocker, "not a directory").unwrap();
        let shared = Shared::new(blocker.join("settings.json"), Default::default());
        assert!(store_paper(&shared, account).is_err());
        assert_eq!(*lock(&shared.paper), PaperAccount::default());
    }

    #[test]
    fn screen_edits_persist_and_rejections_leave_settings_unchanged() {
        use crate::settings::ScreenOp;
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        let rules = vec![ScreenRule { kind: "rsi".into(), op: ScreenOp::Below, value: 30.0, value2: None, values: Vec::new() }];
        let saved = edit_screens(&shared, |s| s.save_screen("Oversold", rules.clone())).unwrap();
        assert_eq!(saved, [SavedScreen { name: "Oversold".into(), rules: rules.clone() }]);
        assert_eq!(Settings::load(&shared.settings_path).screens, saved);
        assert_eq!(init_payload(&shared).screens, saved);
        assert!(edit_screens(&shared, |s| s.save_screen("Bad", vec![])).is_err());
        assert_eq!(Settings::load(&shared.settings_path).screens, saved);
        assert_eq!(lock(&shared.settings).screens, saved);
        let left = edit_screens(&shared, |s| { s.delete_screen("oversold"); Ok(()) }).unwrap();
        assert!(left.is_empty());
        assert!(Settings::load(&shared.settings_path).screens.is_empty());
    }

    #[test]
    fn event_filter_is_saved_cleaned_and_sent_to_the_window() {
        use crate::settings::EventImportance;
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        assert_eq!(init_payload(&shared).event_filter, EventFilter::default());
        let filter = EventFilter { countries: vec!["gb".into(), "US".into()], importance: EventImportance::High }.cleaned().unwrap();
        shared.update_settings(|s| s.event_filter = filter.clone());
        assert_eq!(init_payload(&shared).event_filter, filter);
        assert_eq!(Settings::load(&shared.settings_path).event_filter.countries, ["GB", "US"]);
    }

    #[test]
    fn drawing_edits_validate_and_persist_atomically() {
        use crate::settings::{Drawing, DrawingPoint};
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        let d = Drawing { id: 1, kind: "hline".into(), points: vec![DrawingPoint { t: 100, price: 10.0 }], text: String::new(), color: "#ef4444".into(), width: 2, dashed: true, locked: true, hidden: true, created: 0, edited: 0 };
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
        for count in [0, 1, 501] {
            let mut bad = d.clone(); bad.kind = "pen".into(); bad.points = vec![d.points[0].clone(); count]; invalid.push(vec![bad]);
        }
        let mut bad = d.clone(); bad.kind = "pen".into(); bad.points.push(bad.points[0].clone()); bad.text = "no".into(); invalid.push(vec![bad]);
        for color in ["red", "#12345", "#12345g"] {
            let mut bad = d.clone(); bad.color = color.into(); invalid.push(vec![bad]);
        }
        let mut bad = d.clone(); bad.width = 5; invalid.push(vec![bad]);
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
        let mut pen = d.clone(); pen.id = 3; pen.kind = "pen".into(); pen.points = vec![d.points[0].clone(); 500];
        edit_drawings(&shared, "AAPL".into(), vec![text, trend, pen]).unwrap();
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
        let mut chart = quote::parse_chart(include_bytes!("../../fixtures/chart-1d-post.json"), "1d", "5m").unwrap();
        chart.extended = true;
        *lock(&shared.last_chart) = Some(chart.clone());
        for interval in ["auto", "5m", "invalid"] {
            lock(&shared.settings).interval = interval.into();
            assert!(init_payload(&shared).chart.is_some());
        }
        lock(&shared.settings).interval = "60m".into();
        assert!(init_payload(&shared).chart.is_none());
        lock(&shared.settings).interval = "5m".into();
        lock(&shared.settings).chart_extended_hours = false;
        assert!(init_payload(&shared).chart.is_none());
        chart.extended = false;
        *lock(&shared.last_chart) = Some(chart);
        assert!(init_payload(&shared).chart.is_some());
        lock(&shared.settings).chart_extended_hours = true;
        assert!(init_payload(&shared).chart.is_none());
    }

    #[test]
    fn history_is_kept_apart_from_the_live_chart() {
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        assert!(history_for(&shared, "AAPL", "1d").is_err());
        let chart = quote::parse_period(include_bytes!("../../fixtures/chart-period-1d.json"), "1d", 1735689600, 1743465600).unwrap();
        *lock(&shared.history) = Some(chart.clone());
        assert_eq!(history_for(&shared, " aapl ", "1d").unwrap(), chart);
        assert!(history_for(&shared, "AAPL", "1wk").is_err());
        assert!(history_for(&shared, "MSFT", "1d").is_err());
        assert!(lock(&shared.last_chart).is_none());
        assert!(init_payload(&shared).chart.is_none());
    }

    #[test]
    fn tray_extended_setting_does_not_change_chart_candles() {
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        let mut chart = quote::parse_chart(include_bytes!("../../fixtures/chart-1d-post.json"), "1d", "5m").unwrap();
        chart.extended = true;
        *lock(&shared.last_chart) = Some(chart);
        lock(&shared.settings).show_extended = false;
        assert!(init_payload(&shared).chart.is_some());
        lock(&shared.settings).chart_extended_hours = false;
        lock(&shared.settings).show_extended = true;
        assert!(init_payload(&shared).chart.is_none());
    }

    #[test]
    fn alert_edits_save_and_clear_paused_or_deleted_baselines() {
        let dir = tempfile::tempdir().unwrap();
        let shared = Shared::new(dir.path().join("settings.json"), Default::default());
        edit_alerts(&shared, |alerts| {
            alerts.push(PriceAlert { id: 1, symbol: "AAPL".into(), direction: Direction::Above, level: 100.0, enabled: true, triggered_at: None, kind: AlertKind::Price, reference: None, recurring: false, cooldown_mins: 15, regular_only: false, triggered_price: None });
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
            alerts.push(PriceAlert { id: 1, symbol: "AAPL".into(), direction: Direction::Above, level: 100.0, enabled: true, triggered_at: None, kind: AlertKind::Price, reference: None, recurring: false, cooldown_mins: 15, regular_only: false, triggered_price: None });
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
    let _ = app.emit("data-provider", &payload);
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
    fn ai_key_never_reaches_the_page() {
        let config = AiConfig { model: "m".into(), api_key: "TESTONLYSECRET".into(), ..Default::default() };
        let page = ai_prefs_for_page(true, config.clone());
        assert!(page.has_key);
        assert!(!serde_json::to_string(&page).unwrap().contains("TESTONLYSECRET"));
        assert!(!ai_prefs_for_page(true, AiConfig { api_key: "  ".into(), ..Default::default() }).has_key);
    }
    #[test]
    fn blank_key_keeps_the_stored_one() {
        let stored = AiConfig { api_key: "old".into(), ..Default::default() };
        let blank = AiConfig { model: "m".into(), api_key: " ".into(), ..Default::default() };
        let kept = keep_stored_key(blank, stored.clone());
        assert_eq!((kept.model.as_str(), kept.api_key.as_str()), ("m", "old"));
        let typed = AiConfig { api_key: "new".into(), ..Default::default() };
        assert_eq!(keep_stored_key(typed, stored).api_key, "new");
    }
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

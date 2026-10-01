//! Commands invoked by the window.

use std::sync::Arc;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::quote::{self, Chart, SearchHit};
use crate::settings::{ChartMode, DEFAULT_HOTKEY};
use crate::state::{lock, now_secs, QuoteState, Shared};

#[derive(Serialize)]
pub struct Init {
    symbol: String,
    range: String,
    chart_mode: ChartMode,
    hotkey: String,
    default_hotkey: &'static str,
    quote: QuoteState,
    /// Last chart viewed, when it matches the current symbol and range.
    chart: Option<Chart>,
    /// Logo data URI; only meaningful when `logo_known`.
    logo: Option<String>,
    logo_known: bool,
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
    Init {
        symbol: s.symbol,
        range: s.range,
        chart_mode: s.chart_mode,
        hotkey: s.hotkey,
        default_hotkey: DEFAULT_HOTKEY,
        quote: lock(&shared.quote).clone(),
        chart,
        logo_known: logo.is_some(),
        logo: logo.and_then(|(_, b)| b).map(|b| data_uri(&b)),
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
    Ok(hotkey)
}

/// Logo as a data: URI, or None when the symbol has no logo.
#[tauri::command]
pub async fn get_logo(shared: State<'_, Arc<Shared>>, symbol: String) -> Result<Option<String>, String> {
    let bytes = crate::logo::get(&shared.http, &symbol).await;
    Ok(bytes.map(|b| data_uri(&b)))
}

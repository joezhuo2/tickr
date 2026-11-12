//! App settings, stored as JSON in the OS config dir.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Cmd+Shift+K on macOS ("Super" is Cmd there), Ctrl+Alt+K elsewhere.
#[cfg(target_os = "macos")]
pub const DEFAULT_HOTKEY: &str = "Super+Shift+K";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_HOTKEY: &str = "Ctrl+Alt+K";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChartMode {
    #[default]
    Line,
    Area,
    Baseline,
    Candles,
    Hollow,
    Bars,
    Heikin,
    Renko,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Palette {
    #[default]
    Standard,
    Accessible,
}

pub fn validate_text_size(percent: u16) -> Result<(), String> {
    if ![100, 110, 125, 150].contains(&percent) {
        return Err("Text size must be 100, 110, 125 or 150 percent".into());
    }
    Ok(())
}

fn deserialize_text_size<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<u16, D::Error> {
    let percent = u16::deserialize(deserializer)?;
    validate_text_size(percent).map_err(serde::de::Error::custom)?;
    Ok(percent)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RefreshMode {
    #[default]
    Balanced,
    LowPower,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChartScale {
    #[default]
    Linear,
    Log,
    Percent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChartTimeZone {
    #[default]
    Exchange,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SplitOrientation {
    #[default]
    Side,
    Stacked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ChartLayout {
    pub split: bool,
    pub orientation: SplitOrientation,
    pub sync_range: bool,
    pub symbol: String,
    pub range: String,
    pub interval: String,
}

impl Default for ChartLayout {
    fn default() -> Self {
        Self { split: false, orientation: SplitOrientation::Side, sync_range: false, symbol: String::new(), range: String::new(), interval: "auto".into() }
    }
}

impl ChartLayout {
    pub fn cleaned(self) -> Result<Self, String> {
        let symbol = self.symbol.trim().to_uppercase();
        if symbol.chars().count() > 32 || !symbol.chars().all(|c| c.is_ascii_alphanumeric() || ".-^=_".contains(c)) {
            return Err("Invalid second chart symbol".into());
        }
        if !self.range.is_empty() && crate::quote::interval_for(&self.range).is_none() {
            return Err(format!("unknown range {}", self.range));
        }
        if self.interval != "auto" && !crate::quote::intervals_for(&self.range).contains(&self.interval.as_str()) {
            return Err(format!("unknown interval {}", self.interval));
        }
        Ok(Self { symbol, ..self })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum WatchlistSortKey {
    #[default]
    Change,
    Price,
    Volume,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum WatchlistSortDir {
    #[default]
    Desc,
    Asc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct WatchlistSort {
    pub key: WatchlistSortKey,
    pub dir: WatchlistSortDir,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum WatchlistView {
    #[default]
    Cards,
    Heatmap,
    Table,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct WatchlistColumns {
    pub score: bool,
    pub rsi: bool,
    pub earnings: bool,
    pub iv_rank: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenKind {
    Rsi,
    Sma,
    Change,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenOp {
    Above,
    Below,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum EventImportance {
    #[default]
    All,
    Key,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct EventFilter {
    pub countries: Vec<String>,
    pub importance: EventImportance,
}

impl Default for EventFilter {
    fn default() -> Self {
        Self { countries: vec!["US".into()], importance: EventImportance::All }
    }
}

const MAX_EVENT_COUNTRIES: usize = 100;

impl EventFilter {
    pub fn cleaned(self) -> Result<Self, String> {
        let mut countries: Vec<String> = Vec::with_capacity(self.countries.len());
        for c in self.countries {
            let c = c.trim().to_uppercase();
            if !(2..=3).contains(&c.len()) || !c.bytes().all(|b| b.is_ascii_uppercase()) {
                return Err(format!("Invalid country code {c:?}"));
            }
            if !countries.contains(&c) {
                countries.push(c);
            }
        }
        if countries.len() > MAX_EVENT_COUNTRIES {
            return Err(format!("At most {MAX_EVENT_COUNTRIES} countries can be selected"));
        }
        countries.sort();
        Ok(Self { countries, importance: self.importance })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ScreenRule {
    pub kind: ScreenKind,
    pub op: ScreenOp,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedScreen {
    pub name: String,
    pub rules: Vec<ScreenRule>,
}

pub const SCREEN_SMA_LENGTHS: [u32; 3] = [20, 50, 200];
const MAX_SCREENS: usize = 50;
const MAX_SCREEN_RULES: usize = 10;

pub fn validate_screen_rules(rules: &[ScreenRule]) -> Result<(), String> {
    if !(1..=MAX_SCREEN_RULES).contains(&rules.len()) {
        return Err(format!("A filter needs 1 to {MAX_SCREEN_RULES} rules"));
    }
    for r in rules {
        if !r.value.is_finite() {
            return Err("Rule values must be numbers".into());
        }
        match r.kind {
            ScreenKind::Rsi if !(0.0..=100.0).contains(&r.value) => return Err("RSI must be from 0 to 100".into()),
            ScreenKind::Sma if !SCREEN_SMA_LENGTHS.iter().any(|&n| f64::from(n) == r.value) => {
                return Err("Moving average must be SMA 20, 50 or 200".into());
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn validate_screen_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if !(1..=40).contains(&name.chars().count()) { return Err("Filter names must contain 1 to 40 characters".into()); }
    Ok(name.into())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DrawingPoint {
    pub t: i64,
    pub price: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Drawing {
    pub id: u32,
    pub kind: String,
    pub points: Vec<DrawingPoint>,
    pub text: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub width: u8,
    #[serde(default)]
    pub dashed: bool,
    #[serde(default)]
    pub locked: bool,
}

const PEN_MAX_POINTS: usize = 500;

pub fn validate_drawings(map: &HashMap<String, Vec<Drawing>>) -> Result<(), String> {
    if map.len() > 500 { return Err("At most 500 symbols can have drawings.".into()); }
    for (symbol, drawings) in map {
        if symbol.is_empty() || symbol != &symbol.to_uppercase() { return Err("Invalid drawing symbol.".into()); }
        if drawings.len() > 200 { return Err("At most 200 drawings per symbol.".into()); }
        let mut ids = HashSet::new();
        for d in drawings {
            let valid = match d.kind.as_str() {
                "hline" | "text" | "avwap" | "vline" | "hray" => d.points.len() == 1,
                "trend" | "rect" | "ray" | "fib" | "position" | "arrow" | "prange" | "drange" | "vprofile" => d.points.len() == 2,
                "channel" | "fibext" | "pitchfork" => d.points.len() == 3,
                "pen" => (2..=PEN_MAX_POINTS).contains(&d.points.len()),
                _ => return Err("Unknown drawing kind.".into()),
            };
            if !valid { return Err("Invalid drawing points.".into()); }
            if d.points.iter().any(|p| !p.price.is_finite() || p.price <= 0.0) { return Err("Invalid drawing price.".into()); }
            if d.text.chars().count() > 200 || (if d.kind == "text" { d.text.trim().is_empty() } else { !d.text.is_empty() }) { return Err("Invalid drawing text.".into()); }
            if !ids.insert(d.id) { return Err("Duplicate drawing ID.".into()); }
            let hex = d.color.len() == 7 && d.color.starts_with('#') && d.color[1..].bytes().all(|b| b.is_ascii_hexdigit());
            if !(d.color.is_empty() || hex) || d.width > 4 { return Err("Invalid drawing style.".into()); }
        }
    }
    Ok(())
}

/// Last window position and size, in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// In-window shortcuts: one key each, matched without modifiers. Empty is unbound.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Keybinds {
    pub chart_mode: String,
    pub chart_scale: String,
    pub chart_interval: String,
    pub draw_level: String,
    pub draw_trend: String,
    pub draw_text: String,
    pub draw_ruler: String,
    pub draw_pen: String,
    pub draw_rect: String,
    pub draw_ray: String,
    pub draw_fib: String,
    pub draw_position: String,
    pub draw_avwap: String,
    pub chart_split: String,
    pub chart_replay: String,
    pub practice: String,
    pub refresh: String,
    pub range: String,
    pub technicals: String,
    pub analysts: String,
    pub earnings: String,
    pub watchlist: String,
    pub search: String,
    pub settings: String,
    pub toggle_watchlist: String,
    pub alerts: String,
    pub market: String,
    pub news: String,
    pub analyze: String,
    pub options: String,
    pub paper: String,
    pub backtest: String,
    pub options_side: String,
    pub options_expiry: String,
    pub add_watchlist: String,
    pub events: String,
    pub next_group: String,
    pub previous_symbol: String,
    pub toggle_opening_range: String,
    pub toggle_levels: String,
    pub toggle_volume_ma: String,
    pub toggle_volume_profile: String,
}

impl Default for Keybinds {
    fn default() -> Self {
        Self {
            chart_mode: "c".into(),
            chart_scale: "l".into(),
            chart_interval: "i".into(),
            draw_level: "1".into(),
            draw_trend: "2".into(),
            draw_text: "3".into(),
            draw_ruler: "4".into(),
            draw_pen: "5".into(),
            draw_rect: "[".into(),
            draw_ray: "]".into(),
            draw_fib: ";".into(),
            draw_position: "'".into(),
            draw_avwap: "/".into(),
            chart_split: "j".into(),
            chart_replay: "y".into(),
            practice: "q".into(),
            refresh: "r".into(),
            range: "v".into(),
            technicals: "t".into(),
            analysts: "a".into(),
            earnings: "e".into(),
            watchlist: "x".into(),
            search: "s".into(),
            settings: ",".into(),
            toggle_watchlist: "w".into(),
            alerts: "p".into(),
            market: "m".into(),
            news: "n".into(),
            analyze: "z".into(),
            options: "o".into(),
            paper: "h".into(),
            backtest: ".".into(),
            options_side: "u".into(),
            options_expiry: "d".into(),
            add_watchlist: "f".into(),
            events: "k".into(),
            next_group: "g".into(),
            previous_symbol: "b".into(),
            toggle_opening_range: "6".into(),
            toggle_levels: "7".into(),
            toggle_volume_ma: "8".into(),
            toggle_volume_profile: "9".into(),
        }
    }
}

/// A named subset of the watchlist, shown as a tab.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Group {
    pub name: String,
    pub symbols: Vec<String>,
}

/// Which event dots the chart draws.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Dots {
    pub earnings: bool,
    pub news: bool,
    pub analysts: bool,
}

impl Default for Dots {
    fn default() -> Self {
        Self { earnings: true, news: true, analysts: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndicatorStyle {
    pub color: String,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LengthIndicator {
    pub length: usize,
    pub color: String,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BollingerConfig {
    pub length: usize,
    pub k: f64,
    pub color: String,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MacdConfig {
    pub fast: usize,
    pub slow: usize,
    pub signal: usize,
    pub color: String,
    pub signal_color: String,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpeningRangeConfig {
    pub minutes: usize,
    pub extension: f64,
    pub color: String,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct IndicatorConfig {
    pub sma: Vec<LengthIndicator>,
    pub ema: Vec<LengthIndicator>,
    pub bollinger: BollingerConfig,
    pub vwap: IndicatorStyle,
    pub vwap_bands: f64,
    pub volume_profile: bool,
    pub opening_range: OpeningRangeConfig,
    pub levels: IndicatorStyle,
    pub volume_ma: LengthIndicator,
    pub rsi: LengthIndicator,
    pub macd: MacdConfig,
    pub fib: bool,
    pub targets: bool,
    pub patterns: bool,
    pub keep_analysis: bool,
}

impl Default for IndicatorConfig {
    fn default() -> Self {
        let line = |length| LengthIndicator { length, color: String::new(), visible: true };
        Self {
            sma: [20, 50, 200].into_iter().map(line).collect(),
            ema: [9, 21].into_iter().map(line).collect(),
            bollinger: BollingerConfig { length: 20, k: 2.0, color: String::new(), visible: true },
            vwap: IndicatorStyle { color: String::new(), visible: true },
            vwap_bands: 0.0,
            volume_profile: false,
            opening_range: OpeningRangeConfig { minutes: 15, extension: 1.0, color: String::new(), visible: false },
            levels: IndicatorStyle { color: String::new(), visible: false },
            volume_ma: line(20),
            rsi: line(14),
            macd: MacdConfig { fast: 12, slow: 26, signal: 9, color: String::new(), signal_color: String::new(), visible: false },
            fib: true, targets: true, patterns: true, keep_analysis: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndicatorPreset {
    pub name: String,
    pub config: IndicatorConfig,
}

pub fn validate_indicators(config: &IndicatorConfig, presets: &[IndicatorPreset]) -> Result<(), String> {
    if presets.len() > 50 { return Err("At most 50 indicator presets are allowed".into()); }
    for c in std::iter::once(config).chain(presets.iter().map(|p| &p.config)) {
        if c.sma.len() > 8 || c.ema.len() > 8 { return Err("At most 8 SMA and 8 EMA lines are allowed".into()); }
        for length in c.sma.iter().chain(&c.ema).map(|l| l.length)
            .chain([c.bollinger.length, c.volume_ma.length, c.rsi.length, c.macd.fast, c.macd.slow, c.macd.signal]) {
            if !(1..=500).contains(&length) { return Err("Indicator lengths must be from 1 to 500".into()); }
        }
        if c.macd.fast >= c.macd.slow { return Err("MACD fast must be less than slow".into()); }
        if !c.bollinger.k.is_finite() || !(0.5..=5.0).contains(&c.bollinger.k) { return Err("Bollinger k must be from 0.5 to 5.0".into()); }
        if !c.vwap_bands.is_finite() || !(0.0..=5.0).contains(&c.vwap_bands) { return Err("VWAP bands must be from 0 to 5 deviations".into()); }
        if !(1..=240).contains(&c.opening_range.minutes) { return Err("Opening range must be from 1 to 240 minutes".into()); }
        if !c.opening_range.extension.is_finite() || !(0.0..=5.0).contains(&c.opening_range.extension) { return Err("Opening range extension must be from 0 to 5".into()); }
        for color in c.sma.iter().chain(&c.ema).map(|l| l.color.as_str())
            .chain([c.bollinger.color.as_str(), &c.vwap.color, &c.opening_range.color, &c.levels.color, &c.volume_ma.color, &c.rsi.color, &c.macd.color, &c.macd.signal_color]) {
            if !color.is_empty() && !(color.len() == 7 && color.starts_with('#') && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)) {
                return Err("Colors must be empty or #rrggbb".into());
            }
        }
    }
    for p in presets { validate_preset_name(&p.name)?; }
    Ok(())
}

pub fn validate_preset_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if !(1..=40).contains(&name.chars().count()) { return Err("Preset names must contain 1 to 40 characters".into()); }
    Ok(name.into())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub data_provider: String,
    pub alpaca_feed: String,
    pub indicators: IndicatorConfig,
    pub drawings: HashMap<String, Vec<Drawing>>,
    pub indicator_presets: Vec<IndicatorPreset>,
    pub symbol: String,
    pub range: String,
    pub interval: String,
    pub theme: Theme,
    #[serde(deserialize_with = "deserialize_text_size")]
    pub text_size: u16,
    pub palette: Palette,
    pub chart_mode: ChartMode,
    pub refresh_mode: RefreshMode,
    pub chart_scale: ChartScale,
    pub chart_extended_hours: bool,
    pub chart_shade_sessions: bool,
    pub chart_time_zone: ChartTimeZone,
    pub chart_layout: ChartLayout,
    pub hotkey: String,
    pub geometry: Option<Geometry>,
    // Tray menu toggles.
    pub show_extended: bool,
    pub show_percent: bool,
    pub always_on_top: bool,
    pub unload_on_minimize: bool,
    pub start_hidden: bool,
    /// macOS: price and change next to the menu bar icon.
    pub show_tray_title: bool,
    /// Launch at login as last chosen; None until first recorded.
    pub autostart: Option<bool>,
    /// Starred symbols, in the user's order.
    pub watchlist: Vec<String>,
    /// Watchlist groups, in tab order.
    pub groups: Vec<Group>,
    pub watchlist_sort: WatchlistSort,
    pub watchlist_view: WatchlistView,
    pub watchlist_columns: WatchlistColumns,
    pub screens: Vec<SavedScreen>,
    pub event_filter: EventFilter,
    /// Look for new releases in the background.
    pub auto_update: bool,
    pub keybinds: Keybinds,
    pub dots: Dots,
    /// Classify headline tone with the AI endpoint from .env.local.
    pub ai_news: bool,
    pub alerts: Vec<crate::alerts::PriceAlert>,
    /// Most recently viewed symbols, newest first.
    pub recent_symbols: Vec<String>,
}

pub const MAX_RECENT_SYMBOLS: usize = 10;

pub fn push_recent(recent: &mut Vec<String>, symbol: &str) {
    recent.retain(|s| s != symbol);
    recent.insert(0, symbol.to_string());
    recent.truncate(MAX_RECENT_SYMBOLS);
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            data_provider: "yahoo".into(),
            alpaca_feed: "iex".into(),
            indicators: IndicatorConfig::default(),
            drawings: HashMap::new(),
            indicator_presets: Vec::new(),
            symbol: "AAPL".into(),
            range: "1d".into(),
            interval: "auto".into(),
            theme: Theme::System,
            text_size: 100,
            palette: Palette::Standard,
            chart_mode: ChartMode::Line,
            refresh_mode: RefreshMode::Balanced,
            chart_scale: ChartScale::Linear,
            chart_extended_hours: true,
            chart_shade_sessions: true,
            chart_time_zone: ChartTimeZone::Exchange,
            chart_layout: ChartLayout::default(),
            hotkey: DEFAULT_HOTKEY.into(),
            geometry: None,
            show_extended: true,
            show_percent: true,
            always_on_top: false,
            unload_on_minimize: true,
            start_hidden: false,
            show_tray_title: true,
            autostart: None,
            watchlist: Vec::new(),
            groups: Vec::new(),
            watchlist_sort: WatchlistSort::default(),
            watchlist_view: WatchlistView::default(),
            watchlist_columns: WatchlistColumns::default(),
            screens: Vec::new(),
            event_filter: EventFilter::default(),
            auto_update: true,
            keybinds: Keybinds::default(),
            dots: Dots::default(),
            ai_news: true,
            alerts: Vec::new(),
            recent_symbols: Vec::new(),
        }
    }
}

pub fn config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("tickr")
}

pub fn cache_dir() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("tickr")
}

pub fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

impl Settings {
    pub fn save_indicator_preset(&mut self, name: &str) -> Result<(), String> {
        let name = validate_preset_name(name)?;
        let mut presets = self.indicator_presets.clone();
        let preset = IndicatorPreset { name: name.clone(), config: self.indicators.clone() };
        if let Some(p) = presets.iter_mut().find(|p| p.name == name) { *p = preset; }
        else { presets.push(preset); }
        validate_indicators(&self.indicators, &presets)?;
        self.indicator_presets = presets;
        Ok(())
    }

    pub fn delete_indicator_preset(&mut self, name: &str) -> Result<(), String> {
        let name = validate_preset_name(name)?;
        self.indicator_presets.retain(|p| p.name != name);
        Ok(())
    }

    pub fn save_screen(&mut self, name: &str, rules: Vec<ScreenRule>) -> Result<(), String> {
        let name = validate_screen_name(name)?;
        validate_screen_rules(&rules)?;
        let screen = SavedScreen { name: name.clone(), rules };
        let at = self.screens.iter().position(|s| s.name.to_lowercase() == name.to_lowercase());
        match at {
            Some(i) => self.screens[i] = screen,
            None if self.screens.len() >= MAX_SCREENS => return Err(format!("At most {MAX_SCREENS} saved filters are allowed")),
            None => self.screens.push(screen),
        }
        Ok(())
    }

    pub fn delete_screen(&mut self, name: &str) {
        let name = name.trim().to_lowercase();
        self.screens.retain(|s| s.name.to_lowercase() != name);
    }

    /// Missing or unreadable files give defaults.
    pub fn load(path: &Path) -> Self {
        std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(tmp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_settings() {
        let defaults = Settings::default();
        let old: Settings = serde_json::from_str(r#"{"symbol":"NVDA","chart_mode":"candles"}"#).unwrap();
        for s in [&defaults, &old] {
            assert_eq!(s.theme, Theme::System);
            assert_eq!(s.text_size, 100);
            assert_eq!(s.palette, Palette::Standard);
        }
        for percent in [100, 110, 125, 150] {
            assert!(validate_text_size(percent).is_ok());
            let s = Settings { theme: Theme::Dark, text_size: percent, palette: Palette::Accessible, ..defaults.clone() };
            assert_eq!(serde_json::from_str::<Settings>(&serde_json::to_string(&s).unwrap()).unwrap(), s);
        }
        for percent in [0, 99, 101, 111, 126, 151, u16::MAX] {
            assert!(validate_text_size(percent).is_err());
            assert!(serde_json::from_str::<Settings>(&format!(r#"{{"text_size":{percent}}}"#)).is_err());
        }
    }

    #[test]
    fn indicator_validation() {
        let defaults = IndicatorConfig::default();
        assert!(validate_indicators(&defaults, &[]).is_ok());
        let invalid: Vec<fn(&mut IndicatorConfig)> = vec![
            |c| c.sma[0].length = 0, |c| c.sma[0].length = 501,
            |c| c.ema[0].length = 0, |c| c.ema[0].length = 501,
            |c| c.rsi.length = 0, |c| c.rsi.length = 501,
            |c| c.bollinger.length = 0, |c| c.bollinger.length = 501,
            |c| c.macd.fast = 0, |c| c.macd.fast = 501,
            |c| c.macd.slow = 0, |c| c.macd.slow = 501,
            |c| c.macd.signal = 0, |c| c.macd.signal = 501,
            |c| c.macd.fast = c.macd.slow, |c| c.macd.fast = c.macd.slow + 1,
            |c| c.bollinger.k = 0.49, |c| c.bollinger.k = 5.01,
            |c| c.bollinger.k = f64::NAN, |c| c.bollinger.k = f64::INFINITY,
            |c| c.sma = vec![c.sma[0].clone(); 9], |c| c.ema = vec![c.ema[0].clone(); 9],
            |c| c.vwap_bands = -1.0, |c| c.vwap_bands = 5.5,
            |c| c.opening_range.minutes = 0, |c| c.opening_range.minutes = 241,
            |c| c.opening_range.extension = -0.1, |c| c.opening_range.extension = f64::NAN,
        ];
        for edit in invalid {
            let mut c = defaults.clone(); edit(&mut c);
            assert!(validate_indicators(&c, &[]).is_err(), "{c:?}");
        }
        for color in ["red", "ffffff", "#fff", "#1234567", "#gg1234", "#???"] {
            for field in 0..8 {
                let mut c = defaults.clone();
                let dest = match field { 0 => &mut c.sma[0].color, 1 => &mut c.ema[0].color,
                    2 => &mut c.bollinger.color, 3 => &mut c.vwap.color, 4 => &mut c.rsi.color,
                    5 => &mut c.macd.color, 6 => &mut c.opening_range.color, _ => &mut c.macd.signal_color };
                *dest = color.into();
                assert!(validate_indicators(&c, &[]).is_err());
            }
        }
        let mut c = defaults.clone();
        c.sma = vec![LengthIndicator { length: 500, color: "#aB09fF".into(), visible: false }; 8];
        c.ema.clear(); c.rsi.length = 1; c.bollinger.k = 0.5;
        assert!(validate_indicators(&c, &[]).is_ok());
        c.bollinger.k = 5.0;
        assert!(validate_indicators(&c, &[]).is_ok());
    }

    #[test]
    fn indicator_presets_overwrite_delete_and_limits() {
        let mut s = Settings::default();
        s.save_indicator_preset("  Daily  ").unwrap();
        s.indicators.rsi.length = 7;
        s.save_indicator_preset("Daily").unwrap();
        assert_eq!(s.indicator_presets.len(), 1);
        assert_eq!(s.indicator_presets[0].config.rsi.length, 7);
        assert_eq!(s.indicator_presets[0].name, "Daily");
        s.delete_indicator_preset(" Daily ").unwrap();
        assert!(s.drawings.is_empty());
        assert!(s.indicator_presets.is_empty());
        for name in [" ".to_string(), "x".repeat(41)] { assert!(s.save_indicator_preset(&name).is_err()); }
        s.save_indicator_preset(&"?".repeat(40)).unwrap();
        for n in 1..50 { s.save_indicator_preset(&n.to_string()).unwrap(); }
        assert!(s.save_indicator_preset("overflow").is_err());
        assert_eq!(s.indicator_presets.len(), 50);
        s.save_indicator_preset("1").unwrap();
        let mut too_many = s.indicator_presets.clone();
        too_many.push(too_many[0].clone());
        assert!(validate_indicators(&s.indicators, &too_many).is_err());
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
    }

    #[test]
    fn defaults_and_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub/settings.json");
        let s = Settings::load(&p);
        assert_eq!(s.symbol, "AAPL");
        assert_eq!(s.hotkey, DEFAULT_HOTKEY);
        let s2 = Settings { symbol: "MSFT".into(), chart_mode: ChartMode::Candles, refresh_mode: RefreshMode::LowPower, chart_scale: ChartScale::Log, ..s };
        s2.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s2);
    }

    #[test]
    fn partial_file_fills_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(&p, r#"{"symbol": "NVDA", "chart_mode": "candles"}"#).unwrap();
        let s = Settings::load(&p);
        assert_eq!(s.symbol, "NVDA");
        assert_eq!(s.chart_mode, ChartMode::Candles);
        assert_eq!(s.refresh_mode, RefreshMode::Balanced);
        assert_eq!(s.chart_scale, ChartScale::Linear);
        assert_eq!(s.interval, "auto");
        assert_eq!(s.indicators, IndicatorConfig::default());
        assert!(s.drawings.is_empty());
        assert!(s.indicator_presets.is_empty());
        assert!(s.unload_on_minimize);
        assert!(s.groups.is_empty());
        assert!(s.screens.is_empty());
        assert!(s.auto_update);
        assert!(s.alerts.is_empty());
        assert!(s.ai_news);
        assert!(s.recent_symbols.is_empty());
    }

    #[test]
    fn recent_symbols_move_to_front_dedupe_and_cap() {
        let mut recent = vec!["AAPL".to_string(), "MSFT".to_string(), "NVDA".to_string()];
        push_recent(&mut recent, "NVDA");
        assert_eq!(recent, ["NVDA", "AAPL", "MSFT"]);
        push_recent(&mut recent, "TSLA");
        assert_eq!(recent, ["TSLA", "NVDA", "AAPL", "MSFT"]);
        for n in 0..20 { push_recent(&mut recent, &format!("S{n}")); }
        assert_eq!(recent.len(), MAX_RECENT_SYMBOLS);
        assert_eq!(recent[0], "S19");
    }

    #[test]
    fn partial_keybinds_and_dots_fill_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(&p, r#"{"keybinds": {"refresh": "F5"}, "dots": {"news": false}}"#).unwrap();
        let s = Settings::load(&p);
        assert_eq!(s.keybinds.refresh, "F5");
        assert_eq!(s.keybinds.chart_mode, "c");
        assert_eq!(s.keybinds.chart_scale, "l");
        assert_eq!(s.keybinds.chart_interval, "i");
        assert_eq!(s.keybinds.draw_level, "1");
        assert_eq!(s.keybinds.draw_trend, "2");
        assert_eq!(s.keybinds.draw_text, "3");
        assert_eq!(s.keybinds.draw_ruler, "4");
        assert_eq!(s.keybinds.draw_pen, "5");
        assert_eq!([&s.keybinds.draw_rect, &s.keybinds.draw_ray, &s.keybinds.draw_fib, &s.keybinds.draw_position, &s.keybinds.draw_avwap], ["[", "]", ";", "'", "/"]);
        assert_eq!(s.keybinds.chart_split, "j");
        assert_eq!(s.keybinds.chart_replay, "y");
        assert_eq!(s.keybinds.practice, "q");
        assert_eq!(s.keybinds.paper, "h");
        assert_eq!(s.keybinds.backtest, ".");
        assert_eq!(s.keybinds.settings, ",");
        assert_eq!(s.keybinds.toggle_watchlist, "w");
        assert_eq!(s.keybinds.watchlist, "x");
        assert_eq!(s.keybinds.options, "o");
        assert_eq!(s.keybinds.options_side, "u");
        assert_eq!(s.keybinds.options_expiry, "d");
        assert_eq!(s.keybinds.add_watchlist, "f");
        assert_eq!(s.keybinds.next_group, "g");
        assert_eq!(s.keybinds.previous_symbol, "b");
        assert_eq!([&s.keybinds.toggle_opening_range, &s.keybinds.toggle_levels, &s.keybinds.toggle_volume_ma, &s.keybinds.toggle_volume_profile], ["6", "7", "8", "9"]);
        assert!(!s.dots.news);
        assert!(s.dots.earnings && s.dots.analysts);
    }

    #[test]
    fn groups_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let s = Settings {
            watchlist: vec!["AAPL".into(), "BTC-USD".into()],
            groups: vec![Group { name: "Crypto".into(), symbols: vec!["BTC-USD".into()] }],
            ..Settings::default()
        };
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
    }

    #[test]
    fn watchlist_sort_defaults_and_roundtrip() {
        let old: Settings = serde_json::from_str(r#"{"symbol":"NVDA"}"#).unwrap();
        assert_eq!(old.watchlist_sort, WatchlistSort { key: WatchlistSortKey::Change, dir: WatchlistSortDir::Desc });
        let partial: Settings = serde_json::from_str(r#"{"watchlist_sort":{"key":"volume"}}"#).unwrap();
        assert_eq!(partial.watchlist_sort, WatchlistSort { key: WatchlistSortKey::Volume, dir: WatchlistSortDir::Desc });
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let s = Settings { watchlist_sort: WatchlistSort { key: WatchlistSortKey::Price, dir: WatchlistSortDir::Asc }, ..Settings::default() };
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
    }

    #[test]
    fn watchlist_view_defaults_and_roundtrip() {
        let old: Settings = serde_json::from_str(r#"{"symbol":"NVDA"}"#).unwrap();
        assert_eq!(old.watchlist_view, WatchlistView::Cards);
        let heatmap: Settings = serde_json::from_str(r#"{"watchlist_view":"heatmap"}"#).unwrap();
        assert_eq!(heatmap.watchlist_view, WatchlistView::Heatmap);
        assert_eq!(serde_json::to_value(WatchlistView::Heatmap).unwrap(), serde_json::json!("heatmap"));
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let s = Settings { watchlist_view: WatchlistView::Heatmap, ..Settings::default() };
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
    }

    #[test]
    fn watchlist_columns_default_and_roundtrip() {
        let old: Settings = serde_json::from_str(r#"{"symbol":"NVDA","watchlist_view":"heatmap"}"#).unwrap();
        assert_eq!(old.watchlist_columns, WatchlistColumns::default());
        assert!(!old.watchlist_columns.score && !old.watchlist_columns.iv_rank);
        let partial: Settings = serde_json::from_str(r#"{"watchlist_view":"table","watchlist_columns":{"rsi":true,"bogus":1}}"#).unwrap();
        assert_eq!(partial.watchlist_view, WatchlistView::Table);
        assert_eq!(partial.watchlist_columns, WatchlistColumns { rsi: true, ..WatchlistColumns::default() });
        assert_eq!(
            serde_json::to_value(WatchlistColumns { score: true, iv_rank: true, ..WatchlistColumns::default() }).unwrap(),
            serde_json::json!({"score": true, "rsi": false, "earnings": false, "iv_rank": true})
        );
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let s = Settings { watchlist_view: WatchlistView::Table, watchlist_columns: WatchlistColumns { score: true, rsi: true, earnings: true, iv_rank: true }, ..Settings::default() };
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
    }

    #[test]
    fn chart_session_settings_default_and_roundtrip() {
        let old: Settings = serde_json::from_str(r#"{"symbol":"NVDA"}"#).unwrap();
        assert!(old.chart_extended_hours);
        assert!(old.chart_shade_sessions);
        assert_eq!(old.chart_time_zone, ChartTimeZone::Exchange);
        let local: Settings = serde_json::from_str(r#"{"chart_extended_hours":false,"chart_shade_sessions":false,"chart_time_zone":"local"}"#).unwrap();
        assert!(!local.chart_extended_hours);
        assert!(!local.chart_shade_sessions);
        assert_eq!(local.chart_time_zone, ChartTimeZone::Local);
        assert_eq!(serde_json::to_value(ChartTimeZone::Local).unwrap(), serde_json::json!("local"));
        assert!(serde_json::from_str::<Settings>(r#"{"chart_time_zone":"utc"}"#).is_err());
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let s = Settings { chart_extended_hours: false, chart_shade_sessions: false, chart_time_zone: ChartTimeZone::Local, show_extended: false, ..Settings::default() };
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
        assert!(!Settings::load(&p).show_extended);
    }

    #[test]
    fn chart_layout_defaults_for_old_settings_and_roundtrips() {
        let old: Settings = serde_json::from_str(r#"{"symbol":"NVDA"}"#).unwrap();
        assert_eq!(old.chart_layout, ChartLayout::default());
        assert!(!old.chart_layout.split);
        assert_eq!(old.chart_layout.orientation, SplitOrientation::Side);
        assert!(!old.chart_layout.sync_range);
        assert_eq!(old.chart_layout.interval, "auto");
        let partial: Settings = serde_json::from_str(r#"{"chart_layout":{"split":true,"orientation":"stacked"}}"#).unwrap();
        assert!(partial.chart_layout.split);
        assert_eq!(partial.chart_layout.orientation, SplitOrientation::Stacked);
        assert!(partial.chart_layout.symbol.is_empty() && partial.chart_layout.range.is_empty());
        assert!(serde_json::from_str::<Settings>(r#"{"chart_layout":{"orientation":"diagonal"}}"#).is_err());
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let s = Settings {
            chart_layout: ChartLayout { split: true, orientation: SplitOrientation::Stacked, sync_range: true, symbol: "MSFT".into(), range: "1y".into(), interval: "1d".into() },
            ..Settings::default()
        };
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
        assert_eq!(serde_json::to_value(&s.chart_layout).unwrap()["orientation"], serde_json::json!("stacked"));
    }

    #[test]
    fn chart_layout_cleaning_normalizes_and_rejects() {
        let layout = |symbol: &str, range: &str, interval: &str| ChartLayout { symbol: symbol.into(), range: range.into(), interval: interval.into(), ..ChartLayout::default() };
        assert_eq!(layout(" brk-b ", "1y", "1d").cleaned().unwrap().symbol, "BRK-B");
        assert_eq!(layout("", "", "auto").cleaned().unwrap(), ChartLayout::default());
        assert!(layout("^GSPC", "5d", "15m").cleaned().is_ok());
        assert!(layout("A B", "1y", "auto").cleaned().is_err());
        assert!(layout(&"A".repeat(33), "1y", "auto").cleaned().is_err());
        assert!(layout("AAPL", "2y", "auto").cleaned().is_err());
        assert!(layout("AAPL", "1y", "5m").cleaned().is_err());
        assert!(layout("AAPL", "", "1d").cleaned().is_err());
    }

    #[test]
    fn event_filter_defaults_for_old_settings_and_roundtrips() {
        let old: Settings = serde_json::from_str(r#"{"symbol":"NVDA"}"#).unwrap();
        assert_eq!(old.event_filter, EventFilter { countries: vec!["US".into()], importance: EventImportance::All });
        let partial: Settings = serde_json::from_str(r#"{"event_filter":{"importance":"key"}}"#).unwrap();
        assert_eq!(partial.event_filter, EventFilter { countries: vec!["US".into()], importance: EventImportance::Key });
        let all: Settings = serde_json::from_str(r#"{"event_filter":{"countries":[]}}"#).unwrap();
        assert!(all.event_filter.countries.is_empty());
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let s = Settings { event_filter: EventFilter { countries: vec!["EU".into(), "GB".into()], importance: EventImportance::Key }, ..Settings::default() };
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
        assert_eq!(serde_json::to_value(&s.event_filter).unwrap(), serde_json::json!({"countries":["EU","GB"],"importance":"key"}));
    }

    #[test]
    fn event_filter_cleaning_normalizes_and_rejects() {
        let filter = |countries: &[&str]| EventFilter { countries: countries.iter().map(|c| c.to_string()).collect(), importance: EventImportance::Key };
        let cleaned = filter(&[" gb ", "US", "us", "eu"]).cleaned().unwrap();
        assert_eq!(cleaned.countries, ["EU", "GB", "US"]);
        assert_eq!(cleaned.importance, EventImportance::Key);
        assert!(filter(&[]).cleaned().unwrap().countries.is_empty());
        for bad in ["", "U", "USAA", "U1", "U S", "\u{e9}\u{e9}"] {
            assert!(filter(&[bad]).cleaned().is_err(), "{bad:?}");
        }
        let many: Vec<String> = (0..101).map(|i| format!("{}{}", (b'A' + (i / 26) as u8) as char, (b'A' + (i % 26) as u8) as char)).collect();
        assert!(EventFilter { countries: many.clone(), importance: EventImportance::All }.cleaned().is_err());
        assert_eq!(EventFilter { countries: many[..100].to_vec(), importance: EventImportance::All }.cleaned().unwrap().countries.len(), 100);
    }

    fn rule(kind: ScreenKind, op: ScreenOp, value: f64) -> ScreenRule {
        ScreenRule { kind, op, value }
    }

    #[test]
    fn screens_default_for_old_settings_and_roundtrip() {
        let old: Settings = serde_json::from_str(r#"{"symbol":"NVDA"}"#).unwrap();
        assert!(old.screens.is_empty());
        let saved: Settings = serde_json::from_str(
            r#"{"screens":[{"name":"Oversold","rules":[{"kind":"rsi","op":"below","value":30},{"kind":"sma","op":"above","value":200}]}]}"#,
        )
        .unwrap();
        assert_eq!(saved.screens[0].rules[1], rule(ScreenKind::Sma, ScreenOp::Above, 200.0));
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        saved.save(&p).unwrap();
        assert_eq!(Settings::load(&p), saved);
    }

    #[test]
    fn screens_save_overwrite_delete_and_limits() {
        let mut s = Settings::default();
        let oversold = vec![rule(ScreenKind::Rsi, ScreenOp::Below, 30.0)];
        s.save_screen("  Oversold  ", oversold.clone()).unwrap();
        s.save_screen("Momentum", vec![rule(ScreenKind::Change, ScreenOp::Above, -2.5)]).unwrap();
        let wider = vec![rule(ScreenKind::Rsi, ScreenOp::Below, 35.0), rule(ScreenKind::Sma, ScreenOp::Above, 50.0)];
        s.save_screen("oversold", wider.clone()).unwrap();
        assert_eq!(s.screens.len(), 2);
        assert_eq!(s.screens[0], SavedScreen { name: "oversold".into(), rules: wider });
        s.delete_screen(" OVERSOLD ");
        assert_eq!(s.screens.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), ["Momentum"]);
        s.delete_screen("missing");
        assert_eq!(s.screens.len(), 1);

        for name in [" ".to_string(), "x".repeat(41)] {
            assert!(s.save_screen(&name, oversold.clone()).is_err());
        }
        assert!(s.save_screen("Empty", vec![]).is_err());
        assert!(s.save_screen("Many", vec![oversold[0]; 11]).is_err());
        for bad in [
            rule(ScreenKind::Rsi, ScreenOp::Above, 101.0),
            rule(ScreenKind::Rsi, ScreenOp::Above, -1.0),
            rule(ScreenKind::Sma, ScreenOp::Above, 100.0),
            rule(ScreenKind::Change, ScreenOp::Below, f64::NAN),
            rule(ScreenKind::Change, ScreenOp::Below, f64::INFINITY),
        ] {
            assert!(s.save_screen("Bad", vec![bad]).is_err(), "{bad:?}");
        }
        assert_eq!(s.screens.len(), 1);
        for n in 1..MAX_SCREENS {
            s.save_screen(&n.to_string(), oversold.clone()).unwrap();
        }
        assert!(s.save_screen("overflow", oversold.clone()).is_err());
        s.save_screen("1", oversold).unwrap();
        assert_eq!(s.screens.len(), MAX_SCREENS);
    }

    #[test]
    fn alerts_roundtrip_preserves_armed_and_triggered_state() {
        use crate::alerts::{AlertKind, Direction, PriceAlert};
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let mut s = Settings::default();
        s.alerts.push(PriceAlert { id: 1, symbol: "AAPL".into(), direction: Direction::Above, level: 250.0, enabled: true, triggered_at: None, kind: AlertKind::TrailPercent, reference: Some(251.5), recurring: true, cooldown_mins: 30, regular_only: true, triggered_price: None });
        s.alerts.push(PriceAlert { id: 2, symbol: "BTC-USD".into(), direction: Direction::Below, level: 60000.0, enabled: false, triggered_at: Some(123), kind: AlertKind::Price, reference: None, recurring: false, cooldown_mins: 15, regular_only: false, triggered_price: Some(59999.5) });
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
    }

    #[test]
    fn settings_file_with_old_alerts_still_loads() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(
            &p,
            r#"{"symbol":"NVDA","alerts":[
                {"id":1,"symbol":"AAPL","direction":"above","level":250.0,"enabled":true,"triggered_at":null},
                {"id":2,"symbol":"MSFT","direction":"below","level":300.0,"enabled":false,"triggered_at":1700000000,"kind":"price","recurring":false,"cooldown_mins":15,"regular_only":false}
            ]}"#,
        )
        .unwrap();
        let s = Settings::load(&p);
        assert_eq!(s.symbol, "NVDA");
        assert_eq!(s.alerts.len(), 2);
        assert!(s.alerts[0].enabled);
        assert_eq!(s.alerts[0].triggered_price, None);
        assert_eq!(s.alerts[1].triggered_at, Some(1_700_000_000));
        assert_eq!(s.alerts[1].triggered_price, None);
    }
}

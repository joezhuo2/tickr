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
    Candles,
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
}

pub fn validate_drawings(map: &HashMap<String, Vec<Drawing>>) -> Result<(), String> {
    if map.len() > 500 { return Err("At most 500 symbols can have drawings.".into()); }
    for (symbol, drawings) in map {
        if symbol.is_empty() || symbol != &symbol.to_uppercase() { return Err("Invalid drawing symbol.".into()); }
        if drawings.len() > 200 { return Err("At most 200 drawings per symbol.".into()); }
        let mut ids = HashSet::new();
        for d in drawings {
            let count = match d.kind.as_str() {
                "hline" | "text" => 1,
                "trend" => 2,
                _ => return Err("Unknown drawing kind.".into()),
            };
            if d.points.len() != count { return Err("Invalid drawing points.".into()); }
            if d.points.iter().any(|p| !p.price.is_finite() || p.price <= 0.0) { return Err("Invalid drawing price.".into()); }
            if d.text.chars().count() > 200 || (if d.kind == "text" { d.text.trim().is_empty() } else { !d.text.is_empty() }) { return Err("Invalid drawing text.".into()); }
            if !ids.insert(d.id) { return Err("Duplicate drawing ID.".into()); }
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
    pub options_side: String,
    pub options_expiry: String,
    pub add_watchlist: String,
    pub events: String,
    pub next_group: String,
    pub previous_symbol: String,
}

impl Default for Keybinds {
    fn default() -> Self {
        Self {
            chart_mode: "c".into(),
            chart_scale: "l".into(),
            chart_interval: "i".into(),
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
            options_side: "u".into(),
            options_expiry: "d".into(),
            add_watchlist: "f".into(),
            events: "k".into(),
            next_group: "g".into(),
            previous_symbol: "b".into(),
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
#[serde(default)]
pub struct IndicatorConfig {
    pub sma: Vec<LengthIndicator>,
    pub ema: Vec<LengthIndicator>,
    pub bollinger: BollingerConfig,
    pub vwap: IndicatorStyle,
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
            .chain([c.bollinger.length, c.rsi.length, c.macd.fast, c.macd.slow, c.macd.signal]) {
            if !(1..=500).contains(&length) { return Err("Indicator lengths must be from 1 to 500".into()); }
        }
        if c.macd.fast >= c.macd.slow { return Err("MACD fast must be less than slow".into()); }
        if !c.bollinger.k.is_finite() || !(0.5..=5.0).contains(&c.bollinger.k) { return Err("Bollinger k must be from 0.5 to 5.0".into()); }
        for color in c.sma.iter().chain(&c.ema).map(|l| l.color.as_str())
            .chain([c.bollinger.color.as_str(), &c.vwap.color, &c.rsi.color, &c.macd.color, &c.macd.signal_color]) {
            if !color.is_empty() && !(color.len() == 7 && color.starts_with('#') && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)) {
                return Err("Colors must be empty or #rrggbb".into());
            }
        }
    }
    for p in presets { validate_preset_name(&p.name)?; }
    Ok(())
}

fn validate_preset_name(name: &str) -> Result<String, String> {
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
        ];
        for edit in invalid {
            let mut c = defaults.clone(); edit(&mut c);
            assert!(validate_indicators(&c, &[]).is_err(), "{c:?}");
        }
        for color in ["red", "ffffff", "#fff", "#1234567", "#gg1234", "#???"] {
            for field in 0..7 {
                let mut c = defaults.clone();
                let dest = match field { 0 => &mut c.sma[0].color, 1 => &mut c.ema[0].color,
                    2 => &mut c.bollinger.color, 3 => &mut c.vwap.color, 4 => &mut c.rsi.color,
                    5 => &mut c.macd.color, _ => &mut c.macd.signal_color };
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
        assert_eq!(s.keybinds.settings, ",");
        assert_eq!(s.keybinds.toggle_watchlist, "w");
        assert_eq!(s.keybinds.watchlist, "x");
        assert_eq!(s.keybinds.options, "o");
        assert_eq!(s.keybinds.options_side, "u");
        assert_eq!(s.keybinds.options_expiry, "d");
        assert_eq!(s.keybinds.add_watchlist, "f");
        assert_eq!(s.keybinds.next_group, "g");
        assert_eq!(s.keybinds.previous_symbol, "b");
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
    fn alerts_roundtrip_preserves_armed_and_triggered_state() {
        use crate::alerts::{AlertKind, Direction, PriceAlert};
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let mut s = Settings::default();
        s.alerts.push(PriceAlert { id: 1, symbol: "AAPL".into(), direction: Direction::Above, level: 250.0, enabled: true, triggered_at: None, kind: AlertKind::TrailPercent, reference: Some(251.5), recurring: true, cooldown_mins: 30, regular_only: true });
        s.alerts.push(PriceAlert { id: 2, symbol: "BTC-USD".into(), direction: Direction::Below, level: 60000.0, enabled: false, triggered_at: Some(123), kind: AlertKind::Price, reference: None, recurring: false, cooldown_mins: 15, regular_only: false });
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
    }
}

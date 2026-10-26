//! App settings, stored as JSON in the OS config dir.

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
    pub refresh: String,
    pub range: String,
    pub technicals: String,
    pub analysts: String,
    pub earnings: String,
    pub watchlist: String,
    pub search: String,
    pub settings: String,
    pub toggle_watchlist: String,
}

impl Default for Keybinds {
    fn default() -> Self {
        Self {
            chart_mode: "c".into(),
            refresh: "r".into(),
            range: "v".into(),
            technicals: "t".into(),
            analysts: "a".into(),
            earnings: "e".into(),
            watchlist: "x".into(),
            search: "s".into(),
            settings: ",".into(),
            toggle_watchlist: "w".into(),
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
#[serde(default)]
pub struct Settings {
    pub symbol: String,
    pub range: String,
    pub chart_mode: ChartMode,
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
    pub alerts: Vec<crate::alerts::PriceAlert>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            symbol: "AAPL".into(),
            range: "1d".into(),
            chart_mode: ChartMode::Line,
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
            alerts: Vec::new(),
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
    fn defaults_and_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub/settings.json");
        let s = Settings::load(&p);
        assert_eq!(s.symbol, "AAPL");
        assert_eq!(s.hotkey, DEFAULT_HOTKEY);
        let s2 = Settings { symbol: "MSFT".into(), chart_mode: ChartMode::Candles, ..s };
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
        assert!(s.unload_on_minimize);
        assert!(s.groups.is_empty());
        assert!(s.auto_update);
        assert!(s.alerts.is_empty());
    }

    #[test]
    fn partial_keybinds_and_dots_fill_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(&p, r#"{"keybinds": {"refresh": "F5"}, "dots": {"news": false}}"#).unwrap();
        let s = Settings::load(&p);
        assert_eq!(s.keybinds.refresh, "F5");
        assert_eq!(s.keybinds.chart_mode, "c");
        assert_eq!(s.keybinds.settings, ",");
        assert_eq!(s.keybinds.toggle_watchlist, "w");
        assert_eq!(s.keybinds.watchlist, "x");
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
        use crate::alerts::{Direction, PriceAlert};
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let mut s = Settings::default();
        s.alerts.push(PriceAlert { id: 1, symbol: "AAPL".into(), direction: Direction::Above, level: 250.0, enabled: true, triggered_at: None });
        s.alerts.push(PriceAlert { id: 2, symbol: "BTC-USD".into(), direction: Direction::Below, level: 60000.0, enabled: false, triggered_at: Some(123) });
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
    }
}

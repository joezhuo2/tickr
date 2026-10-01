//! App settings, stored as JSON in the OS config dir.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

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
    /// Launch at login as last chosen; None until first recorded.
    pub autostart: Option<bool>,
    /// Starred symbols, in the user's order.
    pub watchlist: Vec<String>,
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
            autostart: None,
            watchlist: Vec::new(),
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
    }
}

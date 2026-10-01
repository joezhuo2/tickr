//! Shared app state.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tokio::sync::Notify;

use crate::quote::Quote;
use crate::settings::{Geometry, Settings};

/// Locks a mutex, recovering from poisoning.
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// What the tray and window show: the last good quote plus the last error.
#[derive(Debug, Clone, Default, Serialize)]
pub struct QuoteState {
    pub quote: Option<Quote>,
    pub error: Option<String>,
    /// Unix seconds of the last successful fetch.
    pub updated_at: i64,
}

pub struct Shared {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub http: reqwest::Client,
    pub quote: Mutex<QuoteState>,
    /// Wakes the poller early (symbol changed).
    pub wake: Notify,
    /// Logo PNG for the current symbol: (symbol, bytes). None bytes = no logo.
    pub logo: Mutex<Option<(String, Option<Vec<u8>>)>>,
    /// Last known window geometry while it was not minimized.
    pub geometry: Mutex<Option<Geometry>>,
}

impl Shared {
    pub fn new(settings_path: PathBuf, settings: Settings) -> Self {
        let geometry = settings.geometry;
        Self {
            settings: Mutex::new(settings),
            settings_path,
            http: crate::quote::client(),
            quote: Mutex::new(QuoteState::default()),
            wake: Notify::new(),
            logo: Mutex::new(None),
            geometry: Mutex::new(geometry),
        }
    }

    /// Applies a change to the settings and saves them.
    pub fn update_settings(&self, f: impl FnOnce(&mut Settings)) -> Settings {
        let mut s = lock(&self.settings);
        f(&mut s);
        if let Err(e) = s.save(&self.settings_path) {
            log::warn!("save settings: {e}");
        }
        s.clone()
    }

    pub fn symbol(&self) -> String {
        lock(&self.settings).symbol.clone()
    }
}

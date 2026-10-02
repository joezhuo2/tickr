//! Auto-update from GitHub releases.
//!
//! The release workflow uploads a signed `latest.json` next to the installers;
//! `plugins.updater` in tauri.conf.json points at it and holds the public key.
//! tickr checks in the background, announces a new version in the tray menu
//! and tooltip, and installs only when the user picks it from the menu.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::state::{lock, Shared};

/// First background check, after startup traffic has settled.
const FIRST_CHECK: Duration = Duration::from_secs(30);
const CHECK_EVERY: Duration = Duration::from_secs(12 * 60 * 60);

#[derive(Debug, Clone, Default, PartialEq)]
pub enum Status {
    #[default]
    Idle,
    Checking,
    UpToDate,
    /// A newer version, ready to install from the menu.
    Available(String),
    Installing(String),
    Failed,
}

/// Tray menu label for the update item, and whether it can be clicked.
pub fn menu_label(status: &Status, current: &str) -> (String, bool) {
    match status {
        Status::Idle => (format!("Check for updates (v{current})"), true),
        Status::Checking => ("Checking for updates…".into(), false),
        Status::UpToDate => (format!("Up to date (v{current})"), true),
        Status::Available(v) => (format!("Install v{v} and restart"), true),
        Status::Installing(v) => (format!("Installing v{v}…"), false),
        Status::Failed => (format!("Update failed, try again (v{current})"), true),
    }
}

/// Tooltip line while an update waits to be installed.
pub fn notice(status: &Status) -> Option<String> {
    match status {
        Status::Available(v) => Some(format!("Update v{v} available")),
        _ => None,
    }
}

/// Background checks while "Check for updates automatically" is on.
pub fn spawn(app: AppHandle, shared: Arc<Shared>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            if lock(&shared.settings).auto_update {
                check(&app, &shared, false).await;
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

/// What the tray menu item does: install a found update, otherwise check.
pub fn on_menu(app: &AppHandle) {
    let app = app.clone();
    let shared = app.state::<Arc<Shared>>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let pending = lock(&shared.pending_update).clone();
        match pending {
            Some(update) => install(&app, &shared, update).await,
            None => check(&app, &shared, true).await,
        }
    });
}

fn set(app: &AppHandle, shared: &Shared, status: Status) {
    *lock(&shared.update_status) = status;
    crate::tray::rebuild_menu(app, shared);
    crate::tray::update(app, shared);
}

/// Background check failures stay in the log; a manual check shows them.
async fn check(app: &AppHandle, shared: &Shared, manual: bool) {
    let before = lock(&shared.update_status).clone();
    if matches!(before, Status::Checking | Status::Installing(_)) {
        return;
    }
    if manual {
        set(app, shared, Status::Checking);
    }
    let res = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    let status = match res {
        Ok(Some(update)) => {
            log::info!("update available: v{}", update.version);
            let v = update.version.clone();
            *lock(&shared.pending_update) = Some(update);
            Status::Available(v)
        }
        Ok(None) => Status::UpToDate,
        Err(e) => {
            log::warn!("update check: {e}");
            if manual { Status::Failed } else { before.clone() }
        }
    };
    if manual || status != before {
        set(app, shared, status);
    }
}

/// Windows: the plugin starts the installer and exits; the installer
/// relaunches tickr. macOS: the .app is replaced in place, then restarted.
async fn install(app: &AppHandle, shared: &Shared, update: Update) {
    set(app, shared, Status::Installing(update.version.clone()));
    log::info!("installing v{}", update.version);
    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => app.restart(),
        Err(e) => {
            log::error!("install update: {e}");
            *lock(&shared.pending_update) = None;
            set(app, shared, Status::Failed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels() {
        assert_eq!(menu_label(&Status::Idle, "0.5.0"), ("Check for updates (v0.5.0)".into(), true));
        assert!(!menu_label(&Status::Checking, "0.5.0").1);
        assert_eq!(menu_label(&Status::Available("0.6.0".into()), "0.5.0").0, "Install v0.6.0 and restart");
        assert!(!menu_label(&Status::Installing("0.6.0".into()), "0.5.0").1);
        assert_eq!(notice(&Status::Available("0.6.0".into())).as_deref(), Some("Update v0.6.0 available"));
        assert_eq!(notice(&Status::UpToDate), None);
    }
}

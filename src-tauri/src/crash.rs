//! Opt-in local crash reports, kept in a `crashes` folder inside the log folder.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use crate::state::{lock, Shared};

pub const KEEP: usize = 10;
const MAX_UI_TEXT: usize = 4000;

static ENABLED: AtomicBool = AtomicBool::new(false);
static DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn configure(dir: Option<PathBuf>, enabled: bool) {
    *lock(&DIR) = dir;
    ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn format_report(at: i64, version: &str, os: &str, thread: &str, message: &str, location: &str, backtrace: &str) -> String {
    format!(
        "tickr crash report\nTime: {}\nVersion: {version}\nOS: {os}\nThread: {thread}\nLocation: {location}\nMessage: {message}\n\nBacktrace:\n{backtrace}\n",
        crate::alpaca::format_time(at)
    )
}

pub fn write(dir: &Path, millis: u128, text: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(format!("crash-{millis:015}.txt")), text)?;
    prune(dir, KEEP);
    Ok(())
}

fn files(dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("crash-") && n.ends_with(".txt")))
        .collect();
    found.sort();
    found
}

pub fn prune(dir: &Path, keep: usize) {
    let all = files(dir);
    for old in &all[..all.len().saturating_sub(keep)] {
        let _ = std::fs::remove_file(old);
    }
}

pub fn latest(dir: &Path) -> Option<String> {
    files(dir).pop().and_then(|p| std::fs::read_to_string(p).ok())
}

pub fn clear(dir: &Path) {
    for f in files(dir) {
        let _ = std::fs::remove_file(f);
    }
}

fn millis() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default()
}

fn record(thread: &str, message: &str, location: &str, backtrace: &str) {
    if !ENABLED.load(Ordering::Relaxed) { return; }
    let Some(dir) = lock(&DIR).clone() else { return };
    let ms = millis();
    let text = format_report((ms / 1000) as i64, env!("CARGO_PKG_VERSION"), &format!("{} {}", std::env::consts::OS, std::env::consts::ARCH), thread, message, location, backtrace);
    if let Err(e) = write(&dir, ms, &text) {
        log::warn!("crash report: {e}");
    }
}

pub fn on_panic(info: &std::panic::PanicHookInfo<'_>) {
    let message = info.payload().downcast_ref::<&str>().map(|s| s.to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_else(|| "unknown panic".into());
    let location = info.location().map(|l| l.to_string()).unwrap_or_else(|| "unknown".into());
    record(std::thread::current().name().unwrap_or("unnamed"), &message, &location, &std::backtrace::Backtrace::force_capture().to_string());
}

pub fn latest_in(app: &AppHandle) -> Option<String> {
    latest(&app.path().app_log_dir().ok()?.join("crashes"))
}

#[tauri::command]
pub fn set_save_crash_reports(shared: State<'_, Arc<Shared>>, enabled: bool) {
    shared.update_settings(|s| s.save_crash_reports = enabled);
    ENABLED.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn report_ui_error(message: String, source: Option<String>, stack: Option<String>) {
    let cut = |s: &str| s.chars().take(MAX_UI_TEXT).collect::<String>();
    record("ui", &cut(&message), &cut(&source.unwrap_or_default()), &cut(&stack.unwrap_or_default()));
}

#[tauri::command]
pub fn clear_crash_reports(app: AppHandle) {
    if let Some(dir) = lock(&DIR).clone().or_else(|| app.path().app_log_dir().ok().map(|d| d.join("crashes"))) {
        clear(&dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_newest_and_returns_latest() {
        let dir = tempfile::tempdir().unwrap();
        for i in 1..=15u128 {
            write(dir.path(), i, &format!("report {i}")).unwrap();
        }
        std::fs::write(dir.path().join("other.txt"), "x").unwrap();
        let names = files(dir.path());
        assert_eq!(names.len(), KEEP);
        assert!(names[0].ends_with("crash-000000000000006.txt"));
        assert_eq!(latest(dir.path()).as_deref(), Some("report 15"));
        clear(dir.path());
        assert!(latest(dir.path()).is_none());
        assert!(dir.path().join("other.txt").exists());
    }

    #[test]
    fn report_has_all_fields() {
        let text = format_report(1, "1.2.3", "windows x86_64", "main", "boom", "src/a.rs:1:2", "frame 0");
        for expected in ["Time: 1970-01-01T00:00:01Z", "Version: 1.2.3", "OS: windows x86_64", "Thread: main", "Location: src/a.rs:1:2", "Message: boom", "frame 0"] {
            assert!(text.contains(expected), "{expected}: {text}");
        }
    }
}

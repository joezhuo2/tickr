//! Global hotkey that opens (or minimizes) the window.

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Wry};
use tauri_plugin_global_shortcut::{Builder, GlobalShortcutExt, Shortcut, ShortcutState};

pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                crate::window::toggle(app);
            }
        })
        .build()
}

fn parse(accel: &str) -> Result<Shortcut, String> {
    accel.parse::<Shortcut>().map_err(|e| format!("invalid hotkey \"{accel}\": {e}"))
}

pub fn register(app: &AppHandle, accel: &str) -> Result<(), String> {
    let sc = parse(accel)?;
    app.global_shortcut().register(sc).map_err(|e| format!("{accel} is in use by another app ({e})"))
}

/// Replaces `old` with `new`. On failure the old hotkey is restored.
pub fn swap(app: &AppHandle, old: &str, new: &str) -> Result<(), String> {
    let new_sc = parse(new)?;
    let gs = app.global_shortcut();
    if let Ok(old_sc) = parse(old) {
        if old_sc == new_sc && gs.is_registered(old_sc) {
            return Ok(());
        }
        let _ = gs.unregister(old_sc);
    }
    if let Err(e) = register(app, new) {
        if let Ok(old_sc) = parse(old) {
            let _ = gs.register(old_sc);
        }
        return Err(e);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_accelerators() {
        for a in ["Ctrl+Alt+K", "Ctrl+Shift+F12", "Alt+Space", "Super+Shift+1"] {
            assert!(parse(a).is_ok(), "{a}");
        }
        assert!(parse("Ctrl+").is_err());
        assert!(parse("Nope+K").is_err());
    }
}

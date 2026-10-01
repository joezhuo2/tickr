//! Tray icon (logo + badge), hover tooltip, and the right-click menu that
//! holds every on/off setting.

use std::sync::{Arc, Mutex};

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::quote::Session;
use crate::settings::Settings;
use crate::state::{lock, QuoteState, Shared};
use crate::trayicon::{self, Badge};

const TRAY_ID: &str = "main";
/// Windows truncates tray tooltips at 127 UTF-16 units.
const TIP_MAX: usize = 127;

/// (symbol, badge, has logo) of the icon currently shown.
static LAST_ICON: Mutex<Option<(String, Badge, bool)>> = Mutex::new(None);

pub fn fmt_price(v: f64, currency: &str) -> String {
    let digits = if v.abs() < 1.0 { 4 } else { 2 };
    match currency {
        "USD" | "" => format!("${v:.digits$}"),
        "EUR" => format!("€{v:.digits$}"),
        "GBP" => format!("£{v:.digits$}"),
        "JPY" => format!("¥{v:.0}"),
        c => format!("{v:.digits$} {c}"),
    }
}

fn signed(v: f64, digits: usize) -> String {
    let v = if v.abs() < 0.5 * 10f64.powi(-(digits as i32)) { 0.0 } else { v };
    format!("{}{:.*}", if v >= 0.0 { "+" } else { "−" }, digits, v.abs())
}

fn change(abs: f64, pct: f64, show_percent: bool) -> String {
    if show_percent {
        format!("{}%", signed(pct, 2))
    } else {
        signed(abs, 2)
    }
}

/// Tooltip text shown when hovering over the tray icon.
pub fn tooltip(q: &QuoteState, s: &Settings) -> String {
    let Some(quote) = &q.quote else {
        return match &q.error {
            Some(e) => format!("tickr: {}\n{e}", s.symbol),
            None => format!("tickr: {}\nLoading…", s.symbol),
        };
    };
    let mut tip = format!("{}  {}", quote.symbol, fmt_price(quote.price, &quote.currency));
    if let (Some(a), Some(p)) = (quote.change, quote.change_pct) {
        tip += &format!("\nDay  {}", change(a, p, s.show_percent));
        if quote.session == Session::Closed && quote.extended.is_none() {
            tip += "  (closed)";
        }
    }
    if s.show_extended {
        if let Some(e) = &quote.extended {
            tip += &format!(
                "\n{}  {}  {}",
                e.label,
                fmt_price(e.price, &quote.currency),
                change(e.change, e.change_pct, s.show_percent)
            );
        }
    }
    if q.error.is_some() {
        tip += "\n(offline, last known)";
    }
    tip.chars().take(TIP_MAX).collect()
}

/// Appends warning lines, cutting the quote text rather than the warnings
/// when the tooltip would exceed the length limit.
pub fn with_warnings(tip: String, warnings: &[String]) -> String {
    if warnings.is_empty() {
        return tip;
    }
    let tail: String = warnings.iter().map(|w| format!("\n⚠ {w}")).collect();
    let room = TIP_MAX.saturating_sub(tail.chars().count());
    let mut out: String = tip.chars().take(room).collect();
    out += &tail;
    out.chars().take(TIP_MAX).collect()
}

/// Problems the user should know about even with the window closed.
fn warnings(shared: &Shared, s: &Settings) -> Vec<String> {
    let mut w = Vec::new();
    if lock(&shared.hotkey_error).is_some() {
        w.push(format!("Hotkey {} unavailable", s.hotkey));
    }
    if let Some(e) = lock(&shared.autostart_error).as_ref() {
        w.push(e.clone());
    }
    w
}

fn full_tooltip(shared: &Shared, q: &QuoteState, s: &Settings) -> String {
    with_warnings(tooltip(q, s), &warnings(shared, s))
}

pub fn badge(q: &QuoteState) -> Badge {
    let Some(quote) = &q.quote else { return Badge::None };
    if quote.session == Session::Closed {
        return Badge::Closed;
    }
    match quote.change {
        Some(c) if c > 0.0 => Badge::Up,
        Some(c) if c < 0.0 => Badge::Down,
        _ => Badge::Closed,
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    let icon = trayicon::compose(None, Badge::None);
    // Separate statement: a guard inside the builder chain would still be
    // held when menu() locks the settings again.
    let settings = lock(&shared.settings).clone();
    let tip = full_tooltip(&shared, &QuoteState::default(), &settings);
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::new_owned(icon, trayicon::SIZE, trayicon::SIZE))
        .tooltip(tip)
        .menu(&menu(app, &shared)?)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                crate::window::open(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn menu(app: &AppHandle, shared: &Shared) -> tauri::Result<Menu<Wry>> {
    let s = lock(&shared.settings).clone();
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);
    let check = |id: &str, text: &str, on: bool| CheckMenuItem::with_id(app, id, text, true, on, None::<&str>);
    let sep = || PredefinedMenuItem::separator(app);

    let m = Menu::new(app)?;
    m.append(&MenuItem::with_id(app, "open", "Open tickr", true, None::<&str>)?)?;
    m.append(&sep()?)?;
    m.append(&check("show_extended", "Show pre-market / after-hours", s.show_extended)?)?;
    m.append(&check("show_percent", "Show change as %", s.show_percent)?)?;
    m.append(&check("always_on_top", "Always on top", s.always_on_top)?)?;
    m.append(&check("unload_on_minimize", "Unload window when minimized", s.unload_on_minimize)?)?;
    m.append(&check("start_hidden", "Start hidden", s.start_hidden)?)?;
    m.append(&check("autostart", "Launch at login", autostart)?)?;
    m.append(&sep()?)?;
    m.append(&MenuItem::with_id(app, "quit", "Quit tickr", true, None::<&str>)?)?;
    Ok(m)
}

fn rebuild_menu(app: &AppHandle, shared: &Shared) {
    if let (Some(tray), Ok(m)) = (app.tray_by_id(TRAY_ID), menu(app, shared)) {
        let _ = tray.set_menu(Some(m));
    }
}

fn on_menu(app: &AppHandle, ev: MenuEvent) {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    match ev.id().as_ref() {
        "open" => crate::window::open(app),
        "quit" => app.exit(0),
        "autostart" => {
            let al = app.autolaunch();
            let enable = !al.is_enabled().unwrap_or(false);
            let verb = if enable { "enable" } else { "disable" };
            let res = if enable { al.enable() } else { al.disable() };
            // The rebuilt menu reads the real state, so a failure leaves the
            // check mark unchanged; the tooltip says why.
            *lock(&shared.autostart_error) = match res {
                Ok(()) => None,
                Err(e) => {
                    log::error!("{verb} autostart: {e}");
                    Some(format!("Could not {verb} launch at login"))
                }
            };
        }
        "show_extended" => {
            shared.update_settings(|s| s.show_extended = !s.show_extended);
        }
        "show_percent" => {
            shared.update_settings(|s| s.show_percent = !s.show_percent);
        }
        "always_on_top" => {
            let s = shared.update_settings(|s| s.always_on_top = !s.always_on_top);
            if let Some(w) = crate::window::get(app) {
                let _ = w.set_always_on_top(s.always_on_top);
            }
        }
        "unload_on_minimize" => {
            shared.update_settings(|s| s.unload_on_minimize = !s.unload_on_minimize);
        }
        "start_hidden" => {
            shared.update_settings(|s| s.start_hidden = !s.start_hidden);
        }
        _ => return,
    }
    // Keeps check marks in sync with the saved settings.
    rebuild_menu(app, &shared);
    update(app, &shared);
    crate::poller::emit(app, &shared);
}

/// Refreshes the tooltip, and the icon when symbol, badge or logo changed.
pub fn update(app: &AppHandle, shared: &Shared) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let q = lock(&shared.quote).clone();
    let settings = lock(&shared.settings).clone();
    let _ = tray.set_tooltip(Some(full_tooltip(shared, &q, &settings)));

    let b = badge(&q);
    let logo = lock(&shared.logo)
        .as_ref()
        .filter(|(sym, _)| *sym == settings.symbol)
        .and_then(|(_, bytes)| bytes.clone());
    let key = (settings.symbol.clone(), b, logo.is_some());
    let mut last = lock(&LAST_ICON);
    if last.as_ref() != Some(&key) {
        let rgba = trayicon::compose(logo.as_deref(), b);
        let _ = tray.set_icon(Some(Image::new_owned(rgba, trayicon::SIZE, trayicon::SIZE)));
        *last = Some(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quote::{parse_chart, quote_from};

    fn state(now_offset: impl Fn(&crate::quote::Periods) -> i64) -> QuoteState {
        let c = parse_chart(include_bytes!("../../fixtures/chart-1d-post.json"), "1d", "5m").unwrap();
        let now = now_offset(&c.meta.periods.unwrap());
        QuoteState { quote: Some(quote_from(&c, now)), error: None, updated_at: now }
    }

    #[test]
    fn tooltip_after_hours() {
        let q = state(|p| p.post.start + 60);
        let s = Settings::default();
        let tip = tooltip(&q, &s);
        let lines: Vec<&str> = tip.lines().collect();
        assert_eq!(lines[0], "AAPL  $333.02");
        assert_eq!(lines[1], "Day  +1.10%");
        assert!(lines[2].starts_with("After hours  $"), "{tip}");
        assert!(tip.len() <= TIP_MAX);
    }

    #[test]
    fn tooltip_toggles() {
        let q = state(|p| p.post.start + 60);
        let s = Settings { show_extended: false, show_percent: false, ..Settings::default() };
        let tip = tooltip(&q, &s);
        assert_eq!(tip, "AAPL  $333.02\nDay  +3.62");
    }

    #[test]
    fn tooltip_regular_and_errors() {
        let q = state(|p| p.regular.start + 60);
        let tip = tooltip(&q, &Settings::default());
        assert_eq!(tip.lines().count(), 2);
        assert_eq!(badge(&q), Badge::Up);

        let offline = QuoteState { error: Some("network".into()), ..q };
        assert!(tooltip(&offline, &Settings::default()).ends_with("(offline, last known)"));

        let empty = QuoteState { error: Some("No data found".into()), ..QuoteState::default() };
        assert_eq!(tooltip(&empty, &Settings::default()), "tickr: AAPL\nNo data found");
        assert_eq!(badge(&empty), Badge::None);
    }

    #[test]
    fn warnings_survive_truncation() {
        let w = vec!["Hotkey Ctrl+Alt+K unavailable".to_string()];
        assert_eq!(with_warnings("AAPL  $1.00".into(), &w), "AAPL  $1.00\n⚠ Hotkey Ctrl+Alt+K unavailable");
        assert_eq!(with_warnings("AAPL".into(), &[]), "AAPL");
        let long = with_warnings("x".repeat(200), &w);
        assert_eq!(long.chars().count(), TIP_MAX);
        assert!(long.ends_with("⚠ Hotkey Ctrl+Alt+K unavailable"));
    }

    #[test]
    fn prices() {
        assert_eq!(fmt_price(333.024, "USD"), "$333.02");
        assert_eq!(fmt_price(0.12345, "USD"), "$0.1235");
        assert_eq!(fmt_price(12.5, "CAD"), "12.50 CAD");
        assert_eq!(signed(-0.001, 2), "+0.00");
        assert_eq!(signed(-1.5, 2), "−1.50");
    }
}

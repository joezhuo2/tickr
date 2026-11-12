//! The main window: create on demand, destroy on minimize (when enabled),
//! and remember position and size across re-creations.

use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use tauri::window::Color;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window, WindowEvent,
};

use crate::settings::{Geometry, Theme};
use crate::state::{lock, Shared};

pub const LABEL: &str = "main";

static SHOWN: AtomicBool = AtomicBool::new(false);
static CHARTS: AtomicU32 = AtomicU32::new(1);

/// When the window last lost focus. Clicking the Windows tray icon activates
/// the taskbar first, so the window is no longer focused when the click lands.
static BLURRED_AT: Mutex<Option<Instant>> = Mutex::new(None);
/// A focus loss this recent still counts as focused for a tray click.
const TRAY_GRACE: Duration = Duration::from_millis(500);

/// Software compositing; the GPU process costs ~100 MB for a static chart.
#[cfg(windows)]
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu";

pub fn get(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Shows and focuses the window, creating it if needed.
pub fn open(app: &AppHandle) {
    if let Some(w) = get(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        visibility_changed(&w.state::<Arc<Shared>>(), shown(&w));
        return;
    }
    if let Err(e) = create(app) {
        log::error!("main window: {e}");
    }
}

/// Hotkey action: minimize when focused, otherwise open.
pub fn toggle(app: &AppHandle) {
    match get(app) {
        Some(w) if shown(&w) && w.is_focused().unwrap_or(false) => dismiss(&w),
        _ => open(app),
    }
}

/// Tray left-click: like the hotkey, but a window that lost focus to the
/// click itself still counts as focused.
pub fn tray_toggle(app: &AppHandle) {
    match get(app) {
        Some(w) if shown(&w) && (w.is_focused().unwrap_or(false) || recently_blurred()) => dismiss(&w),
        _ => open(app),
    }
}

pub fn shown(w: &WebviewWindow) -> bool {
    !w.is_minimized().unwrap_or(false) && w.is_visible().unwrap_or(false)
}

fn recently_blurred() -> bool {
    lock(&BLURRED_AT).is_some_and(|t| t.elapsed() < TRAY_GRACE)
}

#[cfg(not(target_os = "macos"))]
fn dismiss(w: &WebviewWindow) {
    let _ = w.minimize();
}

/// With no Dock icon (accessory policy) a minimized window has nowhere
/// obvious to come back from, so the hotkey hides or unloads it instead.
#[cfg(target_os = "macos")]
fn dismiss(w: &WebviewWindow) {
    let shared = w.state::<Arc<Shared>>().inner().clone();
    if lock(&shared.settings).unload_on_minimize {
        // Moved and Resized events keep the geometry current.
        persist_geometry(&shared);
        let _ = w.destroy();
    } else {
        let _ = w.hide();
        visibility_changed(&shared, false);
    }
}

fn build(app: &AppHandle, label: &str, title: &str, script: &str) -> tauri::Result<WebviewWindow> {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    let settings = lock(&shared.settings).clone();
    let on_top = settings.always_on_top;
    // The page reads this before its first frame instead of invoking get_init.
    let init = serde_json::to_string(&crate::commands::init_payload(&shared)).unwrap_or_else(|_| "null".into());
    // Match the page background so the window never flashes white.
    let bg = background(settings.theme);

    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()));
    #[cfg(windows)]
    let builder = builder.additional_browser_args(BROWSER_ARGS);
    let win = builder
        .title(title)
        .inner_size(800.0, 420.0)
        .min_inner_size(640.0, 360.0)
        .always_on_top(on_top)
        .background_color(bg)
        .initialization_script(format!("window.__TICKR_INIT__ = {init};{script}"))
        .visible(false)
        .build()?;

    win.set_zoom(f64::from(settings.text_size) / 100.0)?;
    Ok(win)
}

pub fn open_chart(app: &AppHandle, symbol: &str) -> tauri::Result<()> {
    let label = format!("chart-{}", CHARTS.fetch_add(1, Ordering::Relaxed));
    let script = format!("window.__TICKR_CHART__ = {};", serde_json::to_string(symbol).unwrap_or_else(|_| "null".into()));
    let win = build(app, &label, &format!("tickr · {symbol}"), &script)?;
    win.show()?;
    win.set_focus()?;
    Ok(())
}

fn create(app: &AppHandle) -> tauri::Result<()> {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    let geometry = *lock(&shared.geometry);
    let win = build(app, LABEL, "tickr", "")?;
    match geometry.filter(|g| on_screen(&win, g)) {
        Some(g) => {
            win.set_size(PhysicalSize::new(g.w, g.h))?;
            win.set_position(PhysicalPosition::new(g.x, g.y))?;
        }
        None => win.center()?,
    }
    win.show()?;
    visibility_changed(&shared, shown(&win));
    win.set_focus()?;
    Ok(())
}

pub fn is_dark(theme: Theme) -> bool {
    match theme {
        Theme::System => os_dark(),
        Theme::Light => false,
        Theme::Dark => true,
    }
}

pub fn background(theme: Theme) -> Color {
    if is_dark(theme) { Color(17, 17, 19, 255) } else { Color(255, 255, 255, 255) }
}

/// Whether the OS is in dark mode (Windows apps theme setting).
#[cfg(windows)]
fn os_dark() -> bool {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
    let value = wide("AppsUseLightTheme");
    let mut data: u32 = 1;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: valid NUL-terminated strings and a correctly sized out buffer.
    let rc = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut data as *mut u32).cast(),
            &mut size,
        )
    };
    rc == 0 && data == 0
}

/// Whether macOS is in dark mode. The global AppleInterfaceStyle default is
/// "Dark" in dark mode (including "Auto" after sunset) and unset in light.
#[cfg(target_os = "macos")]
fn os_dark() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "Dark")
        .unwrap_or(false)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn os_dark() -> bool {
    false
}

/// True when the saved top-left corner is on a connected monitor.
fn on_screen(win: &WebviewWindow, g: &Geometry) -> bool {
    win.available_monitors().unwrap_or_default().iter().any(|m| {
        let (p, s) = (m.position(), m.size());
        g.x >= p.x - 50 && g.y >= p.y - 50 && g.x < p.x + s.width as i32 && g.y < p.y + s.height as i32
    })
}

fn record_geometry(win: &Window, shared: &Shared) {
    if win.is_minimized().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) else { return };
    // Windows reports -32000 for minimized windows.
    if pos.x <= -30000 || size.width == 0 {
        return;
    }
    *lock(&shared.geometry) = Some(Geometry { x: pos.x, y: pos.y, w: size.width, h: size.height });
}

fn persist_geometry(shared: &Shared) {
    let g = *lock(&shared.geometry);
    if g.is_some() {
        shared.update_settings(|s| s.geometry = g);
    }
}

fn visibility_changed(shared: &Shared, visible: bool) {
    if !SHOWN.swap(visible, Ordering::Relaxed) && visible {
        shared.wake.notify_one();
    }
}

pub fn on_event(win: &Window, ev: &WindowEvent) {
    if win.label() != LABEL {
        return;
    }
    let shared = win.state::<Arc<Shared>>().inner().clone();
    let visible = !matches!(ev, WindowEvent::Destroyed)
        && !win.is_minimized().unwrap_or(false) && win.is_visible().unwrap_or(false);
    visibility_changed(&shared, visible);
    match ev {
        WindowEvent::Moved(_) => record_geometry(win, &shared),
        WindowEvent::Focused(false) => *lock(&BLURRED_AT) = Some(Instant::now()),
        WindowEvent::Resized(_) => {
            if win.is_minimized().unwrap_or(false) {
                if lock(&shared.settings).unload_on_minimize {
                    persist_geometry(&shared);
                    let w = win.clone();
                    // Destroy outside the event callback.
                    tauri::async_runtime::spawn(async move {
                        let _ = w.destroy();
                    });
                }
            } else {
                record_geometry(win, &shared);
            }
        }
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => persist_geometry(&shared),
        _ => {}
    }
}

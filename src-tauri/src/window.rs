//! The main window: create on demand, destroy on minimize (when enabled),
//! and remember position and size across re-creations.

use std::sync::Arc;

use tauri::window::Color;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window, WindowEvent,
};

use crate::settings::Geometry;
use crate::state::{lock, Shared};

pub const LABEL: &str = "main";

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
        return;
    }
    if let Err(e) = create(app) {
        log::error!("main window: {e}");
    }
}

/// Hotkey action: minimize when focused, otherwise open.
pub fn toggle(app: &AppHandle) {
    match get(app) {
        Some(w)
            if w.is_focused().unwrap_or(false)
                && !w.is_minimized().unwrap_or(false)
                && w.is_visible().unwrap_or(false) =>
        {
            let _ = w.minimize();
        }
        _ => open(app),
    }
}

fn create(app: &AppHandle) -> tauri::Result<()> {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    let on_top = lock(&shared.settings).always_on_top;
    let geometry = *lock(&shared.geometry);
    // The page reads this before its first frame instead of invoking get_init.
    let init = serde_json::to_string(&crate::commands::init_payload(&shared)).unwrap_or_else(|_| "null".into());
    // Match the page background so the window never flashes white.
    let bg = if os_dark() { Color(17, 17, 19, 255) } else { Color(255, 255, 255, 255) };

    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()));
    #[cfg(windows)]
    let builder = builder.additional_browser_args(BROWSER_ARGS);
    let win = builder
        .title("tickr")
        .inner_size(800.0, 420.0)
        .min_inner_size(640.0, 360.0)
        .always_on_top(on_top)
        .background_color(bg)
        .initialization_script(format!("window.__TICKR_INIT__ = {init};"))
        .visible(false)
        .build()?;

    match geometry.filter(|g| on_screen(&win, g)) {
        Some(g) => {
            win.set_size(PhysicalSize::new(g.w, g.h))?;
            win.set_position(PhysicalPosition::new(g.x, g.y))?;
        }
        None => win.center()?,
    }
    // The page calls `window_ready` after its first paint, so the window
    // appears already rendered. Fallback in case the page never reports.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        reveal(&win);
    });
    Ok(())
}

/// Shows and focuses a window created hidden. No-op once visible.
pub fn reveal(win: &WebviewWindow) {
    if !win.is_visible().unwrap_or(true) {
        let _ = win.show();
        let _ = win.set_focus();
    }
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

#[cfg(not(windows))]
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

pub fn on_event(win: &Window, ev: &WindowEvent) {
    if win.label() != LABEL {
        return;
    }
    let shared = win.state::<Arc<Shared>>().inner().clone();
    match ev {
        WindowEvent::Moved(_) => record_geometry(win, &shared),
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

//! The main window: create on demand, destroy on minimize (when enabled),
//! and remember position and size across re-creations.

use std::sync::Arc;

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

    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()));
    #[cfg(windows)]
    let builder = builder.additional_browser_args(BROWSER_ARGS);
    let win = builder
        .title("tickr")
        .inner_size(800.0, 420.0)
        .min_inner_size(640.0, 360.0)
        .always_on_top(on_top)
        .visible(false)
        .build()?;

    match geometry.filter(|g| on_screen(&win, g)) {
        Some(g) => {
            win.set_size(PhysicalSize::new(g.w, g.h))?;
            win.set_position(PhysicalPosition::new(g.x, g.y))?;
        }
        None => win.center()?,
    }
    win.show()?;
    win.set_focus()?;
    Ok(())
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

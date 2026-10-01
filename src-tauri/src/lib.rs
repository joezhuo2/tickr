//! tickr: a tray stock ticker with a chart window behind a global hotkey.

pub mod commands;
pub mod hotkey;
pub mod logo;
pub mod poller;
pub mod quote;
pub mod settings;
pub mod state;
pub mod tray;
pub mod trayicon;
pub mod window;

use std::sync::Arc;

use tauri::RunEvent;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

use crate::settings::Settings;
use crate::state::{lock, Shared};

pub fn run() {
    let settings_path = settings::settings_path();
    let shared = Arc::new(Shared::new(settings_path.clone(), Settings::load(&settings_path)));
    let autostarted = std::env::args().any(|a| a == "--autostarted");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| window::open(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostarted"])))
        .plugin(hotkey::plugin())
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![
            commands::get_init,
            commands::get_chart,
            commands::search,
            commands::set_symbol,
            commands::set_range,
            commands::set_chart_mode,
            commands::set_hotkey,
            commands::get_logo,
        ])
        .on_window_event(window::on_event)
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let first_run = !lock(&shared.settings).first_run_done;
            // Dev builds never register themselves as a login item.
            if first_run && !cfg!(debug_assertions) {
                if let Err(e) = handle.autolaunch().enable() {
                    log::warn!("enable autostart: {e}");
                }
            }
            if first_run {
                shared.update_settings(|s| s.first_run_done = true);
            }

            tray::build(&handle)?;
            let hk = lock(&shared.settings).hotkey.clone();
            if let Err(e) = hotkey::register(&handle, &hk) {
                log::warn!("hotkey: {e}");
            }
            poller::spawn(handle.clone(), shared.clone());

            if !autostarted && !lock(&shared.settings).start_hidden {
                window::open(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tickr");

    app.run(|_app, event| {
        // Closing the window must not quit the tray app.
        if let RunEvent::ExitRequested { api, code: None, .. } = event {
            api.prevent_exit();
        }
    });
}

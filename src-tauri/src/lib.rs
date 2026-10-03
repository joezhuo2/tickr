//! tickr: a tray stock ticker with a chart window behind a global hotkey.

pub mod analyst;
pub mod autostart;
pub mod commands;
pub mod hotkey;
pub mod logo;
pub mod news;
pub mod poller;
pub mod quote;
pub mod settings;
pub mod state;
pub mod tray;
pub mod trayicon;
pub mod updater;
pub mod window;

use std::sync::Arc;

use tauri::plugin::TauriPlugin;
use tauri::{RunEvent, Wry};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

use crate::settings::Settings;
use crate::state::{lock, Shared};

/// Rotating file in the app log dir, so bug reports have something to attach.
/// Dev builds also log to stdout.
fn log_plugin() -> TauriPlugin<Wry> {
    let mut b = tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir { file_name: None }))
        .level(log::LevelFilter::Info)
        .max_file_size(1_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(2))
        .timezone_strategy(TimezoneStrategy::UseLocal);
    if cfg!(debug_assertions) {
        b = b.target(Target::new(TargetKind::Stdout)).level(log::LevelFilter::Debug);
    }
    b.build()
}

/// Release builds abort on panic with no console; log the message first.
fn log_panics() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("{info}");
        prev(info);
    }));
}

pub fn run() {
    log_panics();
    let settings_path = settings::settings_path();
    let shared = Arc::new(Shared::new(settings_path.clone(), Settings::load(&settings_path)));
    let autostarted = std::env::args().any(|a| a == "--autostarted");

    let app = tauri::Builder::default()
        .plugin(log_plugin())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| window::open(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostarted"])))
        .plugin(hotkey::plugin())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![
            commands::get_init,
            commands::window_ready,
            commands::get_chart,
            commands::search,
            commands::set_symbol,
            commands::set_range,
            commands::set_chart_mode,
            commands::set_hotkey,
            commands::get_logo,
            commands::open_logo_credit,
            commands::get_analyst,
            commands::set_watchlist,
            commands::get_watch_quotes,
            commands::get_news,
            commands::open_news,
        ])
        .on_window_event(window::on_event)
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            log::info!("tickr {} starting", app.package_info().version);
            let handle = app.handle().clone();

            // Before the tray, so its first tooltip can report a failure.
            let hk = lock(&shared.settings).hotkey.clone();
            if let Err(e) = hotkey::register(&handle, &hk) {
                log::warn!("hotkey: {e}");
                *lock(&shared.hotkey_error) = Some(e);
            }
            autostart::sync(&handle, &shared);
            tray::build(&handle)?;
            poller::spawn(handle.clone(), shared.clone());
            updater::spawn(handle.clone(), shared.clone());

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

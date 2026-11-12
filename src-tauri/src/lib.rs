//! tickr: a tray stock ticker with a chart window behind a global hotkey.

pub mod alpaca;
pub mod provider;
pub mod stream;
pub mod ai;
pub mod analysis;
pub mod alerts;
pub mod analyst;
pub mod autostart;
pub mod backup;
pub mod calendar;
pub mod commands;
pub mod connections;
pub mod earnings;
pub mod events;
pub mod financials;
pub mod grades;
pub mod hotkey;
pub mod ivrank;
pub mod logo;
pub mod market;
pub mod options;
pub mod news;
pub mod paper;
pub mod poller;
pub mod quote;
pub mod screener;
pub mod sentiment;
pub mod settings;
pub mod stats;
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
        .level_for("tungstenite", log::LevelFilter::Warn)
        .level_for("tokio_tungstenite", log::LevelFilter::Warn)
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
        .plugin(tauri_plugin_notification::init())
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![
            commands::get_init,
            connections::get_connections,
            connections::retry_connection,
            connections::get_diagnostics,
            commands::get_data_provider,
            commands::set_data_provider,
            commands::clear_alpaca_keys,
            commands::test_alpaca,
            commands::get_chart,
            commands::get_history,
            commands::set_chart_extended_hours,
            commands::set_chart_shade_sessions,
            commands::set_chart_time_zone,
            commands::set_chart_layout,
            commands::analyze,
            commands::set_indicators,
            commands::save_indicator_preset,
            commands::delete_indicator_preset,
            commands::search,
            commands::set_symbol,
            commands::refresh_quote,
            commands::set_range,
            commands::set_interval,
            commands::set_drawings,
            commands::send_notification,
            commands::get_older,
            commands::set_theme,
            commands::set_text_size,
            commands::set_palette,
            commands::set_chart_mode,
            commands::set_refresh_mode,
            commands::set_chart_scale,
            commands::set_hotkey,
            commands::export_settings,
            commands::import_settings,
            commands::set_keybinds,
            commands::set_dots,
            commands::get_ai_config,
            commands::test_ai,
            commands::set_ai_config,
            commands::clear_ai_key,
            commands::add_alert,
            commands::set_alert_enabled,
            commands::update_alert,
            commands::duplicate_alert,
            commands::delete_alert,
            commands::get_logo,
            commands::open_logo_credit,
            commands::get_analyst,
            commands::get_earnings,
            commands::get_rating_changes,
            commands::get_stats,
            commands::get_financials,
            commands::get_market,
            commands::get_options,
            commands::set_watchlist,
            commands::set_groups,
            commands::set_watchlist_sort,
            commands::set_watchlist_view,
            commands::set_watchlist_columns,
            commands::get_watch_quotes,
            commands::get_screener_data,
            commands::get_iv_ranks,
            commands::save_screen,
            commands::delete_screen,
            commands::get_news,
            commands::get_news_feed,
            commands::open_news,
            commands::get_events,
            commands::get_watch_calendar,
            commands::set_event_filter,
            commands::analyze_event,
            commands::get_paper,
            commands::save_paper,
            commands::reset_paper,
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
            stream::spawn(handle.clone(), shared.clone());
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

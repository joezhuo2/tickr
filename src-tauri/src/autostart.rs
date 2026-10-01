//! "Launch at login", kept in settings as well as the OS.
//!
//! Installing a new version over an old one runs the old uninstaller, which
//! deletes the HKCU Run value. The setting survives, so startup puts the
//! value back.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::state::{lock, Shared};

/// Re-registers launch at login when the setting wants it but the OS entry
/// is gone. Otherwise records what the OS says, so changes made outside the
/// app (Task Manager, a fresh install) win.
pub fn sync(app: &AppHandle, shared: &Shared) {
    let al = app.autolaunch();
    let enabled = al.is_enabled().unwrap_or(false);
    let want = lock(&shared.settings).autostart;
    if want == Some(true) && !enabled && !disabled_in_task_manager(&app.package_info().name) {
        match al.enable() {
            Ok(()) => log::info!("restored launch at login"),
            Err(e) => {
                log::error!("restore autostart: {e}");
                *lock(&shared.autostart_error) = Some("Could not restore launch at login".into());
            }
        }
        return;
    }
    if want != Some(enabled) {
        shared.update_settings(|s| s.autostart = Some(enabled));
    }
}

/// True when the user turned the app off in Task Manager's Startup tab.
#[cfg(windows)]
fn disabled_in_task_manager(name: &str) -> bool {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_BINARY};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run");
    let value = wide(name);
    let mut data = [0u8; 12];
    let mut size = data.len() as u32;
    // SAFETY: valid NUL-terminated strings and a correctly sized out buffer.
    let rc = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_BINARY,
            std::ptr::null_mut(),
            data.as_mut_ptr().cast(),
            &mut size,
        )
    };
    // Enabled entries have an even first byte (2); disabled ones odd (3).
    rc == 0 && size >= 1 && data[0] & 1 == 1
}

#[cfg(not(windows))]
fn disabled_in_task_manager(_name: &str) -> bool {
    false
}

# Before first release (v0.1.0)

Target: Windows (NSIS) and macOS (dmg/app) installers attached to a tagged GitHub Release, built by CI.

## Blockers

- [ ] Install a logger. Every `log::warn!`/`log::error!` (poller, hotkey, autostart, settings save, window create) currently goes nowhere, and release builds use `panic = "abort"` with no console. Add `tauri-plugin-log` writing to a rotating file in the app log dir so user bug reports have something to attach.
- [ ] Change the bundle identifier. `dev.tickr.app` ends in `.app`, which Tauri warns conflicts with the macOS bundle extension (`src-tauri/tauri.conf.json`). Pick the final one now, since changing it later moves the settings/cache dirs and orphans autostart entries.
- [ ] Surface hotkey registration failure. If `Ctrl+Alt+K` is taken at startup, `lib.rs` only logs it and the footer still shows the hotkey as if it works. Show an error in the window footer and/or tray tooltip.
- [ ] Decide on autostart consent. First launch silently enables "Launch at login" (`lib.rs` setup). Either keep it and mention it in the README, or make it opt-in.
- [ ] Clean up on uninstall. The NSIS uninstaller leaves the autostart Run key and the config/cache dirs (`settings.rs`). Add an NSIS uninstall hook that removes the Run entry and offers to delete app data.
- [ ] Report autostart toggle errors. `tray.rs` ignores the result of `enable()`/`disable()`, so the check mark can silently disagree with reality.

## macOS

- [ ] Detect dark mode. `os_dark()` in `window.rs` always returns false off Windows, so the window flashes white in dark mode before the page paints.
- [ ] Tray icon fit. macOS menu bar icons are ~22pt tall and usually template images; check the 32x32 colored logo plus badge looks right and isn't blurry on Retina. Consider `set_title` to show the price next to the icon, since hover tooltips are less discoverable there.
- [ ] Verify "Unload window when minimized" with `ActivationPolicy::Accessory` (no Dock icon): minimize must not strand the window, and the hotkey must bring it back.
- [ ] Default hotkey. `Ctrl+Alt+K` works but `Cmd+Shift+K` style is more idiomatic; decide whether to use a per-platform default in `settings.rs`.
- [ ] Verify autostart with `MacosLauncher::LaunchAgent` passes `--autostarted` and that "Start hidden" behaves the same as on Windows.
- [ ] Code signing and notarization with a Developer ID; unsigned apps are blocked by Gatekeeper.

## Windows

- [ ] Code signing (Authenticode, or Azure Trusted Signing). Unsigned installers trigger SmartScreen warnings.
- [ ] NSIS settings in `tauri.conf.json`: `installMode` (per-user avoids UAC), install/uninstall icon, languages.
- [ ] Re-check the memory table in the README against the final release build.

## CI and release

- [ ] Add a CI workflow (`.github/workflows/`) running `cargo test`, `cargo clippy`, `cargo fmt --check`, `npm test` and `npm run check` on Windows and macOS.
- [ ] Add a release workflow using `tauri-apps/tauri-action` that builds on tag push and drafts a GitHub Release with the NSIS installer and dmg, with signing secrets wired in.
- [ ] Keep versions in sync: `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` all hold `0.1.0` separately. Add a check or a single bump script.
- [ ] Tag `v0.1.0`. The "release v0.1.0" commit exists but there is no tag.
- [ ] Add `CHANGELOG.md` and release notes.

## Bundle metadata

- [ ] Fill in `bundle` fields in `tauri.conf.json`: `publisher`, `copyright`, `shortDescription`, `longDescription`, `homepage`, `category`, `licenseFile`.
- [ ] Ship third-party license notices for bundled Rust crates and npm packages (e.g. `cargo about`), included in the installer or an About view.
- [ ] Add an About item to the tray menu with version, data source attribution (Yahoo Finance, Parqet) and the "not investment advice" disclaimer, which is currently only in the README.

## Docs

- [ ] README: screenshots or a GIF of the tray tooltip and chart window.
- [ ] README: install instructions per platform, including the SmartScreen/Gatekeeper note if signing isn't done.
- [ ] README: macOS usage (menu bar instead of tray overflow, hotkey).
- [ ] README: where settings, cache and logs live, and how to reset them.

## Nice to have (not blocking)

- [ ] Back up a corrupt `settings.json` instead of silently overwriting it with defaults on the next save (`Settings::load`).
- [ ] Prune the logo cache (`logo.rs`), which only grows.
- [ ] Currency formatting: `fmt_price` in `tray.rs` shows LSE quotes as `123.45 GBp`; handle pence and more currency symbols, and keep it consistent with `ui/src/lib/format.ts`.
- [ ] Auto-update via `tauri-plugin-updater` in a later release.

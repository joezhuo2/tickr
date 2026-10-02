# Release and video checklist

What's left before the public release and the demo video. Current state:
v0.4.0 is committed and pushed to `main`, the repo is public, and there are
no GitHub releases yet.

## Blockers

- [ ] **Test on real macOS hardware.** No macOS build has been run yet. Check:
  - [ ] Dark mode window background (no white flash)
  - [ ] Menu bar icon at 36 px is sharp on Retina, and the price title is readable in light and dark menu bars
  - [ ] `⌘⇧K` opens and hides the window, with and without "Unload window when minimized"
  - [ ] Launch at login: entry is created, survives a reboot, and `--autostarted` respects "Start hidden"
  - [ ] No Dock icon at launch (`LSUIElement`)
  - [ ] Settings, cache and log paths match the README table

## Signing

- [ ] Decide: sign now, or ship unsigned first and document the warnings.
- [ ] macOS: Developer ID certificate + notarization (Apple Developer Program, $99/yr). Without it, Gatekeeper blocks the app and users need right-click > Open or `xattr -dr com.apple.quarantine`.
- [ ] Windows: Authenticode cert or Azure Trusted Signing. Without it, SmartScreen shows "Windows protected your PC".
- [ ] If shipping unsigned, add a short "First launch" section to the README explaining both warnings and how to get past them.

## README and repo polish

- [ ] Screenshots or a GIF at the top: tray tooltip, chart window, analyst panel, watchlist, macOS menu bar title.
- [ ] Set the repo homepage URL (release page or video link).

## Legal and data sources

- [ ] Review Yahoo Finance's terms. tickr uses unofficial endpoints; the README disclaimer is there, but say it again in the video description. Have a plan if Yahoo blocks or changes the endpoints (error state in the UI, fallback source).

## Video prep

- [ ] Script / outline: problem, 10-second demo of hover and hotkey, chart and candles, analyst consensus, watchlist, memory footprint (7 MB when unloaded), macOS menu bar, how it's built (Tauri 2 + Svelte 5), where to download.
- [ ] Pick demo symbols and a recording time during market hours (and one pre-market or after-hours clip to show extended-hours quotes).
- [ ] Clean demo environment: fresh settings, tidy taskbar/menu bar, tray icon pinned out of the Windows overflow, no personal watchlist or notifications on screen.
- [ ] Record on both Windows and macOS.
- [ ] Thumbnail, title and description with the download link, repo link and disclaimers.
- [ ] Release must be live and download links working before the video goes up.

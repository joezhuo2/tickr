## Testing

- [ ] **Test on real macOS hardware.** No macOS build has been run yet. Check:
  - [ ] Dark mode window background (no white flash)
  - [ ] Menu bar icon at 36 px is sharp on Retina, and the price title is readable in light and dark menu bars
  - [ ] `⌘⇧K` opens and hides the window, with and without "Unload window when minimized"
  - [ ] Launch at login: entry is created, survives a reboot, and `--autostarted` respects "Start hidden"
  - [ ] No Dock icon at launch (`LSUIElement`)
  - [ ] Settings, cache and log paths match the README table

## README and repo polish

- [ ] Screenshots or a GIF at the top: tray tooltip, chart window, analyst panel, watchlist, macOS menu bar title.
- [ ] Set the repo homepage URL (release page or video link).

## Video prep

- [ ] Script / outline: problem, 10-second demo of hover and hotkey, chart and candles, analyst consensus, watchlist, memory footprint (7 MB when unloaded), macOS menu bar, how it's built (Tauri 2 + Svelte 5), where to download.
- [ ] Pick demo symbols and a recording time during market hours (and one pre-market or after-hours clip to show extended-hours quotes).
- [ ] Clean demo environment: fresh settings, tidy taskbar/menu bar, tray icon pinned out of the Windows overflow, no personal watchlist or notifications on screen.
- [ ] Record on both Windows and macOS.
- [ ] Thumbnail, title and description with the download link, repo link and disclaimers.
- [ ] Release must be live and download links working before the video goes up.

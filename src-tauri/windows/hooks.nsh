; NSIS installer hooks (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; Tauri's uninstaller already removes the HKCU Run value named after the
; product and, when "Delete the application data" is checked, the
; $APPDATA\<identifier> and $LOCALAPPDATA\<identifier> dirs (WebView2 data
; and logs). This hook removes what tickr adds on top of that.

!macro NSIS_HOOK_POSTUNINSTALL
  ; Updates run the old uninstaller; keep the user's state for those.
  ${If} $UpdateMode <> 1
    ; Written by the autostart plugin next to the Run value; Task Manager's
    ; Startup tab keeps listing the app until it is gone.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  ${EndIf}

  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    ; settings.rs: config_dir() and cache_dir() (settings and logo cache).
    RmDir /r "$APPDATA\tickr"
    RmDir /r "$LOCALAPPDATA\tickr"
  ${EndIf}
!macroend

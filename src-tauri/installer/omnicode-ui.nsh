; Included via Tauri's installerHooks path, which the bundler resolves absolutely.
; The engine remains in installer.nsi; all OmniCode-only presentation is here.
; Dark surfaces follow the desktop app (#151515) with the default accent.
!define MUI_BGCOLOR "151515"
!define MUI_TEXTCOLOR "EDEDED"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_INSTFILESPAGE_COLORS "8C8C8C 1A1A1A"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"
!define MUI_CUSTOMFUNCTION_GUIINIT OmniGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.OmniGuiInit
SetFont "Segoe UI" 10
ShowInstDetails show
ShowUninstDetails show

!define OMNI_BG "151515"
!define OMNI_FOOTER "101010"
!define OMNI_SURFACE "1C1C1C"
!define OMNI_STROKE "333333"
!define OMNI_HAIRLINE "262626"
!define OMNI_TEXT "EDEDED"
!define OMNI_MUTED "9A9A9A"
!define OMNI_FAINT "6E6E6E"
; COLORREF (0x00BBGGRR) forms for Win32 messages and DWM attributes.
!define OMNI_BG_REF 0x151515
!define OMNI_ACCENT_REF 0x3759BD
!define OMNI_TRACK_REF 0x2A2A2A
!define OMNI_TEXT_REF 0xEDEDED

Var MonoDesktopShortcut
Var MonoShortcutControl
Var OmniTitleFont
Var OmniHeroFont
Var OmniCodeFont
Var OmniFinishDialog
Var OmniControl

; Use dialog units so control placement follows the native font and DPI.
!macro OmniPlace CONTROL X Y WIDTH HEIGHT
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  System::Call '*(i ${X}, i ${Y}, i ${WIDTH}, i ${HEIGHT}) p.r4'
  System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r4)'
  System::Call '*$4(i .r0, i .r1, i .r2, i .r3)'
  System::Call 'user32::MoveWindow(p ${CONTROL}, i r0, i r1, i r2, i r3, i 1)'
  System::Free $4
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; Create a native child control in dialog units; the handle lands in $OmniControl.
!macro OmniCreate PARENT CLASS TEXT STYLE X Y WIDTH HEIGHT
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  System::Call '*(i ${X}, i ${Y}, i ${WIDTH}, i ${HEIGHT}) p.r4'
  System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r4)'
  System::Call '*$4(i .r0, i .r1, i .r2, i .r3)'
  System::Free $4
  System::Call 'user32::CreateWindowEx(i 0, w "${CLASS}", w "${TEXT}", i ${STYLE}, i r0, i r1, i r2, i r3, p ${PARENT}, p 0, p 0, p 0) p.r4'
  StrCpy $OmniControl $4
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $0
  SendMessage $OmniControl ${WM_SETFONT} $0 1
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; Flat color blocks behind other controls. WS_CLIPSIBLINGS keeps them from
; painting over the native controls stacked above them.
!define OMNI_PANEL_STYLE 0x54000000
!macro OmniPanel PARENT BG X Y WIDTH HEIGHT
  Push $4
  System::Call 'user32::CreateWindowEx(i 0, w "STATIC", w "", i ${OMNI_PANEL_STYLE}, i ${X}, i ${Y}, i ${WIDTH}, i ${HEIGHT}, p ${PARENT}, p 0, p 0, p 0) p.r4'
  StrCpy $OmniControl $4
  Pop $4
  SetCtlColors $OmniControl "" ${BG}
  System::Call 'user32::SetWindowPos(p $OmniControl, p 1, i 0, i 0, i 0, i 0, i 0x13)'
!macroend

; Flat native edit inside a 1px stroke at Y=46u, so validation, the browse
; dialog and keyboard behavior stay owned by NSIS.
!macro OmniField PARENT EDIT WIDTH
  !insertmacro OmniFlat ${EDIT}
  SetCtlColors ${EDIT} ${OMNI_TEXT} ${OMNI_SURFACE}
  SendMessage ${EDIT} ${WM_SETFONT} $OmniCodeFont 1
  !define /redef /math OMNI_FIELD_TEXT ${WIDTH} - 14
  !define /redef /math OMNI_FIELD_FILL ${WIDTH} - 2
  !insertmacro OmniPlace ${EDIT} 7 51 ${OMNI_FIELD_TEXT} 9
  Push $5
  !insertmacro OmniCreate ${PARENT} "STATIC" "" ${OMNI_PANEL_STYLE} 1 47 ${OMNI_FIELD_FILL} 16
  StrCpy $5 $OmniControl
  SetCtlColors $5 "" ${OMNI_SURFACE}
  !insertmacro OmniCreate ${PARENT} "STATIC" "" ${OMNI_PANEL_STYLE} 0 46 ${WIDTH} 18
  SetCtlColors $OmniControl "" ${OMNI_STROKE}
  System::Call 'user32::SetWindowPos(p r5, p ${EDIT}, i 0, i 0, i 0, i 0, i 0x13)'
  System::Call 'user32::SetWindowPos(p $OmniControl, p r5, i 0, i 0, i 0, i 0, i 0x13)'
  Pop $5
!macroend

; Windows 10 1809+ ships dark variants of native visual styles. Older systems
; ignore the unknown class and keep the standard light control.
!macro OmniDark CONTROL
  System::Call 'uxtheme::SetWindowTheme(p ${CONTROL}, w "DarkMode_Explorer", p 0)'
!macroend

; Remove the classic 3D client/static edge and WS_BORDER from a native control.
!macro OmniFlat CONTROL
  Push $0
  System::Call 'user32::GetWindowLong(p ${CONTROL}, i -20) i.r0'
  IntOp $0 $0 & 0xFFFDFDFF
  System::Call 'user32::SetWindowLong(p ${CONTROL}, i -20, i r0)'
  System::Call 'user32::GetWindowLong(p ${CONTROL}, i -16) i.r0'
  IntOp $0 $0 & 0xFF7FFFFF
  System::Call 'user32::SetWindowLong(p ${CONTROL}, i -16, i r0)'
  System::Call 'user32::SetWindowPos(p ${CONTROL}, p 0, i 0, i 0, i 0, i 0, i 0x37)'
  Pop $0
!macroend

; Checkbox and radio text ignores WM_CTLCOLORSTATIC while visual styles draw
; it, so these keep classic rendering with readable colors and native focus.
!macro OmniOption CONTROL
  System::Call 'uxtheme::SetWindowTheme(p ${CONTROL}, w "", w "")'
  SetCtlColors ${CONTROL} ${OMNI_TEXT} ${OMNI_BG}
!macroend

!macro OmniInitBody
  CreateFont $OmniTitleFont "Segoe UI Semibold" 13 600
  CreateFont $OmniHeroFont "Segoe UI Semibold" 20 600
  CreateFont $OmniCodeFont "Consolas" 9 400
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6

  ; Dark title bar and border (Windows 10 2004+ / Windows 11; no-ops elsewhere).
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i.r0'
  ${If} $0 <> 0
    System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4)'
  ${EndIf}
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i ${OMNI_BG_REF}, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 34, *i 0x262626, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 36, *i ${OMNI_TEXT_REF}, i 4)'

  SetCtlColors $HWNDPARENT ${OMNI_TEXT} ${OMNI_BG}
  SetCtlColors $mui.Header.Text ${OMNI_TEXT} ${OMNI_BG}
  SetCtlColors $mui.Header.SubText ${OMNI_MUTED} ${OMNI_BG}
  SendMessage $mui.Header.Text ${WM_SETFONT} $OmniTitleFont 1
  ShowWindow $mui.Line.Standard ${SW_HIDE}
  ShowWindow $mui.Line.FullWindow ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1036
  ShowWindow $0 ${SW_HIDE}

  ; Client width/height in $5/$6.
  System::Call '*(i 0, i 0, i 0, i 0) p.r4'
  System::Call 'user32::GetClientRect(p $HWNDPARENT, p r4)'
  System::Call '*$4(i, i, i .r5, i .r6)'

  ; Hairline under the header.
  System::Call 'user32::GetWindowRect(p $mui.Header.Background, p r4)'
  System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r4, i 2)'
  System::Call '*$4(i, i, i, i .r3)'
  !insertmacro OmniPanel $HWNDPARENT ${OMNI_HAIRLINE} 0 r3 r5 1

  ; Footer band from the (hidden) button separator to the bottom edge.
  System::Call 'user32::GetWindowRect(p $mui.Line.Standard, p r4)'
  System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r4, i 2)'
  System::Call '*$4(i, i .r1, i, i)'
  System::Free $4
  IntOp $2 $6 - $1
  !insertmacro OmniPanel $HWNDPARENT ${OMNI_FOOTER} 0 r1 r5 r2
  !insertmacro OmniPanel $HWNDPARENT ${OMNI_HAIRLINE} 0 r1 r5 1

  !insertmacro OmniDark $mui.Button.Next
  !insertmacro OmniDark $mui.Button.Back
  !insertmacro OmniDark $mui.Button.Cancel
  ShowWindow $mui.Branding.Background ${SW_HIDE}
  SetCtlColors $mui.Branding.Text ${OMNI_FAINT} ${OMNI_FOOTER}
  SendMessage $mui.Branding.Text ${WM_SETFONT} $OmniCodeFont 1
  SendMessage $mui.Branding.Text ${WM_SETTEXT} 0 "STR:${PRODUCTNAME} ${VERSION}"

  ; Step label: aligned with page content, vertically centred on the buttons.
  System::Call '*(i 0, i 0, i 0, i 0) p.r4'
  GetDlgItem $0 $HWNDPARENT 1018
  System::Call 'user32::GetWindowRect(p r0, p r4)'
  System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r4, i 2)'
  System::Call '*$4(i .r1, i, i, i)'
  ; It ends before the Back slot, which the finish page's primary action reuses.
  System::Call 'user32::GetWindowRect(p $mui.Button.Back, p r4)'
  System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r4, i 2)'
  System::Call '*$4(i .r0, i .r2, i, i .r3)'
  System::Free $4
  IntOp $0 $0 - $1
  IntOp $0 $0 - 8
  IntOp $3 $3 - $2
  System::Call 'user32::MoveWindow(p $mui.Branding.Text, i r1, i r2, i r0, i r3, i 1)'
  ; SS_CENTERIMAGE vertically centres the single text line.
  System::Call 'user32::GetWindowLong(p $mui.Branding.Text, i -16) i.r0'
  IntOp $0 $0 | 0x200
  System::Call 'user32::SetWindowLong(p $mui.Branding.Text, i -16, i r0)'

  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; Shared by the installer and uninstaller progress pages.
!macro OmniProgressBody
  SetCtlColors $mui.InstFilesPage ${OMNI_TEXT} ${OMNI_BG}
  SetCtlColors $mui.InstFilesPage.Text ${OMNI_TEXT} ${OMNI_BG}
  ; Thin, flat accent bar: PBM_SETBARCOLOR / PBM_SETBKCOLOR need the classic renderer.
  System::Call 'uxtheme::SetWindowTheme(p $mui.InstFilesPage.ProgressBar, w "", w "")'
  !insertmacro OmniFlat $mui.InstFilesPage.ProgressBar
  SendMessage $mui.InstFilesPage.ProgressBar 0x409 0 ${OMNI_ACCENT_REF}
  SendMessage $mui.InstFilesPage.ProgressBar 0x2001 0 ${OMNI_TRACK_REF}
  !insertmacro OmniPlace $mui.InstFilesPage.Text 0 0 300 10
  !insertmacro OmniPlace $mui.InstFilesPage.ProgressBar 0 14 300 3
  ; Keep real diagnostics visible in a quiet, dark log.
  !insertmacro OmniFlat $mui.InstFilesPage.Log
  !insertmacro OmniDark $mui.InstFilesPage.Log
  SendMessage $mui.InstFilesPage.Log ${WM_SETFONT} $OmniCodeFont 1
  !insertmacro OmniPlace $mui.InstFilesPage.Log 0 26 300 114
  ShowWindow $mui.InstFilesPage.ShowLogButton ${SW_HIDE}
!macroend

!macro OMNICODE_UI_FUNCTIONS
  LangString MonoStepSetup ${LANG_ENGLISH} "Step 1 of 3"
  LangString MonoStepSetup ${LANG_SIMPCHINESE} "第 1 步，共 3 步"
  LangString MonoStepInstall ${LANG_ENGLISH} "Step 2 of 3"
  LangString MonoStepInstall ${LANG_SIMPCHINESE} "第 2 步，共 3 步"
  LangString MonoStepReady ${LANG_ENGLISH} "Step 3 of 3"
  LangString MonoStepReady ${LANG_SIMPCHINESE} "第 3 步，共 3 步"
  LangString MonoSetupTitle ${LANG_ENGLISH} "Install OmniCode"
  LangString MonoSetupTitle ${LANG_SIMPCHINESE} "安装 OmniCode"
  LangString MonoSetupSubtitle ${LANG_ENGLISH} "Good ideas start here."
  LangString MonoSetupSubtitle ${LANG_SIMPCHINESE} "让好想法，开始运行。"
  LangString MonoSetupDescription ${LANG_ENGLISH} "Build with AI in one workspace. OmniCode installs for your Windows account only and needs no administrator rights."
  LangString MonoSetupDescription ${LANG_SIMPCHINESE} "在一个工作空间里与 AI 一起编写代码。OmniCode 仅为当前 Windows 用户安装，无需管理员权限。"
  LangString MonoLocationLabel ${LANG_ENGLISH} "Install location"
  LangString MonoLocationLabel ${LANG_SIMPCHINESE} "安装位置"
  LangString MonoInstall ${LANG_ENGLISH} "Install"
  LangString MonoInstall ${LANG_SIMPCHINESE} "安装"
  LangString MonoProgressTitle ${LANG_ENGLISH} "Preparing your workspace"
  LangString MonoProgressTitle ${LANG_SIMPCHINESE} "你的工作空间，即将就绪"
  LangString MonoProgressSubtitle ${LANG_ENGLISH} "Installing OmniCode. This usually takes less than a minute."
  LangString MonoProgressSubtitle ${LANG_SIMPCHINESE} "正在安装 OmniCode，通常不到一分钟。"
  LangString MonoDoneTitle ${LANG_ENGLISH} "Installation complete"
  LangString MonoDoneTitle ${LANG_SIMPCHINESE} "安装完成"
  LangString MonoDoneSubtitle ${LANG_ENGLISH} "OmniCode is installed and ready to use."
  LangString MonoDoneSubtitle ${LANG_SIMPCHINESE} "OmniCode 已安装，可以开始使用。"
  LangString MonoReadyTitle ${LANG_ENGLISH} "Ready. Set. Create."
  LangString MonoReadyTitle ${LANG_SIMPCHINESE} "准备好了，开始创造。"
  LangString MonoReadyDescription ${LANG_ENGLISH} "One workspace, endless possibilities. Open a project and connect your AI coding assistant to get started."
  LangString MonoReadyDescription ${LANG_SIMPCHINESE} "一个工作空间，无限可能。打开项目，连接你的 AI 编程助手即可开始。"
  LangString MonoLaunch ${LANG_ENGLISH} "Launch OmniCode"
  LangString MonoLaunch ${LANG_SIMPCHINESE} "启动 OmniCode"
  LangString MonoClose ${LANG_ENGLISH} "Close"
  LangString MonoClose ${LANG_SIMPCHINESE} "关闭"

  Function OmniGuiInit
    !insertmacro OmniInitBody
  FunctionEnd
  Function un.OmniGuiInit
    !insertmacro OmniInitBody
  FunctionEnd

  Function MonoSetupShow
    !insertmacro MUI_HEADER_TEXT "$(MonoSetupTitle)" "$(MonoSetupSubtitle)"
    SendMessage $mui.Branding.Text ${WM_SETTEXT} 0 "STR:$(MonoStepSetup)"
    SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(MonoInstall)"
    SetCtlColors $mui.DirectoryPage ${OMNI_TEXT} ${OMNI_BG}
    SetCtlColors $mui.DirectoryPage.Text ${OMNI_MUTED} ${OMNI_BG}
    !insertmacro OmniPlace $mui.DirectoryPage.Text 0 0 300 24

    ; The group box frame is dated; a plain label names the field instead.
    ShowWindow $mui.DirectoryPage.DirectoryBox ${SW_HIDE}
    !insertmacro OmniCreate $mui.DirectoryPage "STATIC" "$(MonoLocationLabel)" 0x50000000 0 34 230 10
    SetCtlColors $OmniControl ${OMNI_TEXT} ${OMNI_BG}

    !insertmacro OmniField $mui.DirectoryPage $mui.DirectoryPage.Directory 234

    !insertmacro OmniDark $mui.DirectoryPage.BrowseButton
    !insertmacro OmniPlace $mui.DirectoryPage.BrowseButton 240 46 60 18

    SetCtlColors $mui.DirectoryPage.SpaceRequired ${OMNI_FAINT} ${OMNI_BG}
    SetCtlColors $mui.DirectoryPage.SpaceAvailable ${OMNI_FAINT} ${OMNI_BG}
    !insertmacro OmniPlace $mui.DirectoryPage.SpaceRequired 0 118 300 10
    !insertmacro OmniPlace $mui.DirectoryPage.SpaceAvailable 0 129 300 10

    ; Native directory controls still validate the path and free disk space.
    ; Collect the desktop shortcut choice before files are copied.
    !insertmacro OmniCreate $mui.DirectoryPage "BUTTON" "$(createDesktop)" ${__NSD_CheckBox_STYLE} 0 76 300 12
    StrCpy $MonoShortcutControl $OmniControl
    !insertmacro OmniOption $MonoShortcutControl
    ${If} $NoShortcutMode = 1
    ${OrIf} $UpdateMode = 1
      ; Never offer an option that /NS or /UPDATE deliberately suppresses.
      StrCpy $MonoDesktopShortcut ${BST_UNCHECKED}
      EnableWindow $MonoShortcutControl 0
    ${EndIf}
    SendMessage $MonoShortcutControl ${BM_SETCHECK} $MonoDesktopShortcut 0
  FunctionEnd

  Function MonoSetupLeave
    SendMessage $MonoShortcutControl ${BM_GETCHECK} 0 0 $MonoDesktopShortcut
  FunctionEnd

  Function MonoProgressShow
    !insertmacro MUI_HEADER_TEXT "$(MonoProgressTitle)" "$(MonoProgressSubtitle)"
    SendMessage $mui.Branding.Text ${WM_SETTEXT} 0 "STR:$(MonoStepInstall)"
    !insertmacro OmniProgressBody
  FunctionEnd

  Function un.MonoProgressShow
    !insertmacro OmniProgressBody
  FunctionEnd

  ; PageReinstall (upstream) builds its nsDialogs page and calls this before
  ; showing it; it only restyles the label, radio buttons and dialog in $R1-$R4.
  Function MonoReinstallShow
    SetCtlColors $R4 ${OMNI_TEXT} ${OMNI_BG}
    SetCtlColors $R1 ${OMNI_MUTED} ${OMNI_BG}
    !insertmacro OmniOption $R2
    !insertmacro OmniOption $R3
  FunctionEnd

  ; Wraps the upstream confirm callback, which adds the app-data checkbox.
  Function un.MonoConfirmShow
    Call un.ConfirmShow
    SetCtlColors $mui.UnConfirmPage ${OMNI_TEXT} ${OMNI_BG}
    SetCtlColors $mui.UnConfirmPage.Text ${OMNI_MUTED} ${OMNI_BG}
    SetCtlColors $mui.UnConfirmPage.DirectoryText ${OMNI_TEXT} ${OMNI_BG}
    !insertmacro OmniPlace $mui.UnConfirmPage.Text 0 0 300 24
    !insertmacro OmniPlace $mui.UnConfirmPage.DirectoryText 0 34 300 10
    ; Read-only path in the same field style as the setup page.
    !insertmacro OmniField $mui.UnConfirmPage $mui.UnConfirmPage.Directory 300
    !insertmacro OmniOption $DeleteAppDataCheckbox
    !insertmacro OmniPlace $DeleteAppDataCheckbox 0 76 300 12
  FunctionEnd

  Function MonoFinish
    Call SkipIfPassive
    !insertmacro MUI_HEADER_TEXT "$(MonoDoneTitle)" "$(MonoDoneSubtitle)"
    nsDialogs::Create 1018
    Pop $OmniFinishDialog
    ${If} $OmniFinishDialog == error
      Abort
    ${EndIf}
    SetCtlColors $OmniFinishDialog ${OMNI_TEXT} ${OMNI_BG}
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4

    ; App icon at the exact pixel size of a 28u square, so DPI never upscales it.
    ${NSD_CreateIcon} 0 4u 28u 28u ""
    Pop $1
    System::Call '*(i 28, i 28, i 0, i 0) p.r4'
    System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r4)'
    System::Call '*$4(i .r2, i .r3)'
    System::Free $4
    System::Call 'kernel32::GetModuleHandle(p 0) p.r0'
    System::Call 'user32::LoadImage(p r0, i 103, i 1, i r2, i r3, i 0) p.r0'
    SendMessage $1 0x170 $0 0
    SetCtlColors $1 "" ${OMNI_BG}

    ${NSD_CreateLabel} 0 42u 100% 18u "$(MonoReadyTitle)"
    Pop $0
    SetCtlColors $0 ${OMNI_TEXT} ${OMNI_BG}
    SendMessage $0 ${WM_SETFONT} $OmniHeroFont 1
    ${NSD_CreateLabel} 0 64u 100% 30u "$(MonoReadyDescription)"
    Pop $0
    SetCtlColors $0 ${OMNI_MUTED} ${OMNI_BG}
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0

    SendMessage $mui.Branding.Text ${WM_SETTEXT} 0 "STR:$(MonoStepReady)"
    SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(MonoLaunch)"
    EnableWindow $mui.Button.Back 0
    ShowWindow $mui.Button.Back ${SW_HIDE}
    ; Let the primary action take the hidden Back slot so longer labels fit.
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    System::Call '*(i 0, i 0, i 0, i 0) p.r4'
    System::Call 'user32::GetWindowRect(p $mui.Button.Back, p r4)'
    System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r4, i 2)'
    System::Call '*$4(i .r0, i .r1, i, i)'
    System::Call 'user32::GetWindowRect(p $mui.Button.Next, p r4)'
    System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r4, i 2)'
    System::Call '*$4(i, i, i .r2, i .r3)'
    System::Free $4
    IntOp $2 $2 - $0
    IntOp $3 $3 - $1
    System::Call 'user32::MoveWindow(p $mui.Button.Next, i r0, i r1, i r2, i r3, i 1)'
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    EnableWindow $mui.Button.Cancel 1
    SendMessage $mui.Button.Cancel ${WM_SETTEXT} 0 "STR:$(MonoClose)"
    nsDialogs::Show
  FunctionEnd

  Function MonoFinishLeave
    ; Only the explicit primary action reaches this callback; X/Close do not.
    Call RunMainBinary
  FunctionEnd

  Function .onGUIEnd
    System::Call 'gdi32::DeleteObject(p $OmniTitleFont)'
    System::Call 'gdi32::DeleteObject(p $OmniHeroFont)'
    System::Call 'gdi32::DeleteObject(p $OmniCodeFont)'
  FunctionEnd
  Function un.onGUIEnd
    System::Call 'gdi32::DeleteObject(p $OmniTitleFont)'
    System::Call 'gdi32::DeleteObject(p $OmniHeroFont)'
    System::Call 'gdi32::DeleteObject(p $OmniCodeFont)'
  FunctionEnd
!macroend

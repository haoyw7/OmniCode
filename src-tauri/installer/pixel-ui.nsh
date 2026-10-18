; Included via Tauri's installerHooks path, which the bundler resolves absolutely.
; The engine remains in installer.nsi; all MonoCode-only presentation is here.
!define MUI_BGCOLOR "FFFFFF"
!define MUI_TEXTCOLOR "111111"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_INSTFILESPAGE_COLORS "111111 FFFFFF"
!define MUI_INSTFILESPAGE_PROGRESSBAR "colored"
!define MUI_CUSTOMFUNCTION_GUIINIT MonoGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.MonoGuiInit
SetFont "Segoe UI" 10
ShowInstDetails show

Var MonoDesktopShortcut
Var MonoShortcutControl
Var MonoTitleFont
Var MonoCodeFont
Var MonoFinishDialog

; Use dialog units so control placement follows the native font and DPI.
!macro MonoPlace CONTROL X Y WIDTH HEIGHT
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

; Remove colored OS themes from native controls without replacing keyboard,
; focus, accessibility or directory-validation behavior with painted controls.
!macro MonoNative CONTROL
  System::Call 'uxtheme::SetWindowTheme(p ${CONTROL}, w "", w "")'
  SetCtlColors ${CONTROL} 111111 FFFFFF
!macroend

  !macro MonoInitBody
    CreateFont $MonoTitleFont "Segoe UI" 12 700
    CreateFont $MonoCodeFont "Consolas" 10 400
    SetCtlColors $HWNDPARENT 111111 FFFFFF
    !insertmacro MonoNative $mui.Button.Next
    !insertmacro MonoNative $mui.Button.Back
    !insertmacro MonoNative $mui.Button.Cancel
    SetCtlColors $mui.Header.Text 111111 FFFFFF
    SetCtlColors $mui.Header.SubText 555555 FFFFFF
    SetCtlColors $mui.Branding.Text 555555 FFFFFF
    SendMessage $mui.Header.Text ${WM_SETFONT} $MonoTitleFont 1
    SendMessage $mui.Branding.Text ${WM_SETFONT} $MonoCodeFont 1
  !macroend

!macro MONOCODE_UI_FUNCTIONS
  LangString MonoStepSetup ${LANG_ENGLISH} "01 / SETUP"
  LangString MonoStepSetup ${LANG_SIMPCHINESE} "01 / 准备安装"
  LangString MonoStepInstall ${LANG_ENGLISH} "02 / INSTALL"
  LangString MonoStepInstall ${LANG_SIMPCHINESE} "02 / 正在安装"
  LangString MonoStepReady ${LANG_ENGLISH} "03 / READY"
  LangString MonoStepReady ${LANG_SIMPCHINESE} "03 / 安装完成"
  LangString MonoSetupTitle ${LANG_ENGLISH} "Install OmniCode"
  LangString MonoSetupTitle ${LANG_SIMPCHINESE} "安装 OmniCode"
  LangString MonoSetupSubtitle ${LANG_ENGLISH} "Good ideas start here."
  LangString MonoSetupSubtitle ${LANG_SIMPCHINESE} "让好想法，开始运行。"
  LangString MonoSetupDescription ${LANG_ENGLISH} "Build with AI in one workspace.$\r$\nInstall for your Windows account."
  LangString MonoSetupDescription ${LANG_SIMPCHINESE} "在一个工作空间里与 AI 一起编写代码。$\r$\n仅为当前 Windows 用户安装。"
  LangString MonoInstall ${LANG_ENGLISH} "Install"
  LangString MonoInstall ${LANG_SIMPCHINESE} "安装"
  LangString MonoProgressTitle ${LANG_ENGLISH} "Preparing your workspace"
  LangString MonoProgressTitle ${LANG_SIMPCHINESE} "你的工作空间，即将就绪。"
  LangString MonoProgressSubtitle ${LANG_ENGLISH} "Installing OmniCode. Please wait."
  LangString MonoProgressSubtitle ${LANG_SIMPCHINESE} "正在安装 OmniCode，请稍候。"
  LangString MonoReadyTitle ${LANG_ENGLISH} "Ready. Set. Create."
  LangString MonoReadyTitle ${LANG_SIMPCHINESE} "准备好了。开始创造。"
  LangString MonoReadySubtitle ${LANG_ENGLISH} "OmniCode is installed and ready to use."
  LangString MonoReadySubtitle ${LANG_SIMPCHINESE} "OmniCode 已安装完成。"
  LangString MonoReadyDescription ${LANG_ENGLISH} "ONE WORKSPACE. ENDLESS POSSIBILITIES.$\r$\n$\r$\nOpen a project and connect your AI coding assistant."
  LangString MonoReadyDescription ${LANG_SIMPCHINESE} "一个工作空间，无限可能。$\r$\n$\r$\n打开项目，连接你的 AI 编程助手。"
  LangString MonoLaunch ${LANG_ENGLISH} "Launch OmniCode"
  LangString MonoLaunch ${LANG_SIMPCHINESE} "启动 OmniCode"
  LangString MonoClose ${LANG_ENGLISH} "Close"
  LangString MonoClose ${LANG_SIMPCHINESE} "关闭"

  Function MonoGuiInit
    !insertmacro MonoInitBody
  FunctionEnd
  Function un.MonoGuiInit
    !insertmacro MonoInitBody
  FunctionEnd

  Function MonoSetupShow
    !insertmacro MUI_HEADER_TEXT "$(MonoSetupTitle)" "$(MonoSetupSubtitle)"
    SendMessage $mui.Branding.Text ${WM_SETTEXT} 0 "STR:$(MonoStepSetup)"
    SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(MonoInstall)"
    SetCtlColors $mui.DirectoryPage 111111 FFFFFF
    SetCtlColors $mui.DirectoryPage.Text 555555 FFFFFF
    !insertmacro MonoNative $mui.DirectoryPage.DirectoryBox
    !insertmacro MonoNative $mui.DirectoryPage.Directory
    !insertmacro MonoNative $mui.DirectoryPage.BrowseButton
    SendMessage $mui.DirectoryPage.Directory ${WM_SETFONT} $MonoCodeFont 1
    SetCtlColors $mui.DirectoryPage.SpaceRequired 555555 FFFFFF
    SetCtlColors $mui.DirectoryPage.SpaceAvailable 555555 FFFFFF
    !insertmacro MonoPlace $mui.DirectoryPage.Text 0 0 300 35
    !insertmacro MonoPlace $mui.DirectoryPage.DirectoryBox 0 43 300 35
    !insertmacro MonoPlace $mui.DirectoryPage.Directory 10 57 210 12
    !insertmacro MonoPlace $mui.DirectoryPage.BrowseButton 228 55 60 15
    !insertmacro MonoPlace $mui.DirectoryPage.SpaceRequired 0 111 300 10
    !insertmacro MonoPlace $mui.DirectoryPage.SpaceAvailable 0 123 300 10

    ; Native directory controls still validate the path and free disk space.
    ; Add the shortcut option in the gap below the directory group.
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    System::Call '*(i 0, i 86, i 300, i 14) p.r4'
    System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r4)'
    System::Call '*$4(i .r0, i .r1, i .r2, i .r3)'
    System::Call 'user32::CreateWindowEx(i 0, w "BUTTON", w "$(createDesktop)", i ${__NSD_CheckBox_STYLE}, i r0, i r1, i r2, i r3, p $mui.DirectoryPage, p 0, p 0, p 0) p.s'
    Pop $MonoShortcutControl
    System::Free $4
    SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $0
    SendMessage $MonoShortcutControl ${WM_SETFONT} $0 1
    !insertmacro MonoNative $MonoShortcutControl
    ${If} $NoShortcutMode = 1
    ${OrIf} $UpdateMode = 1
      ; Never offer an option that /NS or /UPDATE deliberately suppresses.
      StrCpy $MonoDesktopShortcut ${BST_UNCHECKED}
      EnableWindow $MonoShortcutControl 0
    ${EndIf}
    SendMessage $MonoShortcutControl ${BM_SETCHECK} $MonoDesktopShortcut 0
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  Function MonoSetupLeave
    SendMessage $MonoShortcutControl ${BM_GETCHECK} 0 0 $MonoDesktopShortcut
  FunctionEnd

  Function MonoProgressShow
    !insertmacro MUI_HEADER_TEXT "$(MonoProgressTitle)" "$(MonoProgressSubtitle)"
    SendMessage $mui.Branding.Text ${WM_SETTEXT} 0 "STR:$(MonoStepInstall)"
    SetCtlColors $mui.InstFilesPage 111111 FFFFFF
    SetCtlColors $mui.InstFilesPage.Text 555555 FFFFFF
    !insertmacro MonoNative $mui.InstFilesPage.ProgressBar
    ; PBM_SETBARCOLOR / PBM_SETBKCOLOR. No smooth flag: native pixel segments.
    SendMessage $mui.InstFilesPage.ProgressBar 0x409 0 0x111111
    SendMessage $mui.InstFilesPage.ProgressBar 0x2001 0 0xEEEEEE
    !insertmacro MonoNative $mui.InstFilesPage.Log
    SendMessage $mui.InstFilesPage.Log ${WM_SETFONT} $MonoCodeFont 1
    ; Keep real diagnostics visible; there is no animated disclosure to emulate.
    ShowWindow $mui.InstFilesPage.ShowLogButton ${SW_HIDE}
  FunctionEnd

  Function MonoFinish
    Call SkipIfPassive
    !insertmacro MUI_HEADER_TEXT "$(MonoReadyTitle)" "$(MonoReadySubtitle)"
    nsDialogs::Create 1018
    Pop $MonoFinishDialog
    ${If} $MonoFinishDialog == error
      Abort
    ${EndIf}
    SetCtlColors $MonoFinishDialog 111111 FFFFFF
    Push $0
    ${NSD_CreateLabel} 0 8u 38u 30u ">_"
    Pop $0
    SetCtlColors $0 FFFFFF 111111
    SendMessage $0 ${WM_SETFONT} $MonoTitleFont 1
    ${NSD_CreateLabel} 0 50u 100% 65u "$(MonoReadyDescription)"
    Pop $0
    SetCtlColors $0 111111 FFFFFF
    Pop $0
    SendMessage $mui.Branding.Text ${WM_SETTEXT} 0 "STR:$(MonoStepReady)"
    SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(MonoLaunch)"
    EnableWindow $mui.Button.Back 0
    ShowWindow $mui.Button.Back ${SW_HIDE}
    !insertmacro MonoPlace $mui.Button.Next 166 201 100 14
    EnableWindow $mui.Button.Cancel 1
    SendMessage $mui.Button.Cancel ${WM_SETTEXT} 0 "STR:$(MonoClose)"
    nsDialogs::Show
  FunctionEnd

  Function MonoFinishLeave
    ; Only the explicit primary action reaches this callback; X/Close do not.
    Call RunMainBinary
  FunctionEnd

  Function .onGUIEnd
    System::Call 'gdi32::DeleteObject(p $MonoTitleFont)'
    System::Call 'gdi32::DeleteObject(p $MonoCodeFont)'
  FunctionEnd
  Function un.onGUIEnd
    System::Call 'gdi32::DeleteObject(p $MonoTitleFont)'
    System::Call 'gdi32::DeleteObject(p $MonoCodeFont)'
  FunctionEnd
!macroend

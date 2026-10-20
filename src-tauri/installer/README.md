# Windows installer

The Windows configuration selects `installer.nsi` and includes `omnicode-ui.nsh`
through Tauri's absolute `installerHooks` path. The UI follows the desktop app's
dark theme: #151515 surfaces, a dark DWM title bar, a footer band with the
version, the application icon loaded at its native pixel size (no stretched
header bitmap), flat path fields, a thin accent progress bar (#BD5937) and a
dark diagnostic log, with English/Simplified Chinese strings.
Everything is stock NSIS + System plugin calls on native controls, so keyboard,
focus, accessibility and directory/disk-space validation stay owned by Windows.
Buttons and scrollbars use the `DarkMode_Explorer` visual style (Windows 10
1809+); older systems fall back to light native controls. Checkboxes and radio
buttons keep classic rendering because themed option text ignores custom colors.

Normal installation has three pages: a one-click setup page (icon, name, a
centred Install action that is the native Next button, and the location field
with "Change…" plus the desktop shortcut below), installation with real
diagnostic output, and an explicit launch/close choice. Back is shown on the
setup page only when an earlier page (existing-installation maintenance,
license or install mode) was actually displayed. Existing
installation maintenance and any configured license/install-mode pages remain
available. Native directory and disk-space validation are retained. Silent and
passive updates keep Tauri's `/P`, `/S`, `/NS`, `/UPDATE`, `/R`, and `/ARGS`
handling. Errors stay on the progress page; only successful installation moves
automatically to the final page.

`installer.nsi` is based on the MIT-licensed template in Tauri CLI **2.11.4**:
https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
Keep the included `LICENSE-MIT`. When updating Tauri CLI, compare that template
with the new version and review the engine contract checks in
`scripts/windows-installer.test.mjs`; they are source guards, not Windows runtime
tests. The handwritten UI is kept separate to make that comparison small.

Upstream blocks stay byte-identical except for one presentation call,
`Call MonoReinstallShow`, in `PageReinstall`. The uninstaller replaces the
upstream confirm page and its app-data checkbox with a custom page of two
cards, "Uninstall the app only" (default) and "Uninstall and delete all data";
it writes the choice to `$DeleteAppDataCheckboxState`, which the unchanged
`Section Uninstall` reads. Passive uninstalls skip the page and keep data.

Run focused source checks with `node --test scripts/windows-installer.test.mjs`.
Before publishing, manually verify first installation, unchecked desktop shortcut,
existing-version upgrade (Back returns to the maintenance page), invalid or
full-disk locations disabling Install, passive updater restart, `/NS`,
uninstall with either card (mouse and keyboard), and English/Chinese layout at 100%, 150%, and 200% Windows
scaling. Source/preprocessor checks cannot establish those runtime results.
Build and LAN publication remain manual, following the repository's AGENTS.md.

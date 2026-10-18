# Windows installer

The Windows configuration selects `installer.nsi` and includes `pixel-ui.nsh`
through Tauri's absolute `installerHooks` path. The UI uses monochrome native
controls, the OmniCode vector wordmark, a segmented progress bar, and English/Simplified
Chinese NSIS strings. Native title bars, buttons and focus indicators remain
owned by Windows; the HTML concept is not an embedded browser installer.

Normal installation has three pages: location/desktop shortcut, installation
with real diagnostic output, and an explicit launch/close choice. Existing
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

Regenerate the 150 × 57, 24-bit OmniCode header with
`node scripts/generate-installer-header.mjs`. The standalone interaction concept
is `design/windows-installer.html`.

Run focused source checks with `node --test scripts/windows-installer.test.mjs`.
Before publishing, manually verify first installation, unchecked desktop shortcut,
existing-version upgrade, passive updater restart, `/NS`, uninstall with/without
app-data removal, and English/Chinese layout at 100%, 150%, and 200% Windows
scaling. Source/preprocessor checks cannot establish those runtime results.
Build and LAN publication remain manual, following the repository's AGENTS.md.

# Contributing to OmniCode

This is an independently maintained personal fork of the upstream project. Keep changes
focused and follow [AGENTS.md](AGENTS.md). Upstream issues, provider restrictions
and maintainer approvals are not prerequisites for work in this fork.

## Development

Use Node.js 24+, a stable Rust toolchain, native Tauri dependencies, and at least
one installed and authenticated provider CLI. Use `npm ci` to install the locked
dependencies, then `npm run tauri dev` to start the desktop app.

| Directory | Responsibility |
| --- | --- |
| `src/app/`, `src/features/` | Desktop shell and product features |
| `src/integrations/harness/core/`, `providers/` | Shared provider contracts and protocol adapters |
| `src/shared/`, `src/platform/tauri/` | Shared UI and native platform adapters |
| `src-tauri/`, `crates/` | Native desktop and shared Rust process management |
| `host/` | Shared sessions, assistant and workflow runtime |
| `src/mobile/`, `mobile/` | Mobile UI, native projects and build tools |

Pi and OMP share `piFamily.ts`; verify both when changing shared behavior.
Localize application-owned text through `src/shared/i18n/`; preserve provider and user values.
Desktop and Host reuse adapters, but image persistence differs by runtime.

## Verification and delivery

Use `npm run set-version -- 0.1.0` to synchronize the application version across
the desktop and Host IM npm manifests and lockfiles, workspace Cargo manifest
and lockfile, Tauri configuration, Android versionName, and both iOS
MARKETING_VERSION settings. The command can be repeated and leaves third-party
dependency versions and native build counters unchanged. Write the corresponding
English and Chinese release notes in `CHANGELOG.md`; version synchronization does
not rewrite release history, rebuild binaries, or publish artifacts.

Run the smallest existing checks that cover the change and record their results.
Documentation-only edits need link and formatting inspection, not application
test suites. Use `npm run check:web`, `npm run test:host` or `npm run build` when
their scope is relevant; run `npm run check:rust` for Rust changes. Do not claim
compatibility for provider or device combinations that were not exercised.

Builds and publication are manual, explicitly requested operations. Follow
[AGENTS.md](AGENTS.md#verification); pushing source and publishing a Release
are separate steps. Do not configure automatic LAN publication hooks.

For pull requests, describe the final behavior, relevant checks and limitations.
Use the [PR template](.github/pull_request_template.md); include screenshots when
they help explain a UI change. Keep unrelated work out of the patch.

[Code of conduct](CODE_OF_CONDUCT.md) · [Security reports](SECURITY.md)

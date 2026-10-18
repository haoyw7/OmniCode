# OmniCode

[简体中文](README.md) · English

AI coding agents, projects, and tools in one workspace.

A personal fork of the upstream project, built with Tauri, React, and TypeScript. Includes a desktop app, a shared Host, and mobile clients.

![OmniCode desktop screenshot](docs/images/desktop-clean.jpg)

## Features

- **Multiple agents**: Claude Code, Codex, OpenCode, Pi, OMP, and more, with unified sessions and model selection.
- **Project workspace**: File browsing, integrated terminals, Git diff review, branches, and worktrees.
- **Tasks and workflows**: Subagents, reusable workflows, Bots, notes, and automation tools.
- **Across devices**: Connect to remote computers through a shared Host. Access projects and conversations from Android and iOS clients.
- **Interface**: English and Chinese, light and dark themes, and chat and code workspace modes.

## Development

Install Node.js 24+, stable Rust, your platform's native Tauri dependencies, and at least one supported agent CLI. Sign in to the CLI before using it.

```sh
git clone https://github.com/haoyw7/OmniCode.git
cd OmniCode
npm ci
npm run tauri dev
```

Windows requires Visual Studio C++ Build Tools and WebView2. Linux dependency scripts are available at `scripts/install-linux-deps-*.sh`. The desktop app starts the shared Host automatically.

## Android APK builds and publication

APK build, delivery, and publication requests default to Release builds signed with
the same OmniCode release key first used on 2026-10-18 for version 0.1.0 (build 3).
The filename is always **`OmniCode.apk`**, without a version or other suffix, and the
app name remains **OmniCode**. Use debug signing only when explicitly requested.
If the release key is unavailable, stop signing and publication instead of generating
a replacement. See [mobile signing instructions](mobile/README.md#release-signing-key)
for key locations, the certificate fingerprint, and verification steps.

## More

[Mobile and Host setup](mobile/README.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

Licensed under [MIT](LICENSE). See [NOTICE](NOTICE) for third-party acknowledgments.

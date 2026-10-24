//! Unattended, user-requested CLI installation. The UI supplies only a provider
//! ID; executable names, installer URLs and arguments are owned here.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::harness::{exec_update_output, resolve_gui_binary, resolve_harness_binary};

static INSTALLING: AtomicBool = AtomicBool::new(false);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);

struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::Release);
    }
}

// Sources: each provider's official installation docs, checked 2026-10-19.
// OpenCode intentionally uses the V1 package that our adapter supports.
fn install_script(provider: &str, windows: bool) -> Result<String, String> {
    let npm_package = match provider {
        "codex" => Some("@openai/codex"),
        "opencode" => Some("opencode-ai"),
        "pi" => Some("@earendil-works/pi-coding-agent"),
        _ => None,
    };
    if let Some(package) = npm_package {
        let flags = if provider == "pi" {
            " --ignore-scripts"
        } else {
            ""
        };
        return Ok(if windows {
            format!(
                "$ErrorActionPreference = 'Stop'; if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {{ throw 'Install Node.js with npm, then retry.' }}; & npm.cmd install --global --no-audit --no-fund{flags} {package}; exit $LASTEXITCODE"
            )
        } else {
            // A per-user prefix avoids requesting sudo or changing npm config.
            format!(
                "command -v npm >/dev/null || {{ echo 'Install Node.js with npm, then retry.' >&2; exit 1; }}; npm install --global --prefix \"$HOME/.npm-global\" --no-audit --no-fund{flags} {package}"
            )
        });
    }
    let (url, args) = match (provider, windows) {
        ("claude", false) => ("https://claude.ai/install.sh", ""),
        ("claude", true) => ("https://claude.ai/install.ps1", ""),
        ("cursor", false) => ("https://cursor.com/install", ""),
        ("cursor", true) => ("https://cursor.com/install?win32=true", ""),
        ("grok", false) => ("https://x.ai/cli/install.sh", ""),
        ("grok", true) => ("https://x.ai/cli/install.ps1", ""),
        ("omp", false) => ("https://omp.sh/install", "--binary"),
        ("omp", true) => ("https://omp.sh/install.ps1", "-Binary"),
        ("fx", false) => ("https://fx.sh/setup.sh", ""),
        ("kimicode", false) => ("https://code.kimi.com/kimi-code/install.sh", ""),
        ("kimicode", true) => ("https://code.kimi.com/kimi-code/install.ps1", ""),
        ("hermes", false) => (
            "https://hermes-agent.nousresearch.com/install.sh",
            "--non-interactive",
        ),
        ("hermes", true) => (
            "https://hermes-agent.nousresearch.com/install.ps1",
            "-NonInteractive",
        ),
        _ => {
            return Err(
                "Automatic installation is not available for this agent on this platform.".into(),
            )
        }
    };
    Ok(if windows {
        format!(
            "$ErrorActionPreference = 'Stop'; & ([scriptblock]::Create((Invoke-RestMethod -Uri '{url}'))) {args}"
        )
    } else {
        // pipefail propagates download failures, including an empty response.
        format!("curl --fail --silent --show-error --location '{url}' | bash -s -- {args}")
    })
}

fn install(provider: &str) -> Result<(), String> {
    let script = install_script(provider, cfg!(windows))?;
    // A second window or a stale availability probe must not reinstall a CLI.
    if resolve_harness_binary(provider, None).is_ok() {
        return Ok(());
    }
    if matches!(provider, "codex" | "opencode" | "pi") && resolve_gui_binary("npm").is_none() {
        return Err("Install Node.js with npm, then retry.".into());
    }
    let (command, args) = if cfg!(windows) {
        (
            "powershell.exe",
            vec!["-NoProfile", "-NonInteractive", "-Command", &script],
        )
    } else {
        ("bash", vec!["-o", "pipefail", "-c", &script])
    };
    let args: Vec<String> = args.into_iter().map(String::from).collect();
    let output = exec_update_output(command, &args, INSTALL_TIMEOUT)?;
    if output.status.success() {
        return Ok(());
    }
    // Preserve provider diagnostics, with a bound so a failed installer cannot
    // flood the settings row. Prefer stderr but retain stdout-only failures.
    let bytes = if output.stderr.is_empty() {
        &output.stdout
    } else {
        &output.stderr
    };
    let text = String::from_utf8_lossy(bytes);
    let tail: String = text
        .chars()
        .rev()
        .take(4000)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    Err(if tail.trim().is_empty() {
        "CLI installation failed.".into()
    } else {
        tail.trim().to_string()
    })
}

#[tauri::command]
pub async fn harness_install(provider: String) -> Result<(), String> {
    // Serialize across windows, including different npm-based providers.
    INSTALLING
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .map_err(|_| "Another CLI installation is already running.".to_string())?;
    let guard = InstallGuard;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        install(&provider)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_providers_and_unsupported_platforms() {
        for provider in ["codex; echo injected", "../cursor", "antigravity", ""] {
            assert!(install_script(provider, true).is_err());
            assert!(install_script(provider, false).is_err());
        }
        assert!(install_script("fx", true).is_err());
    }

    #[test]
    fn supports_native_windows_and_posix_without_interactive_setup() {
        for provider in [
            "claude", "codex", "cursor", "grok", "opencode", "pi", "omp", "hermes", "kimicode",
        ] {
            assert!(!install_script(provider, true).unwrap().is_empty());
            assert!(!install_script(provider, false).unwrap().is_empty());
        }
        assert!(install_script("hermes", true)
            .unwrap()
            .contains("-NonInteractive"));
        assert!(install_script("hermes", false)
            .unwrap()
            .contains("--non-interactive"));
        assert!(install_script("cursor", true)
            .unwrap()
            .contains("?win32=true"));
        assert!(install_script("pi", true)
            .unwrap()
            .contains("--ignore-scripts"));
        assert!(install_script("opencode", false)
            .unwrap()
            .contains("opencode-ai"));
        assert!(install_script("codex", false)
            .unwrap()
            .contains("--prefix \"$HOME/.npm-global\""));
    }
}

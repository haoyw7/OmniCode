//! Unattended, user-requested CLI installation and removal. The UI supplies only
//! a provider ID (and its saved CLI path); executable names, installer URLs,
//! arguments and the files a removal may touch are owned here.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;

use crate::harness::{exec_update_output, resolve_gui_binary, resolve_harness_binary};
use crate::harness_updates::npm::Installation;
use crate::harness_updates::{install_source, InstallSource};

static INSTALLING: AtomicBool = AtomicBool::new(false);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const UNINSTALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::Release);
    }
}

// Sources: each provider's official installation docs, checked 2026-10-19.
// OpenCode intentionally uses the V1 package that our adapter supports.
enum InstallSpec {
    Npm {
        package: &'static str,
        flags: &'static str,
    },
    Script {
        url: &'static str,
        args: &'static str,
    },
}

fn install_spec(provider: &str, windows: bool) -> Result<InstallSpec, String> {
    let npm_package = match provider {
        "deepseek" => Some("@deepseek-ai/dsh@0.2.1-rc.2"),
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
        return Ok(InstallSpec::Npm { package, flags });
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
    Ok(InstallSpec::Script { url, args })
}

fn install_script(provider: &str, windows: bool) -> Result<String, String> {
    Ok(match install_spec(provider, windows)? {
        InstallSpec::Npm { package, flags } if windows => format!(
            "$ErrorActionPreference = 'Stop'; if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {{ throw 'Install Node.js with npm, then retry.' }}; & npm.cmd install --global --no-audit --no-fund{flags} {package}; exit $LASTEXITCODE"
        ),
        // A per-user prefix avoids requesting sudo or changing npm config.
        InstallSpec::Npm { package, flags } => format!(
            "command -v npm >/dev/null || {{ echo 'Install Node.js with npm, then retry.' >&2; exit 1; }}; npm install --global --prefix \"$HOME/.npm-global\" --no-audit --no-fund{flags} {package}"
        ),
        InstallSpec::Script { url, args } if windows => format!(
            "$ErrorActionPreference = 'Stop'; & ([scriptblock]::Create((Invoke-RestMethod -Uri '{url}'))) {args}"
        ),
        // pipefail propagates download failures, including an empty response.
        InstallSpec::Script { url, args } => {
            format!("curl --fail --silent --show-error --location '{url}' | bash -s -- {args}")
        }
    })
}

/// The command a person would type for the same installation, for review
/// before OmniCode runs the unattended script above.
fn install_command(provider: &str, windows: bool) -> Result<String, String> {
    let command = match install_spec(provider, windows)? {
        InstallSpec::Npm { package, flags } if windows => {
            format!("npm install -g{flags} {package}")
        }
        InstallSpec::Npm { package, flags } => {
            format!("npm install -g --prefix ~/.npm-global{flags} {package}")
        }
        InstallSpec::Script { url, args } if windows => {
            format!("& ([scriptblock]::Create((irm '{url}'))) {args}")
        }
        InstallSpec::Script { url, args: "" } => {
            format!("curl -fsSL {url} | bash")
        }
        InstallSpec::Script { url, args } => format!("curl -fsSL {url} | bash -s -- {args}"),
    };
    Ok(command.trim_end().to_string())
}

fn failure_tail(output: &std::process::Output, fallback: &str) -> String {
    // Preserve provider diagnostics, with a bound so a failed command cannot
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
    if tail.trim().is_empty() {
        fallback.into()
    } else {
        tail.trim().to_string()
    }
}

fn install(provider: &str) -> Result<(), String> {
    let script = install_script(provider, cfg!(windows))?;
    // A second window or a stale availability probe must not reinstall a CLI.
    if resolve_harness_binary(provider, None).is_ok() {
        return Ok(());
    }
    if matches!(provider, "codex" | "opencode" | "pi" | "deepseek")
        && resolve_gui_binary("npm").is_none()
    {
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
    Err(failure_tail(&output, "CLI installation failed."))
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

/// Packages whose global npm installation OmniCode may remove, whoever ran
/// the install. Names match the installed `package.json`, without versions.
fn npm_package_name(provider: &str) -> Option<&'static str> {
    match provider {
        "claude" => Some("@anthropic-ai/claude-code"),
        "codex" => Some("@openai/codex"),
        "deepseek" => Some("@deepseek-ai/dsh"),
        "opencode" => Some("opencode-ai"),
        "pi" => Some("@earendil-works/pi-coding-agent"),
        _ => None,
    }
}

/// Official native installers that keep versions in `~/.local/share/<dir>`
/// and put launchers in `~/.local/bin`.
fn native_data_dir(provider: &str) -> Option<&'static str> {
    match provider {
        "claude" => Some("claude"),
        "cursor" => Some("cursor-agent"),
        _ => None,
    }
}

enum Removal {
    Npm {
        npm_prefix: PathBuf,
        package: String,
        root: PathBuf,
    },
    Native {
        launchers: Vec<PathBuf>,
        data_dir: PathBuf,
    },
}

fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn native_removal(
    provider: &str,
    launcher: &Path,
    real: &Path,
    home: &Path,
    windows: bool,
) -> Option<Removal> {
    let bin = home.join(".local/bin");
    let data_dir = home.join(".local/share").join(native_data_dir(provider)?);
    if !data_dir.is_dir() || canonical(launcher.parent()?) != canonical(&bin) {
        return None;
    }
    let data_real = canonical(&data_dir);
    let linked = real.starts_with(&data_real);
    // The Windows Claude installer copies its executable instead of linking.
    let copied = windows && provider == "claude" && real == canonical(launcher);
    if !linked && !copied {
        return None;
    }
    let mut launchers = vec![launcher.to_path_buf()];
    // Cursor links both `cursor-agent` and `agent` to the same version.
    for entry in std::fs::read_dir(&bin).ok()?.flatten() {
        let path = entry.path();
        let is_link = entry.file_type().is_ok_and(|kind| kind.is_symlink());
        if is_link && !launchers.contains(&path) && canonical(&path).starts_with(&data_real) {
            launchers.push(path);
        }
    }
    Some(Removal::Native {
        launchers,
        data_dir,
    })
}

/// Decides what removing the CLI OmniCode runs would delete. `Err` explains
/// why OmniCode leaves a found installation to its own tools.
fn plan_removal(provider: &str, launcher: &Path) -> Result<Removal, String> {
    let real = canonical(launcher);
    let (source, _) = install_source(&real);
    if source == InstallSource::Bundled {
        return Err("This CLI is bundled with another app and is removed with that app.".into());
    }
    if let Some(package) = npm_package_name(provider) {
        if let Some(installation) = Installation::find(launcher, package)? {
            let (npm_prefix, package) = installation
                .uninstall_target()
                .ok_or("Cannot locate the npm installation prefix.")?;
            return Ok(Removal::Npm {
                npm_prefix,
                package,
                root: installation.root().to_path_buf(),
            });
        }
    }
    let home = crate::fs::expand_home("~");
    if let Some(removal) = native_removal(provider, launcher, &real, &home, cfg!(windows)) {
        return Ok(removal);
    }
    Err(if source == InstallSource::Homebrew {
        "This CLI was installed with Homebrew. Remove it with brew uninstall.".into()
    } else {
        "OmniCode can remove only CLIs installed with npm or the official installer. Remove this copy manually.".into()
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessCliPlan {
    install_command: Option<String>,
    path: Option<String>,
    removes: Vec<String>,
    uninstall_command: Option<String>,
    uninstall_blocker: Option<String>,
}

fn cli_plan(provider: &str, binary_path: Option<&str>) -> HarnessCliPlan {
    let mut plan = HarnessCliPlan {
        install_command: install_command(provider, cfg!(windows)).ok(),
        path: None,
        removes: Vec::new(),
        uninstall_command: None,
        uninstall_blocker: None,
    };
    let Ok(launcher) = resolve_harness_binary(provider, binary_path) else {
        return plan;
    };
    plan.path = Some(launcher.to_string_lossy().into_owned());
    match plan_removal(provider, &launcher) {
        Ok(Removal::Npm {
            npm_prefix,
            package,
            root,
        }) => {
            plan.uninstall_command = Some(format!(
                "npm uninstall -g --prefix \"{}\" {package}",
                npm_prefix.display()
            ));
            plan.removes = vec![root.to_string_lossy().into_owned()];
        }
        Ok(Removal::Native {
            launchers,
            data_dir,
        }) => {
            plan.removes = launchers
                .iter()
                .chain(std::iter::once(&data_dir))
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
        }
        Err(reason) => plan.uninstall_blocker = Some(reason),
    }
    plan
}

fn uninstall(provider: &str, binary_path: Option<&str>) -> Result<(), String> {
    let launcher = resolve_harness_binary(provider, binary_path)?;
    match plan_removal(provider, &launcher)? {
        Removal::Npm {
            npm_prefix,
            package,
            root,
        } => {
            let npm = resolve_gui_binary("npm").ok_or("Install Node.js with npm, then retry.")?;
            let args: Vec<String> = [
                "uninstall",
                "--global",
                "--no-audit",
                "--no-fund",
                "--prefix",
            ]
            .into_iter()
            .map(String::from)
            .chain([npm_prefix.to_string_lossy().into_owned(), package])
            .collect();
            let output = exec_update_output(&npm.to_string_lossy(), &args, UNINSTALL_TIMEOUT)?;
            if !output.status.success() {
                return Err(failure_tail(&output, "CLI removal failed."));
            }
            if root.exists() {
                return Err("npm finished, but the CLI package is still installed.".into());
            }
        }
        Removal::Native {
            launchers,
            data_dir,
        } => {
            for path in launchers {
                if let Err(error) = std::fs::remove_file(&path) {
                    if error.kind() != std::io::ErrorKind::NotFound {
                        return Err(format!("Could not remove {}: {error}", path.display()));
                    }
                }
            }
            std::fs::remove_dir_all(&data_dir)
                .map_err(|error| format!("Could not remove {}: {error}", data_dir.display()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn harness_cli_plan(
    provider: String,
    binary_path: Option<String>,
) -> Result<HarnessCliPlan, String> {
    tauri::async_runtime::spawn_blocking(move || cli_plan(&provider, binary_path.as_deref()))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn harness_uninstall(
    provider: String,
    binary_path: Option<String>,
) -> Result<(), String> {
    INSTALLING
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .map_err(|_| "Another CLI installation or removal is already running.".to_string())?;
    let guard = InstallGuard;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        uninstall(&provider, binary_path.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home() -> PathBuf {
        std::env::temp_dir().join(format!("omnicode-uninstall-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn install_command_matches_the_unattended_installer() {
        assert_eq!(
            install_command("codex", false).unwrap(),
            "npm install -g --prefix ~/.npm-global @openai/codex"
        );
        assert_eq!(
            install_command("claude", false).unwrap(),
            "curl -fsSL https://claude.ai/install.sh | bash"
        );
        assert_eq!(
            install_command("omp", true).unwrap(),
            "& ([scriptblock]::Create((irm 'https://omp.sh/install.ps1'))) -Binary"
        );
        assert!(install_command("antigravity", false).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn native_removal_covers_only_links_into_the_installer_directory() {
        use std::os::unix::fs::symlink;
        let home = temp_home();
        let bin = home.join(".local/bin");
        let version = home.join(".local/share/cursor-agent/versions/1/cursor-agent");
        std::fs::create_dir_all(version.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(&version, "").unwrap();
        symlink(&version, bin.join("cursor-agent")).unwrap();
        symlink(&version, bin.join("agent")).unwrap();
        std::fs::write(bin.join("unrelated"), "").unwrap();
        let launcher = bin.join("cursor-agent");
        let Some(Removal::Native {
            mut launchers,
            data_dir,
        }) = native_removal("cursor", &launcher, &canonical(&launcher), &home, false)
        else {
            panic!("expected a native removal");
        };
        launchers.sort();
        assert_eq!(launchers, vec![bin.join("agent"), bin.join("cursor-agent")]);
        assert_eq!(data_dir, home.join(".local/share/cursor-agent"));
        // A launcher elsewhere is never attributed to the native installer.
        let other = home.join("elsewhere/cursor-agent");
        std::fs::create_dir_all(other.parent().unwrap()).unwrap();
        std::fs::write(&other, "").unwrap();
        assert!(native_removal("cursor", &other, &canonical(&other), &home, false).is_none());
        assert!(native_removal("grok", &launcher, &canonical(&launcher), &home, false).is_none());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn copied_windows_claude_launcher_is_removed_with_its_versions() {
        let home = temp_home();
        let launcher = home.join(".local/bin/claude.exe");
        std::fs::create_dir_all(home.join(".local/share/claude/versions")).unwrap();
        std::fs::create_dir_all(launcher.parent().unwrap()).unwrap();
        std::fs::write(&launcher, "").unwrap();
        let real = canonical(&launcher);
        assert!(native_removal("claude", &launcher, &real, &home, false).is_none());
        assert!(matches!(
            native_removal("claude", &launcher, &real, &home, true),
            Some(Removal::Native { launchers, .. }) if launchers == vec![launcher.clone()]
        ));
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn rejects_unknown_providers_and_unsupported_platforms() {
        for provider in ["codex; echo injected", "../cursor", "antigravity", ""] {
            assert!(install_script(provider, true).is_err());
            assert!(install_script(provider, false).is_err());
        }
        assert!(install_script("fx", true).is_err());
    }

    #[test]
    fn deepseek_pins_the_verified_bridge_runtime() {
        for windows in [true, false] {
            assert!(install_script("deepseek", windows)
                .unwrap()
                .contains("@deepseek-ai/dsh@0.2.1-rc.2"));
        }
    }

    #[test]
    fn supports_native_windows_and_posix_without_interactive_setup() {
        for provider in [
            "claude", "codex", "cursor", "grok", "opencode", "pi", "omp", "hermes",
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

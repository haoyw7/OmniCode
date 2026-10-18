use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::harness::{
    binaries_on_search_path, desktop_cli_owner, exec_output, exec_update_output,
    is_resolved_harness_binary, resolve_harness_binary,
};

mod npm;

const REGISTRY_URL: &str = "https://registry.npmjs.org";
const USER_AGENT: &str = "MonoCode";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

/// Only harnesses whose releases are published to npm. The rest ship through
/// their own installers with no public version feed to compare against.
fn npm_package(provider: &str) -> Option<&'static str> {
    match provider {
        "claude" => Some("@anthropic-ai/claude-code"),
        "codex" => Some("@openai/codex"),
        "opencode" => Some("opencode-ai"),
        "pi" => Some("@earendil-works/pi-coding-agent"),
        _ => None,
    }
}

/// Each CLI's own updater, which knows how it was installed (native, npm,
/// Homebrew) better than MonoCode could guess from the binary path.
fn update_args(provider: &str) -> Option<&'static [&'static str]> {
    match provider {
        "claude" => Some(&["update"]),
        "codex" => Some(&["update"]),
        "opencode" => Some(&["upgrade"]),
        "pi" => Some(&["update", "--self"]),
        _ => None,
    }
}

/// Where a CLI binary came from, judged by where its symlinks finally lead.
/// `Bundled` copies ship inside another app (the ChatGPT desktop app links
/// its Codex into `~/.local/bin`) and only update with that app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallSource {
    Npm,
    Homebrew,
    Bundled,
    Other,
}

fn install_source(real: &Path) -> (InstallSource, Option<String>) {
    if let Some(owner) = desktop_cli_owner(real) {
        return (InstallSource::Bundled, Some(owner.to_string()));
    }
    let normalized = real.to_string_lossy().replace('\\', "/");
    let lower = normalized.to_lowercase();
    if lower.contains("/node_modules/") {
        return (InstallSource::Npm, None);
    }
    if ["/cellar/", "/homebrew/", "/linuxbrew/"]
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return (InstallSource::Homebrew, None);
    }
    let segments: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    if let Some(app) = segments
        .iter()
        .find(|segment| segment.to_lowercase().ends_with(".app"))
    {
        return (
            InstallSource::Bundled,
            Some(app_name(&app[..app.len() - 4])),
        );
    }
    if let Some(index) = segments
        .iter()
        .position(|segment| segment.eq_ignore_ascii_case("resources"))
    {
        // Electron apps keep their payload in `<app>/resources` or, on
        // Windows, `<app>/app/resources`.
        let owner = segments[..index]
            .iter()
            .rev()
            .find(|segment| !segment.eq_ignore_ascii_case("app"));
        if let Some(owner) = owner {
            return (InstallSource::Bundled, Some(app_name(owner)));
        }
    }
    (InstallSource::Other, None)
}

fn app_name(raw: &str) -> String {
    match raw.to_lowercase().as_str() {
        "chatgpt" => "ChatGPT".to_string(),
        "codex" => "Codex".to_string(),
        "claude" => "Claude".to_string(),
        _ => raw.to_string(),
    }
}

#[derive(Serialize)]
pub struct HarnessCopy {
    path: String,
    version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessInstall {
    path: String,
    real_path: String,
    source: InstallSource,
    bundled_by: Option<String>,
    /// Other installed copies on the search path that MonoCode could run
    /// instead, bundled ones excluded.
    alternatives: Vec<HarnessCopy>,
}

const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

fn copy_version(path: &Path) -> Option<String> {
    let output = exec_output(
        &path.to_string_lossy(),
        &["--version".to_string()],
        None,
        VERSION_TIMEOUT,
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    semver_in(&text)
}

fn semver_in(text: &str) -> Option<String> {
    text.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|token| {
            let parts: Vec<&str> = token.split('.').collect();
            parts.len() >= 3 && parts[..3].iter().all(|part| !part.is_empty())
        })
        .map(|token| token.split('.').take(3).collect::<Vec<_>>().join("."))
}

fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[tauri::command]
pub async fn harness_install_info(
    provider: String,
    binary_path: Option<String>,
) -> Result<HarnessInstall, String> {
    if npm_package(&provider).is_none() {
        return Err(format!("No update feed for harness: {provider}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_harness_binary(&provider, binary_path.as_deref())?;
        let real = canonical(&path);
        let (mut source, bundled_by) = install_source(&real);
        if npm::Installation::find(&path, npm_package(&provider).unwrap())?.is_some() {
            source = InstallSource::Npm;
        }
        let mut seen = HashSet::from([real.clone()]);
        let alternatives = binaries_on_search_path(&provider)
            .into_iter()
            .filter(|candidate| {
                let candidate_real = canonical(candidate);
                seen.insert(candidate_real.clone())
                    && install_source(&candidate_real).0 != InstallSource::Bundled
            })
            .filter_map(|candidate| {
                Some(HarnessCopy {
                    version: copy_version(&candidate)?,
                    path: candidate.to_string_lossy().into_owned(),
                })
            })
            .collect();
        Ok(HarnessInstall {
            path: path.to_string_lossy().into_owned(),
            real_path: real.to_string_lossy().into_owned(),
            source,
            bundled_by,
            alternatives,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A download plus, for npm installs, a full dependency install.
const UPDATE_TIMEOUT: Duration = Duration::from_secs(300);

static LAUNCH_CHECK_CLAIMED: AtomicBool = AtomicBool::new(false);

/// True for the first caller per app process, so a window opened later in the
/// same run does not repeat the launch check.
#[tauri::command]
pub fn harness_update_check_claim() -> bool {
    !LAUNCH_CHECK_CLAIMED.swap(true, Ordering::SeqCst)
}

#[tauri::command]
pub async fn harness_latest_version(provider: String) -> Result<String, String> {
    let package =
        npm_package(&provider).ok_or_else(|| format!("No update feed for harness: {provider}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
        let text = agent
            .get(&format!("{REGISTRY_URL}/{package}/latest"))
            .set("User-Agent", USER_AGENT)
            .set("Accept", "application/json")
            .call()
            .map_err(|error| format!("npm registry request failed: {error}"))?
            .into_string()
            .map_err(|error| format!("npm registry response unreadable: {error}"))?;
        let body: Value = serde_json::from_str(&text)
            .map_err(|error| format!("npm registry returned invalid JSON: {error}"))?;
        latest_version(&body).ok_or_else(|| "npm registry returned no version".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Runs the harness's self-update against the binary MonoCode resolved for
/// it. stdin is closed, so an updater that stops to ask fails instead of
/// hanging.
#[tauri::command]
pub async fn harness_update(
    command: String,
    binary_provider: String,
    binary_path: Option<String>,
) -> Result<(), String> {
    let args: Vec<String> = update_args(&binary_provider)
        .ok_or_else(|| format!("No updater for harness: {binary_provider}"))?
        .iter()
        .map(|arg| arg.to_string())
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        if !is_resolved_harness_binary(&command, Some(&binary_provider), binary_path.as_deref()) {
            return Err("harness_update: not a resolved harness CLI".to_string());
        }
        let real = canonical(Path::new(&command));
        if let (InstallSource::Bundled, owner) = install_source(&real) {
            let owner = owner.unwrap_or_else(|| "another app".to_string());
            return Err(format!(
                "This CLI is bundled with {owner} ({}) and only updates with that app.",
                real.display()
            ));
        }
        let update = || {
            let output = exec_update_output(&command, &args, UPDATE_TIMEOUT)?;
            if output.status.success() {
                Ok(())
            } else {
                Err(update_failure(&output.stdout, &output.stderr))
            }
        };
        let verify = || {
            copy_version(Path::new(&command))
                .ok_or_else(|| "Updated CLI failed its --version check".to_string())
        };
        if let Some(installation) =
            npm::Installation::find(Path::new(&command), npm_package(&binary_provider).unwrap())?
        {
            return installation.update(update, verify);
        }
        if install_source(&real).0 == InstallSource::Npm {
            return Err("Cannot safely back up this npm installation".into());
        }
        update()?;
        verify().map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Updaters print their reason to either stream; the last line is the one
/// that says what went wrong.
fn update_failure(stdout: &[u8], stderr: &[u8]) -> String {
    [stderr, stdout]
        .iter()
        .filter_map(|bytes| {
            String::from_utf8_lossy(bytes)
                .lines()
                .map(str::trim)
                .rfind(|line| !line.is_empty())
                .map(str::to_string)
        })
        .next()
        .unwrap_or_else(|| "Update failed".to_string())
}

fn latest_version(body: &Value) -> Option<String> {
    let version = body.get("version")?.as_str()?.trim();
    (!version.is_empty()).then(|| version.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_only_npm_published_harnesses() {
        assert_eq!(npm_package("claude"), Some("@anthropic-ai/claude-code"));
        assert_eq!(npm_package("pi"), Some("@earendil-works/pi-coding-agent"));
        assert_eq!(npm_package("cursor"), None);
        assert_eq!(npm_package("../../evil"), None);
    }

    #[test]
    fn classifies_install_sources_by_real_path() {
        let source = |path: &str| install_source(Path::new(path));
        for (path, owner) in [
            (
                r"C:\Users\u\AppData\Local\OpenAI\Codex\bin\hash\codex.exe",
                "Codex",
            ),
            (
                r"C:\Users\u\AppData\Local\Packages\Claude_publisher\LocalCache\Roaming\Claude\claude-code\2.1.100\hash\claude.exe",
                "Claude",
            ),
        ] {
            assert_eq!(
                source(path),
                (InstallSource::Bundled, Some(owner.to_string()))
            );
        }
        assert_eq!(
            source("/usr/lib/chatgpt/resources/codex"),
            (InstallSource::Bundled, Some("ChatGPT".to_string()))
        );
        assert_eq!(
            source("/Applications/Codex.app/Contents/Resources/codex"),
            (InstallSource::Bundled, Some("Codex".to_string()))
        );
        assert_eq!(
            source(r"C:\Program Files\ChatGPT\app\resources\codex.exe"),
            (InstallSource::Bundled, Some("ChatGPT".to_string()))
        );
        assert_eq!(
            source("/home/u/.nvm/versions/node/v24/lib/node_modules/@openai/codex/bin/codex.js").0,
            InstallSource::Npm
        );
        assert_eq!(
            source("/opt/homebrew/Cellar/codex/0.1.0/bin/codex").0,
            InstallSource::Homebrew
        );
        assert_eq!(
            source("/home/u/.local/share/claude/versions/2.1.0").0,
            InstallSource::Other
        );
    }

    #[test]
    fn reads_the_version_a_cli_prints() {
        assert_eq!(
            semver_in("codex-cli 0.161.0\n"),
            Some("0.161.0".to_string())
        );
        assert_eq!(semver_in("2.1.4 (Claude Code)"), Some("2.1.4".to_string()));
        assert_eq!(semver_in("no version"), None);
    }

    #[test]
    fn updates_only_through_each_cli_own_updater() {
        assert_eq!(update_args("pi"), Some(&["update", "--self"][..]));
        assert_eq!(update_args("opencode"), Some(&["upgrade"][..]));
        assert_eq!(update_args("cursor"), None);
    }

    #[test]
    fn reports_the_last_line_an_updater_printed() {
        assert_eq!(
            update_failure(
                b"checking\n",
                b"npm ERR! code EACCES\nnpm ERR! permission denied\n\n"
            ),
            "npm ERR! permission denied"
        );
        assert_eq!(update_failure(b"no write access\n", b""), "no write access");
        assert_eq!(update_failure(b"", b""), "Update failed");
    }

    #[test]
    fn reads_version_from_registry_payload() {
        assert_eq!(
            latest_version(&json!({ "name": "opencode-ai", "version": "1.18.33" })),
            Some("1.18.33".to_string())
        );
        assert_eq!(latest_version(&json!({ "version": " " })), None);
        assert_eq!(latest_version(&json!({})), None);
    }

    #[cfg(unix)]
    #[test]
    fn timed_out_updater_cannot_write_after_rollback_starts() {
        let marker =
            std::env::temp_dir().join(format!("monocode-update-timeout-{}", uuid::Uuid::new_v4()));
        let error = exec_update_output(
            "/bin/sh",
            &[
                "-c".into(),
                "(sleep 0.2; printf late > \"$1\") & wait".into(),
                "update-test".into(),
                marker.to_string_lossy().into_owned(),
            ],
            Duration::from_millis(50),
        )
        .unwrap_err();
        assert!(error.contains("timed out"));
        std::thread::sleep(Duration::from_millis(250));
        assert!(!marker.exists());
    }
}

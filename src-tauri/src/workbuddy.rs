//! Runs the same credential-isolating bridge as the desktop Host.
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};

const SOURCE: &str =
    include_str!("../../src/integrations/harness/providers/workbuddy/workbuddyRuntime.cjs");

fn application_data() -> Result<PathBuf, String> {
    if cfg!(windows) {
        return std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|home| PathBuf::from(home).join("AppData/Local"))
            })
            .ok_or_else(|| "Windows application data directory is unavailable".into());
    }
    if cfg!(target_os = "macos") {
        return std::env::var_os("HOME")
            .map(|home| PathBuf::from(home).join("Library/Application Support"))
            .ok_or_else(|| "macOS application data directory is unavailable".into());
    }
    Err("WorkBuddy integration requires Windows or macOS".into())
}

fn root() -> Result<PathBuf, String> {
    Ok(application_data()?.join("OmniCode/workbuddy"))
}

pub(crate) fn resolve(binary_path: Option<&str>) -> Result<PathBuf, String> {
    let local = application_data()?;
    let mut candidates = Vec::new();
    if let Some(path) = binary_path {
        candidates.push(PathBuf::from(path));
    }
    if binary_path.is_none() {
        if cfg!(target_os = "macos") {
            let home_apps = local
                .parent()
                .and_then(Path::parent)
                .ok_or("Invalid WorkBuddy data directory")?
                .join("Applications");
            for directory in [home_apps, PathBuf::from("/Applications")] {
                candidates.extend([
                    directory.join("WorkBuddy.app"),
                    directory.join("WorkBuddy AI.app"),
                ]);
            }
        } else {
            candidates.extend([
                local.join("Programs/WorkBuddy/WorkBuddy.exe"),
                local.join("Programs/WorkBuddyAI/WorkBuddyAI.exe"),
            ]);
        }
    }
    resolve_candidates(candidates, cfg!(target_os = "macos"))
}

fn resolve_candidates(candidates: Vec<PathBuf>, macos: bool) -> Result<PathBuf, String> {
    for candidate in candidates {
        let path = if macos && candidate.extension().is_some_and(|ext| ext == "app") {
            let Ok(entries) = std::fs::read_dir(candidate.join("Contents/MacOS")) else {
                continue;
            };
            let binaries: Vec<_> = entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|file| {
                    file.is_file()
                        && file
                            .file_name()
                            .is_some_and(|name| !name.to_string_lossy().starts_with('.'))
                })
                .collect();
            if binaries.len() != 1 {
                continue;
            }
            binaries[0].clone()
        } else {
            candidate
        };
        let Some(parent) = path.parent() else {
            continue;
        };
        let resources = if macos {
            let Some(contents) = parent.parent() else {
                continue;
            };
            contents.join("Resources")
        } else {
            parent.join("resources")
        };
        let cli = resources.join("app.asar.unpacked/cli");
        let Ok(bytes) = std::fs::read(cli.join("product.json")) else {
            continue;
        };
        let Ok(product) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        let pair = (
            product["endpoint"].as_str(),
            product["authentication"]["id"].as_str(),
        );
        if path.is_file()
            && cli.join("bin/codebuddy").is_file()
            && matches!(
                pair,
                (Some("https://www.workbuddy.cn"), Some("workbuddy-desktop"))
                    | (
                        Some("https://copilot.tencent.com"),
                        Some("workbuddy-desktop")
                    )
                    | (
                        Some("https://www.workbuddy.ai"),
                        Some("workbuddy-desktop-ai")
                    )
            )
        {
            return Ok(path);
        }
    }
    Err("WorkBuddy is not installed".into())
}

fn script() -> Result<PathBuf, String> {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    SOURCE.hash(&mut hash);
    let dir = root()?
        .join("bridge-code")
        .join(format!("{:x}", hash.finish()));
    std::fs::create_dir_all(&dir).map_err(|_| "Could not prepare WorkBuddy bridge")?;
    let file = dir.join("runtime.cjs");
    // This cache contains application code only, never credentials.
    if std::fs::read_to_string(&file).ok().as_deref() != Some(SOURCE) {
        std::fs::write(&file, SOURCE).map_err(|_| "Could not write WorkBuddy bridge")?;
    }
    Ok(file)
}

pub(crate) fn metadata(mode: &str, options: Value) -> Result<Value, String> {
    let executable = resolve(options["binaryPath"].as_str())?;
    let mut command = Command::new(executable);
    command
        .args([
            script()?.to_string_lossy().into_owned(),
            mode.to_string(),
            options.to_string(),
        ])
        .env("ELECTRON_RUN_AS_NODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::harness::isolate_child(&mut command);
    let child = omnicode_process_tree::spawn_managed(&mut command)
        .map_err(|_| "Could not start WorkBuddy bridge")?;
    let pid = child.id();
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(child.wait_with_output());
    });
    match receiver.recv_timeout(Duration::from_secs(if mode == "catalog" { 65 } else { 10 })) {
        Ok(Ok(output)) if output.status.success() => {
            serde_json::from_slice(&output.stdout).map_err(|_| "Invalid WorkBuddy metadata".into())
        }
        _ => {
            omnicode_process_tree::terminate_all(&[pid]);
            Err("WorkBuddy authentication or initialization failed. Refresh the login on the execution machine.".into())
        }
    }
}

pub(crate) fn launch(
    account_id: Option<&str>,
    binary_path: Option<&str>,
    args: &[String],
) -> Result<(PathBuf, Vec<String>), String> {
    let options =
        json!({ "accountId": account_id, "binaryPath": binary_path, "configRoot": root()? });
    let selected = metadata("resolve", options.clone())?;
    let executable = selected["path"]
        .as_str()
        .ok_or("WorkBuddy login is unavailable")?;
    let mut launch_args = vec![
        script()?.to_string_lossy().into_owned(),
        "run".into(),
        options.to_string(),
    ];
    launch_args.extend_from_slice(args);
    Ok((PathBuf::from(executable), launch_args))
}

#[tauri::command(async)]
pub fn harness_resolve_workbuddy() -> Result<crate::harness::CursorBinary, String> {
    Ok(crate::harness::CursorBinary {
        path: resolve(None)?.to_string_lossy().into_owned(),
    })
}

#[tauri::command(async)]
pub fn harness_workbuddy_accounts(binary_path: Option<String>) -> Result<Value, String> {
    if resolve(binary_path.as_deref()).is_err() {
        return Ok(json!([]));
    }
    metadata("accounts", json!({ "binaryPath": binary_path }))
}

#[tauri::command(async)]
pub fn harness_workbuddy_catalog(binary_path: Option<String>) -> Result<Value, String> {
    metadata(
        "catalog",
        json!({ "binaryPath": binary_path, "configRoot": root()? }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("omnicode-wb-resolve-{}", uuid::Uuid::new_v4())))
        }
        fn install(&self, macos: bool, international: bool) -> (PathBuf, PathBuf, PathBuf) {
            let bundle = self.0.join(if international {
                "WorkBuddy AI.app"
            } else {
                "WorkBuddy.app"
            });
            let executable = if macos {
                bundle.join("Contents/MacOS/WorkBuddy")
            } else {
                bundle.join("WorkBuddy.exe")
            };
            let resources = if macos {
                bundle.join("Contents/Resources")
            } else {
                bundle.join("resources")
            };
            let cli = resources.join("app.asar.unpacked/cli");
            std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
            std::fs::create_dir_all(cli.join("bin")).unwrap();
            std::fs::write(&executable, "").unwrap();
            std::fs::write(cli.join("bin/codebuddy"), "").unwrap();
            let product = if international {
                json!({ "endpoint": "https://www.workbuddy.ai", "authentication": { "id": "workbuddy-desktop-ai" } })
            } else {
                json!({ "endpoint": "https://www.workbuddy.cn", "authentication": { "id": "workbuddy-desktop" } })
            };
            std::fs::write(cli.join("product.json"), product.to_string()).unwrap();
            (bundle, executable, cli)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert!(self.0.starts_with(std::env::temp_dir()));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn discovers_both_platform_layouts_and_configured_mac_bundles() {
        for macos in [false, true] {
            for international in [false, true] {
                let fixture = Fixture::new();
                let (bundle, executable, _) = fixture.install(macos, international);
                assert_eq!(
                    resolve_candidates(vec![executable.clone()], macos).unwrap(),
                    executable
                );
                if macos {
                    assert_eq!(resolve_candidates(vec![bundle], true).unwrap(), executable);
                }
            }
        }
    }

    #[test]
    fn discovers_tencent_china_endpoint_without_accepting_international_auth() {
        for macos in [false, true] {
            let fixture = Fixture::new();
            let (bundle, executable, cli) = fixture.install(macos, false);
            std::fs::write(cli.join("product.json"), r#"{"endpoint":"https://copilot.tencent.com","authentication":{"id":"workbuddy-desktop"}}"#).unwrap();
            let candidate = if macos { bundle } else { executable.clone() };
            assert_eq!(
                resolve_candidates(vec![candidate.clone()], macos).unwrap(),
                executable
            );
            std::fs::write(cli.join("product.json"), r#"{"endpoint":"https://copilot.tencent.com","authentication":{"id":"workbuddy-desktop-ai"}}"#).unwrap();
            assert!(resolve_candidates(vec![candidate], macos).is_err());
        }
    }

    #[test]
    fn rejects_mismatched_regions_and_incomplete_bundles() {
        for macos in [false, true] {
            let fixture = Fixture::new();
            let (_, executable, cli) = fixture.install(macos, false);
            std::fs::write(cli.join("product.json"), r#"{"endpoint":"https://www.workbuddy.ai","authentication":{"id":"workbuddy-desktop"}}"#).unwrap();
            assert!(resolve_candidates(vec![executable.clone()], macos).is_err());
            fixture.install(macos, false);
            std::fs::remove_file(cli.join("bin/codebuddy")).unwrap();
            assert!(resolve_candidates(vec![executable], macos).is_err());
        }
    }
}

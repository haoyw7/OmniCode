//! Local profile metadata. Credential and history directories may be owned by
//! MonoCode or explicitly supplied by the user; external Homes are never deleted.
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfile {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_home: Option<String>,
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub resolved_data_home: Option<String>,
}

pub type Profiles = HashMap<String, Vec<ProviderProfile>>;

pub(crate) fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("provider-accounts"))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub(crate) fn read(dir: &Path) -> Result<Profiles, String> {
    match std::fs::read(dir.join("accounts.json")) {
        Ok(raw) => serde_json::from_slice(&raw)
            .map_err(|_| "Invalid provider account configuration".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn expand_home(value: &str) -> Result<PathBuf, String> {
    let value = value.trim();
    let path = if value == "~" || value.starts_with("~/") || value.starts_with("~\\") {
        PathBuf::from(crate::dirs_home().ok_or("Home directory is unavailable")?)
            .join(value.get(2..).unwrap_or(""))
    } else {
        PathBuf::from(value)
    };
    if !path.is_absolute() || value.contains('\0') {
        return Err("Data Home must be an absolute path or start with ~/".into());
    }
    Ok(path)
}

pub(crate) fn custom_home(dir: &Path, provider: &str, id: &str) -> Result<Option<PathBuf>, String> {
    read(dir)?
        .get(provider)
        .and_then(|entries| entries.iter().find(|entry| entry.id == id))
        .and_then(|entry| entry.data_home.as_deref())
        .map(expand_home)
        .transpose()
}

pub(crate) fn default_home(provider: &str) -> Result<PathBuf, String> {
    let (variable, leaf) = match provider {
        "codex" => ("CODEX_HOME", ".codex"),
        "claude" => ("CLAUDE_CONFIG_DIR", ".claude"),
        _ => return Err("Invalid provider account".into()),
    };
    std::env::var_os(variable)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| crate::dirs_home().map(|home| PathBuf::from(home).join(leaf)))
        .ok_or_else(|| "Home directory is unavailable".into())
}

pub(crate) fn named_home(dir: &Path, provider: &str, id: &str) -> Result<PathBuf, String> {
    if !matches!(provider, "codex" | "claude") || !valid_id(id) {
        return Err("Invalid provider account".into());
    }
    if let Some(home) = custom_home(dir, provider, id)? {
        return Ok(home);
    }
    if id == "default" {
        return default_home(provider);
    }
    Ok(dir.join(provider).join(id))
}

fn write(dir: &Path, profiles: &Profiles) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let temporary = dir.join(format!("accounts-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(
        &temporary,
        serde_json::to_vec(profiles).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, dir.join("accounts.json")).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        error.to_string()
    })
}

pub(crate) fn remove(dir: &Path, provider: &str, id: &str) -> Result<(), String> {
    let mut profiles = read(dir)?;
    if let Some(entries) = profiles.get_mut(provider) {
        entries.retain(|entry| entry.id != id);
    }
    // Retained old managed Homes must not resurrect a deliberately removed row.
    let removed = dir.join("removed").join(provider);
    std::fs::create_dir_all(&removed).map_err(|error| error.to_string())?;
    std::fs::write(removed.join(id), "").map_err(|error| error.to_string())?;
    write(dir, &profiles)
}

/** A built-in or custom profile may now reuse a managed profile's Home. */
pub(crate) fn managed_home_is_referenced(
    dir: &Path,
    provider: &str,
    id: &str,
) -> Result<bool, String> {
    let managed = dir.join(provider).join(id);
    let managed = std::fs::canonicalize(&managed).unwrap_or(managed);
    for (other_provider, entries) in list(dir)? {
        for entry in entries {
            if other_provider == provider && entry.id == id {
                continue;
            }
            if let Some(home) = entry.resolved_data_home {
                let home = PathBuf::from(home);
                let home = std::fs::canonicalize(&home).unwrap_or(home);
                if home.starts_with(&managed) {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

fn list(dir: &Path) -> Result<Profiles, String> {
    let mut profiles = read(dir)?;
    // Recover profiles whose login created a Home before browser metadata was
    // saved, as well as profiles retained after webview storage was cleared.
    for provider in ["claude", "codex"] {
        let entries = profiles.entry(provider.to_string()).or_default();
        if let Ok(dirs) = std::fs::read_dir(dir.join(provider)) {
            let mut recovered = dirs
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .filter_map(|entry| entry.file_name().into_string().ok())
                .filter(|id| {
                    valid_id(id)
                        && id != "default"
                        && !dir.join("removed").join(provider).join(id).is_file()
                })
                .collect::<Vec<_>>();
            recovered.sort();
            for id in recovered {
                if !entries.iter().any(|entry| entry.id == id) {
                    entries.push(ProviderProfile {
                        label: id.clone(),
                        id,
                        data_home: None,
                        resolved_data_home: None,
                    });
                }
            }
        }
        if !entries.iter().any(|entry| entry.id == "default") {
            entries.insert(
                0,
                ProviderProfile {
                    id: "default".into(),
                    label: "Default account".into(),
                    data_home: None,
                    resolved_data_home: None,
                },
            );
        }
    }
    for (provider, entries) in &mut profiles {
        for entry in entries {
            entry.resolved_data_home = Some(
                named_home(dir, provider, &entry.id)?
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }
    Ok(profiles)
}

fn publish(dir: &Path, mut profiles: Profiles) -> Result<(), String> {
    for (provider, entries) in &mut profiles {
        if !matches!(provider.as_str(), "claude" | "codex") {
            return Err("Invalid provider account".into());
        }
        let mut seen = std::collections::HashSet::new();
        for entry in entries {
            if !valid_id(&entry.id)
                || entry.label.trim().is_empty()
                || !seen.insert(entry.id.clone())
            {
                return Err("Invalid provider account".into());
            }
            entry.label = entry.label.trim().chars().take(80).collect();
            entry.data_home = entry
                .data_home
                .take()
                .filter(|home| !home.trim().is_empty());
            entry.resolved_data_home = None;
            if entry.id == "default" && entry.data_home.is_none() {
                continue;
            }
            let home = entry.data_home.as_deref().map(expand_home).transpose()?;
            let path = home.unwrap_or_else(|| dir.join(provider).join(&entry.id));
            std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
            if entry.data_home.is_some() {
                // Preserve the exact expanded spelling: Claude's secure storage
                // key is scoped to the config directory string, not its realpath.
                entry.data_home = Some(path.to_string_lossy().into_owned());
            }
        }
    }
    write(dir, &profiles)?;
    for (provider, entries) in &profiles {
        for entry in entries {
            let _ = std::fs::remove_file(dir.join("removed").join(provider).join(&entry.id));
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn provider_accounts_list(app: AppHandle) -> Result<Profiles, String> {
    let _guard = crate::provider_defaults::ACCOUNT_WRITE
        .lock()
        .map_err(|error| error.to_string())?;
    list(&directory(&app)?)
}

#[tauri::command(async)]
pub fn provider_accounts_publish(app: AppHandle, accounts: Profiles) -> Result<(), String> {
    let _guard = crate::provider_defaults::ACCOUNT_WRITE
        .lock()
        .map_err(|error| error.to_string())?;
    publish(&directory(&app)?, accounts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_survive_browser_storage_loss_and_keep_external_homes() {
        let root = std::env::temp_dir().join(format!("monocode-profiles-{}", uuid::Uuid::new_v4()));
        let dir = root.join("provider-accounts");
        let external = root.join("external home");
        let account = ProviderProfile {
            id: "work".into(),
            label: "Work".into(),
            data_home: Some(external.to_string_lossy().into_owned()),
            resolved_data_home: None,
        };
        publish(&dir, HashMap::from([("codex".into(), vec![account])])).unwrap();
        std::fs::write(external.join("auth.json"), "credentials").unwrap();
        std::fs::create_dir_all(dir.join("claude/recovered")).unwrap();
        let listed = list(&dir).unwrap();
        assert_eq!(
            listed["codex"]
                .iter()
                .find(|entry| entry.id == "work")
                .unwrap()
                .label,
            "Work"
        );
        assert_eq!(named_home(&dir, "codex", "work").unwrap(), external);
        assert!(listed["claude"].iter().any(|entry| entry.id == "recovered"));
        remove(&dir, "codex", "work").unwrap();
        assert_eq!(
            std::fs::read_to_string(external.join("auth.json")).unwrap(),
            "credentials"
        );
        assert!(!list(&dir).unwrap()["codex"]
            .iter()
            .any(|entry| entry.id == "work"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keeps_managed_credentials_when_the_builtin_profile_reuses_the_home() {
        let dir =
            std::env::temp_dir().join(format!("monocode-shared-home-{}", uuid::Uuid::new_v4()));
        let managed = dir.join("codex/work");
        std::fs::create_dir_all(&managed).unwrap();
        std::fs::write(managed.join("auth.json"), "keep").unwrap();
        let mut profiles = Profiles::from([(
            "codex".into(),
            vec![
                ProviderProfile {
                    id: "work".into(),
                    label: "Work".into(),
                    data_home: None,
                    resolved_data_home: None,
                },
                ProviderProfile {
                    id: "default".into(),
                    label: "Default account".into(),
                    data_home: Some(managed.to_string_lossy().into_owned()),
                    resolved_data_home: None,
                },
            ],
        )]);
        publish(&dir, profiles.clone()).unwrap();
        assert!(managed_home_is_referenced(&dir, "codex", "work").unwrap());
        remove(&dir, "codex", "work").unwrap();
        assert!(!list(&dir).unwrap()["codex"]
            .iter()
            .any(|entry| entry.id == "work"));
        assert_eq!(
            std::fs::read_to_string(managed.join("auth.json")).unwrap(),
            "keep"
        );
        profiles.get_mut("codex").unwrap()[1].data_home = None;
        publish(&dir, profiles).unwrap();
        assert!(!dir.join("removed/codex/work").exists());
        assert!(!managed_home_is_referenced(&dir, "codex", "work").unwrap());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn validates_and_updates_default_and_named_homes_without_deleting_old_data() {
        let dir = std::env::temp_dir().join(format!("monocode-profiles-{}", uuid::Uuid::new_v4()));
        let profile = |id: &str, home: Option<&str>| {
            HashMap::from([(
                "claude".into(),
                vec![ProviderProfile {
                    id: id.into(),
                    label: "Work".into(),
                    data_home: home.map(String::from),
                    resolved_data_home: None,
                }],
            )])
        };
        assert!(publish(&dir, profile("work", Some("relative"))).is_err());
        publish(&dir, profile("work", None)).unwrap();
        let old_home = dir.join("claude/work");
        std::fs::write(old_home.join("credentials"), "keep").unwrap();
        let custom = dir.join("custom").to_string_lossy().into_owned();
        publish(&dir, profile("work", Some(&custom))).unwrap();
        assert_eq!(
            named_home(&dir, "claude", "work").unwrap(),
            PathBuf::from(&custom)
        );
        assert_eq!(
            std::fs::read_to_string(old_home.join("credentials")).unwrap(),
            "keep"
        );
        publish(&dir, profile("default", Some(&custom))).unwrap();
        assert_eq!(
            named_home(&dir, "claude", "default").unwrap(),
            PathBuf::from(&custom)
        );
        let builtin = list(&dir).unwrap()["claude"]
            .iter()
            .find(|entry| entry.id == "default")
            .unwrap()
            .clone();
        assert_eq!(builtin.resolved_data_home, Some(custom));
        publish(&dir, profile("default", None)).unwrap();
        assert_eq!(
            named_home(&dir, "claude", "default").unwrap(),
            default_home("claude").unwrap()
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}

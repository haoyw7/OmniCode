//! Shared preferences are native data, not browser preferences. Account IDs in
//! existing sessions always remain concrete; only new sessions follow this map.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub(crate) static ACCOUNT_WRITE: Mutex<()> = Mutex::new(());
type Defaults = HashMap<String, String>;

fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("provider-accounts"))
}

pub(crate) fn read_defaults(dir: &Path) -> Result<Defaults, String> {
    let raw = match std::fs::read(dir.join("defaults.json")) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(error.to_string()),
    };
    let values: Defaults =
        serde_json::from_slice(&raw).map_err(|_| "Invalid shared account defaults".to_string())?;
    if values
        .iter()
        .any(|(provider, id)| !matches!(provider.as_str(), "codex" | "claude") || !valid_id(id))
    {
        return Err("Invalid shared account defaults".into());
    }
    Ok(values)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn set_default(dir: &Path, provider: &str, account_id: &str) -> Result<Defaults, String> {
    if !matches!(provider, "codex" | "claude") || !valid_id(account_id) {
        return Err("Invalid provider account".into());
    }
    let mut defaults = read_defaults(dir)?;
    if account_id == "default" {
        defaults.remove(provider);
    } else {
        let accounts: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dir.join("accounts.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let published = accounts
            .get(provider)
            .and_then(|v| v.as_array())
            .is_some_and(|entries| {
                entries
                    .iter()
                    .any(|v| v.get("id").and_then(|v| v.as_str()) == Some(account_id))
            });
        if !published || !crate::provider_profiles::named_home(dir, provider, account_id)?.is_dir()
        {
            return Err("This provider account is no longer available".into());
        }
        defaults.insert(provider.to_string(), account_id.to_string());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let temp = dir.join(format!("defaults-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(
        &temp,
        serde_json::to_vec(&defaults).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(&temp, dir.join("defaults.json")).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        e.to_string()
    })?;
    Ok(defaults)
}

#[tauri::command(async)]
pub fn provider_account_defaults(app: AppHandle) -> Result<Defaults, String> {
    read_defaults(&directory(&app)?)
}

#[tauri::command(async)]
pub fn provider_account_set_default(
    app: AppHandle,
    provider: String,
    account_id: String,
) -> Result<Defaults, String> {
    let _guard = ACCOUNT_WRITE.lock().map_err(|e| e.to_string())?;
    set_default(&directory(&app)?, &provider, &account_id)
}

pub(crate) fn ensure_removable(app: &AppHandle, provider: &str, id: &str) -> Result<(), String> {
    if read_defaults(&directory(app)?)?
        .get(provider)
        .is_some_and(|selected| selected == id)
    {
        return Err("Choose another shared default before removing this account".into());
    }
    Ok(())
}

// Copy an existing CLI sign-in into a new, private profile. Never copy histories
// or overwrite an existing profile. On failure, remove only our new destination.
fn import_codex(source: &Path, destination: &Path) -> Result<(), String> {
    let auth = std::fs::read(source.join("auth.json"))
        .map_err(|_| "The current Codex CLI profile has no readable auth.json".to_string())?;
    let parsed: serde_json::Value = serde_json::from_slice(&auth)
        .map_err(|_| "The current Codex CLI auth.json is invalid".to_string())?;
    if parsed
        .get("tokens")
        .and_then(|v| v.get("refresh_token"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .is_none()
        && parsed
            .get("OPENAI_API_KEY")
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty())
            .is_none()
    {
        return Err("Sign in to a named account to use this Codex credential store".into());
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    let mut builder = builder;
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(destination).map_err(|e| e.to_string())?;
    let copied = (|| {
        private_write(&destination.join("auth.json"), &auth)?;
        let mut config: toml::Table = match std::fs::read_to_string(source.join("config.toml")) {
            Ok(config) => toml::from_str(&config)
                .map_err(|_| "The current Codex config.toml is invalid".to_string())?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => toml::Table::new(),
            Err(e) => return Err(e.to_string()),
        };
        // This imported profile owns its auth.json; do not consult a source
        // profile's keychain or fall back to an unrelated credential store.
        config.insert(
            "cli_auth_credentials_store".into(),
            toml::Value::String("file".into()),
        );
        private_write(
            &destination.join("config.toml"),
            toml::to_string(&config)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        )?;
        Ok(())
    })();
    if copied.is_err() {
        let _ = std::fs::remove_dir_all(destination);
    }
    copied
}

fn private_write(path: &Path, data: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .and_then(|mut file| file.write_all(data))
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn provider_account_import_codex(app: AppHandle, account_id: String) -> Result<(), String> {
    let _guard = ACCOUNT_WRITE.lock().map_err(|e| e.to_string())?;
    let destination = crate::harness::provider_account_path(&app, "codex", &account_id)?;
    let source = crate::provider_profiles::named_home(&directory(&app)?, "codex", "default")?;
    import_codex(&source, &destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("monocode-defaults-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn validates_and_persists_shared_defaults() {
        let temp = Temp::new();
        let dir = temp.path();
        assert!(read_defaults(dir).unwrap().is_empty());
        std::fs::write(
            dir.join("accounts.json"),
            r#"{"codex":[{"id":"work","label":"Work"}],"claude":[{"id":"team","label":"Team"}]}"#,
        )
        .unwrap();
        assert!(set_default(dir, "codex", "work").is_err());
        std::fs::create_dir_all(dir.join("codex/work")).unwrap();
        std::fs::create_dir_all(dir.join("claude/team")).unwrap();
        set_default(dir, "codex", "work").unwrap();
        set_default(dir, "claude", "team").unwrap();
        assert_eq!(read_defaults(dir).unwrap().get("codex").unwrap(), "work");
        set_default(dir, "codex", "default").unwrap();
        assert_eq!(read_defaults(dir).unwrap().len(), 1);
        assert!(set_default(dir, "codex", "../bad").is_err());
        std::fs::write(dir.join("defaults.json"), "invalid").unwrap();
        assert!(read_defaults(dir).is_err());
        assert!(set_default(dir, "codex", "work").is_err());
    }
    #[test]
    fn imports_only_signin_files_and_never_overwrites() {
        let temp = Temp::new();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(
            source.join("auth.json"),
            r#"{"tokens":{"refresh_token":"fixture"}}"#,
        )
        .unwrap();
        std::fs::write(source.join("config.toml"), "model = 'fixture'").unwrap();
        std::fs::write(source.join("history.jsonl"), "private history").unwrap();
        import_codex(&source, &target).unwrap();
        assert!(target.join("auth.json").exists());
        assert!(target.join("config.toml").exists());
        assert!(!target.join("history.jsonl").exists());
        assert!(import_codex(&source, &target).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(target.join("auth.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        std::fs::remove_file(source.join("config.toml")).unwrap();
        std::fs::create_dir(source.join("config.toml")).unwrap();
        let partial = temp.path().join("partial");
        assert!(import_codex(&source, &partial).is_err());
        assert!(!partial.exists());
        assert!(target.exists());
    }
}

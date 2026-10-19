//! Application-owned DeepSeek bridge resources. No provider secrets cross this boundary.
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;

const VERSION: &str = "0.2.1-rc.2";
const PROFILE: &str = "omnicode-v1";
const SOURCE: &str =
    include_str!("../../src/integrations/harness/providers/deepseek/bridge/bridge.mjs");
static PREPARING: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct BridgeLaunch {
    path: String,
    args: Vec<String>,
}

pub(crate) fn prepare(path: &Path, cwd: &str) -> Result<BridgeLaunch, String> {
    let _guard = PREPARING.lock().map_err(|e| e.to_string())?;
    let output = crate::harness::exec_output(
        &path.to_string_lossy(),
        &["--version".into()],
        Some(cwd),
        Duration::from_secs(20),
    )?;
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() || version != VERSION {
        return Err(format!(
            "DeepSeek Harness bridge requires dsh {VERSION}; found {version}"
        ));
    }
    let base = std::env::var("DSH_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| crate::fs::expand_home(&value))
        .or_else(|| crate::dirs_home().map(|home| PathBuf::from(home).join(".dsh")))
        .ok_or("DeepSeek Harness home is unavailable")?;
    let base = if base.is_absolute() {
        base
    } else {
        Path::new(cwd).join(base)
    };
    let root = base.join("profiles").join(PROFILE);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let manifest = root.join("package.json");
    match std::fs::read(&manifest) {
        Ok(bytes) => {
            let value: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            if value["omnicodeBridge"] != 1 {
                return Err("DeepSeek Harness profile omnicode-v1 is not owned by OmniCode".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if std::fs::read_dir(&root)
                .map_err(|e| e.to_string())?
                .next()
                .is_some()
            {
                return Err("DeepSeek Harness profile omnicode-v1 is not owned by OmniCode".into());
            }
        }
        Err(error) => return Err(error.to_string()),
    }
    let package = json!({"name":"dsh-profile-omnicode-v1","private":true,"dependencies":{},"omnicodeBridge":1,
        "dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-acp-app"]}}});
    let patch = json!([
        {"id":"acp","disabled":true},{"id":"hmr","disabled":true},
        {"insert":[{"id":"omnicode-ask-user","name":"@deepseek-ai/dsh-tool-ask-user","config":{"mode":"timed","timeout":120}},
            {"id":"omnicode-auto-review","name":"@deepseek-ai/dsh-experimental-auto-review"},
            {"id":"omnicode-bridge","name":"./bridge.mjs"}]}
    ]);
    for (name, content) in [
        ("package.json", package.to_string()),
        ("cordis.patch.yml", "[]\n".into()),
        ("bridge.mjs", SOURCE.into()),
        ("omnicode.patch.yml", patch.to_string()),
    ] {
        let target = root.join(name);
        if std::fs::read_to_string(&target).ok().as_deref() == Some(content.as_str()) {
            continue;
        }
        let temporary = root.join(format!("{name}.{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&temporary, content).map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
    }
    Ok(BridgeLaunch {
        path: path.to_string_lossy().into_owned(),
        args: vec![
            "--profile".into(),
            PROFILE.into(),
            "--patch".into(),
            root.join("omnicode.patch.yml")
                .to_string_lossy()
                .into_owned(),
        ],
    })
}

//! Installed font families for Settings → Appearance font pickers.

use std::collections::BTreeSet;

#[derive(serde::Serialize)]
pub struct SystemFonts {
    /// Every installed family, for interface and content fonts.
    all: Vec<String>,
    /// Fixed-pitch families only, for the code font.
    monospace: Vec<String>,
}

/// Installed family names in English, deduplicated and sorted.
#[tauri::command]
pub async fn list_system_fonts() -> Result<SystemFonts, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut names = BTreeSet::new();
        let mut monospace = BTreeSet::new();
        for face in db.faces() {
            // fontdb lists the English (US) family first; localized aliases follow.
            if let Some((name, _)) = face.families.first() {
                let name = name.trim();
                if !name.is_empty() && !name.starts_with('.') {
                    names.insert(name.to_string());
                    if face.monospaced {
                        monospace.insert(name.to_string());
                    }
                }
            }
        }
        SystemFonts {
            all: names.into_iter().collect(),
            monospace: monospace.into_iter().collect(),
        }
    })
    .await
    .map_err(|error| error.to_string())
}

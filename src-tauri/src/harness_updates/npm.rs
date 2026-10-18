use std::fs::{self, OpenOptions};
use std::path::{Component, Path, PathBuf};

use serde_json::Value;

/// Snapshot only this package and its launchers, never npm's shared metadata or
/// unrelated packages. Keep dependencies (including optional native binaries).
pub(super) struct Installation {
    root: PathBuf,
    launchers: Vec<PathBuf>,
}

impl Installation {
    pub(super) fn find(command: &Path, package: &str) -> Result<Option<Self>, String> {
        let real = super::canonical(command);
        let mut beside_shim: Vec<_> = command
            .parent()
            .map(|parent| parent.join("node_modules").join(package))
            .into_iter()
            .collect();
        if package == "@earendil-works/pi-coding-agent" {
            if let Some(parent) = command.parent() {
                beside_shim.push(parent.join("node_modules/@mariozechner/pi-coding-agent"));
            }
        }
        let roots = real.ancestors().map(Path::to_path_buf).chain(beside_shim);
        for root in roots {
            let Ok(bytes) = fs::read(root.join("package.json")) else {
                continue;
            };
            let Ok(manifest) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            let name = manifest["name"].as_str().unwrap_or_default();
            if name != package
                && !(package == "@earendil-works/pi-coding-agent"
                    && name == "@mariozechner/pi-coding-agent")
            {
                continue;
            }
            // Support only npm's global layout. A project-local package must not
            // accidentally update a different installation through npm -g.
            let modules = if name.starts_with('@') {
                root.parent().and_then(Path::parent)
            } else {
                root.parent()
            }
            .ok_or("Cannot locate npm package directory")?;
            if modules
                .file_name()
                .is_none_or(|name| name != "node_modules")
            {
                continue;
            }
            let base = modules.parent().ok_or("Cannot locate npm prefix")?;
            let bin = if cfg!(windows) {
                base.to_path_buf()
            } else {
                if base.file_name().is_none_or(|name| name != "lib") {
                    return Err("Cannot safely back up a non-global npm installation".into());
                }
                base.parent().ok_or("Cannot locate npm prefix")?.join("bin")
            };
            let names: Vec<String> = match &manifest["bin"] {
                Value::String(_) => vec![name.rsplit('/').next().unwrap_or(name).to_string()],
                Value::Object(entries) => entries.keys().cloned().collect(),
                _ => return Err("npm package has no launchers to back up".into()),
            };
            let mut launchers = Vec::new();
            for name in names {
                if !matches!(
                    Path::new(&name).components().collect::<Vec<_>>().as_slice(),
                    [Component::Normal(_)]
                ) || name.contains(['/', '\\'])
                {
                    return Err("npm package has an invalid launcher name".into());
                }
                launchers.push(bin.join(&name));
                if cfg!(windows) {
                    launchers.push(bin.join(format!("{name}.cmd")));
                    launchers.push(bin.join(format!("{name}.ps1")));
                }
            }
            return Ok(Some(Self { root, launchers }));
        }
        Ok(None)
    }

    pub(super) fn update(
        &self,
        update: impl FnOnce() -> Result<(), String>,
        verify: impl Fn() -> Result<String, String>,
    ) -> Result<(), String> {
        let parent = self
            .root
            .parent()
            .ok_or("Cannot locate npm package parent")?;
        let name = self
            .root
            .file_name()
            .ok_or("Cannot locate npm package name")?
            .to_string_lossy();
        // The OS releases this lock on crashes. Do not unlink the lock inode.
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(parent.join(format!(".monocode-{name}-update.lock")))
            .map_err(|e| e.to_string())?;
        lock.try_lock()
            .map_err(|_| "Another update is using this npm installation".to_string())?;
        let previous = verify()
            .map_err(|e| format!("Cannot verify the installed CLI before updating: {e}"))?;
        let backup = parent.join(format!(".monocode-{name}-backup-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&backup).map_err(|e| e.to_string())?;
        let paths: Vec<_> = std::iter::once(self.root.clone())
            .chain(self.launchers.clone())
            .collect();
        if let Err(error) = snapshot(&paths, &backup) {
            let _ = fs::remove_dir_all(&backup);
            return Err(format!(
                "Could not back up CLI; update was not started: {error}"
            ));
        }
        let result = update().and_then(|()| verify().map(|_| ()));
        if let Err(error) = result {
            if let Err(restore_error) = restore(&paths, &backup).and_then(|()| {
                let restored = verify()?;
                if restored != previous {
                    return Err(format!("Expected {previous}, found {restored}"));
                }
                Ok(())
            }) {
                return Err(format!(
                    "{error}\nRollback failed: {restore_error}\nRecovery files retained at {}",
                    backup.display()
                ));
            }
            let _ = fs::remove_dir_all(&backup);
            return Err(format!(
                "{error}\nPrevious CLI installation restored ({previous})."
            ));
        }
        // A locked backup on Windows can be removed later. It is never needed
        // to run the verified new installation, so cleanup is best effort.
        let _ = fs::remove_dir_all(&backup);
        drop(lock);
        Ok(())
    }
}

fn snapshot(paths: &[PathBuf], backup: &Path) -> Result<(), String> {
    // A recovery manifest also makes retained backups usable without guessing
    // which numbered entry was a package, a shell shim or a PowerShell launcher.
    fs::write(
        backup.join("paths.json"),
        serde_json::to_vec(paths).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    for (index, path) in paths.iter().enumerate() {
        match fs::symlink_metadata(path) {
            Ok(_) => {
                copy_entry(path, &backup.join(index.to_string())).map_err(|e| e.to_string())?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

fn restore(paths: &[PathBuf], backup: &Path) -> Result<(), String> {
    let failed = backup.join("failed-installation");
    fs::create_dir(&failed).map_err(|e| e.to_string())?;
    for (index, path) in paths.iter().enumerate() {
        // Quarantine rather than delete possibly locked Windows executables.
        // Leave the snapshot untouched until the entire restore is verified.
        match fs::symlink_metadata(path) {
            Ok(_) => fs::rename(path, failed.join(index.to_string())).map_err(|e| e.to_string())?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        let saved = backup.join(index.to_string());
        if fs::symlink_metadata(&saved).is_ok() {
            copy_entry(&saved, path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn copy_entry(from: &Path, to: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(from)?;
    if metadata.file_type().is_symlink() {
        let target = fs::read_link(from)?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, to)?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::{symlink_dir, symlink_file, FileTypeExt};
            if metadata.file_type().is_symlink_dir() {
                symlink_dir(target, to)?;
            } else {
                symlink_file(target, to)?;
            }
        }
    } else if metadata.is_dir() {
        fs::create_dir(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_entry(&entry.path(), &to.join(entry.file_name()))?;
        }
        fs::set_permissions(to, metadata.permissions())?;
    } else {
        fs::copy(from, to)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        directory: PathBuf,
        installation: Installation,
    }

    impl Fixture {
        fn new() -> Self {
            let directory =
                std::env::temp_dir().join(format!("monocode-update-test-{}", uuid::Uuid::new_v4()));
            let root = directory.join("lib/node_modules/@openai/codex");
            let launcher = directory.join("bin/codex");
            fs::create_dir_all(root.join("node_modules/native")).unwrap();
            fs::create_dir_all(launcher.parent().unwrap()).unwrap();
            fs::write(
                root.join("package.json"),
                r#"{"name":"@openai/codex","version":"1.0.0","bin":{"codex":"bin/codex.js"}}"#,
            )
            .unwrap();
            fs::write(root.join("node_modules/native/binary"), "old native binary").unwrap();
            fs::write(&launcher, "old launcher").unwrap();
            Self {
                directory,
                installation: Installation {
                    root,
                    launchers: vec![launcher],
                },
            }
        }

        fn verify(&self) -> Result<String, String> {
            let bytes =
                fs::read_to_string(self.installation.root.join("node_modules/native/binary"))
                    .map_err(|_| "Missing optional dependency".to_string())?;
            Ok(if bytes == "old native binary" {
                "1.0.0"
            } else {
                "2.0.0"
            }
            .into())
        }

        fn break_install(&self) {
            fs::remove_dir_all(self.installation.root.join("node_modules")).unwrap();
            fs::write(&self.installation.launchers[0], "broken launcher").unwrap();
        }

        fn assert_restored(&self) {
            assert_eq!(self.verify().unwrap(), "1.0.0");
            assert_eq!(
                fs::read_to_string(&self.installation.launchers[0]).unwrap(),
                "old launcher"
            );
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn failed_install_restores_package_dependencies_and_launchers_without_network() {
        let fixture = Fixture::new();
        let error = fixture
            .installation
            .update(
                || {
                    fixture.break_install();
                    Err("npm download failed".into())
                },
                || fixture.verify(),
            )
            .unwrap_err();
        assert!(error.contains("npm download failed"));
        assert!(error.contains("Previous CLI installation restored (1.0.0)"));
        fixture.assert_restored();
    }

    #[test]
    fn success_exit_with_missing_optional_dependency_is_rolled_back() {
        let fixture = Fixture::new();
        let error = fixture
            .installation
            .update(
                || {
                    fixture.break_install();
                    Ok(())
                },
                || fixture.verify(),
            )
            .unwrap_err();
        assert!(error.contains("Missing optional dependency"));
        fixture.assert_restored();
    }

    #[test]
    fn verified_install_is_kept() {
        let fixture = Fixture::new();
        fixture
            .installation
            .update(
                || {
                    fs::write(
                        fixture.installation.root.join("node_modules/native/binary"),
                        "new native binary",
                    )
                    .unwrap();
                    Ok(())
                },
                || fixture.verify(),
            )
            .unwrap();
        assert_eq!(fixture.verify().unwrap(), "2.0.0");
    }

    #[test]
    fn refuses_overlapping_updates() {
        let fixture = Fixture::new();
        fixture
            .installation
            .update(
                || {
                    let error = fixture
                        .installation
                        .update(|| panic!("must not run"), || fixture.verify())
                        .unwrap_err();
                    assert!(error.contains("Another update"));
                    Ok(())
                },
                || fixture.verify(),
            )
            .unwrap();
        fixture.assert_restored();
    }

    #[test]
    fn failed_rollback_retains_snapshot_and_reports_recovery_path() {
        let fixture = Fixture::new();
        let error = fixture
            .installation
            .update(
                || {
                    fixture.break_install();
                    let bin = fixture.directory.join("bin");
                    fs::rename(&bin, fixture.directory.join("displaced-bin")).unwrap();
                    fs::write(bin, "cannot restore a launcher through a file").unwrap();
                    Err("install failed".into())
                },
                || fixture.verify(),
            )
            .unwrap_err();
        assert!(error.contains("Rollback failed"));
        let backup = Path::new(error.split("Recovery files retained at ").nth(1).unwrap());
        assert_eq!(
            fs::read_to_string(backup.join("0/node_modules/native/binary")).unwrap(),
            "old native binary"
        );
        assert_eq!(
            fs::read_to_string(backup.join("1")).unwrap(),
            "old launcher"
        );
        assert!(backup.join("paths.json").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn finds_global_symlink_and_preserves_relative_target_and_executable_mode() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let fixture = Fixture::new();
        let root = &fixture.installation.root;
        fs::create_dir(root.join("bin")).unwrap();
        fs::write(root.join("bin/codex.js"), "old executable").unwrap();
        fs::set_permissions(root.join("bin/codex.js"), fs::Permissions::from_mode(0o755)).unwrap();
        let launcher = &fixture.installation.launchers[0];
        fs::remove_file(launcher).unwrap();
        let target = Path::new("../lib/node_modules/@openai/codex/bin/codex.js");
        symlink(target, launcher).unwrap();
        let installation = Installation::find(launcher, "@openai/codex")
            .unwrap()
            .unwrap();
        installation
            .update(
                || {
                    fs::remove_file(launcher).unwrap();
                    fs::write(launcher, "bad shim").unwrap();
                    Err("failed".into())
                },
                || fixture.verify(),
            )
            .unwrap_err();
        assert_eq!(fs::read_link(launcher).unwrap(), target);
        assert_eq!(
            fs::metadata(launcher).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }
    #[cfg(windows)]
    #[test]
    fn windows_npm_shims_are_detected_and_restored_together() {
        let fixture = Fixture::new();
        let prefix = fixture.directory.join("npm-prefix");
        let root = prefix.join("node_modules/@openai/codex");
        fs::create_dir_all(root.parent().unwrap()).unwrap();
        copy_entry(&fixture.installation.root, &root).unwrap();
        for name in ["codex", "codex.cmd", "codex.ps1"] {
            fs::write(prefix.join(name), format!("old {name}")).unwrap();
        }
        let installation = Installation::find(&prefix.join("codex.cmd"), "@openai/codex")
            .unwrap()
            .unwrap();
        assert_eq!(installation.root, root);
        assert_eq!(installation.launchers.len(), 3);
        installation
            .update(
                || {
                    fs::remove_dir_all(root.join("node_modules")).unwrap();
                    for name in ["codex", "codex.cmd", "codex.ps1"] {
                        fs::write(prefix.join(name), "new broken shim").unwrap();
                    }
                    Err("download failed".into())
                },
                || {
                    fs::read_to_string(root.join("node_modules/native/binary"))
                        .map_err(|e| e.to_string())
                },
            )
            .unwrap_err();
        for name in ["codex", "codex.cmd", "codex.ps1"] {
            assert_eq!(
                fs::read_to_string(prefix.join(name)).unwrap(),
                format!("old {name}")
            );
        }
        assert_eq!(
            fs::read_to_string(root.join("node_modules/native/binary")).unwrap(),
            "old native binary"
        );
    }
}

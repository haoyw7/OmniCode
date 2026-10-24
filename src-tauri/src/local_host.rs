//! The desktop and phones use the same background conversation owner.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager, State};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Prepared {
    endpoint: String,
    token: String,
    projects: Vec<Value>,
    sessions: Vec<Value>,
    projections: Vec<Value>,
    migration_audit: crate::session_store::DesktopImportAudit,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedHost {
    machine: crate::remote::Machine,
    projects: Vec<Value>,
    sessions: Vec<Value>,
    retired_session_ids: Vec<String>,
}

fn bundled_runtime(root: &Path) -> Option<(PathBuf, PathBuf)> {
    let entry = root.join("host.mjs");
    let node = if cfg!(windows) {
        root.join("node.exe")
    } else {
        root.join("bin/node")
    };
    (entry.is_file() && node.is_file()).then_some((node, entry))
}

fn runtime(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    #[cfg(debug_assertions)]
    {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Missing development directory")?;
        let entry = root.join("build/host/omnicode-host.mjs");
        if entry.is_file() {
            return Ok((PathBuf::from("node"), entry));
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        if let Some(runtime) = bundled_runtime(&resources.join("desktop-host")) {
            return Ok(runtime);
        }
    }
    Err("The shared conversation service is missing from this installation.".into())
}

#[tauri::command(async)]
pub fn shared_host_prepare(
    app: AppHandle,
    state: State<'_, crate::remote::RemoteConnections>,
) -> Result<SharedHost, String> {
    let (node, entry) = runtime(&app)?;
    let desktop = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&desktop).map_err(|e| e.to_string())?;
    let store = app.state::<crate::session_store::SessionStore>();
    let manifest = crate::legacy_orchestration::prepare(&store)?;
    let retired_session_ids: Vec<String> = manifest
        .entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect();
    if let Some(control) = app.try_state::<crate::control::ControlHost>() {
        control.retire_sessions(&retired_session_ids);
    }
    if let Some(harness) = app.try_state::<crate::harness::HarnessHost>() {
        harness.retire_sessions(&retired_session_ids)?;
    }
    let manifest_path = desktop.join("legacy-orchestration-retirement.json");
    let raw = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    write_retirement_manifest(&desktop, &manifest_path, &raw)?;
    let mut command = Command::new(node);
    command
        .arg(entry)
        .arg("desktop")
        .arg("--desktop-data-dir")
        .arg(&desktop)
        .arg("--legacy-orchestration-manifest")
        .arg(&manifest_path);
    // Publish the startup snapshot, not pending path edits that require restart.
    let binary_paths = app
        .state::<crate::harness::HarnessHost>()
        .runtime_binary_paths();
    command.env(
        "OMNICODE_DESKTOP_BINARY_PATHS",
        serde_json::to_string(&binary_paths).map_err(|e| e.to_string())?,
    );
    crate::hide_window_console(&mut command);
    // Serialize every native session mutation with the read-only source import.
    // Node uses a separate read-only SQLite connection and never writes it.
    let mut migration_lock = store.lock_conn()?;
    // The SQLite write reservation also excludes an older desktop process;
    // the Rust mutex alone only serializes this process's commands.
    let migration_transaction = migration_lock
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let migration_before = crate::session_store::desktop_import_audit(&migration_transaction)?;
    let output = command
        .output()
        .map_err(|e| format!("Could not start shared conversation service: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let prepared: Prepared = serde_json::from_slice(&output.stdout)
        .map_err(|_| "Invalid conversation service response")?;
    crate::session_store::accept_host_ownership(
        &migration_transaction,
        &migration_before,
        &prepared.migration_audit,
    )?;
    migration_transaction
        .commit()
        .map_err(|error| error.to_string())?;
    drop(migration_lock);
    crate::legacy_orchestration::finish(&store, &manifest)?;
    let machine = crate::remote::remote_connect(
        app.clone(),
        state.clone(),
        String::new(),
        prepared.endpoint,
        prepared.token,
    )?;
    state.remember_shared_host(&machine)?;
    let projections = prepared.projections;
    let result = SharedHost {
        machine,
        projects: prepared.projects,
        sessions: prepared.sessions,
        retired_session_ids,
    };
    // Cache errors do not invalidate an authenticated live startup.
    if let Ok(snapshot) = serde_json::to_value(&result) {
        if let Some(machine_id) = snapshot.pointer("/machine/id").and_then(Value::as_str) {
            let _ = crate::host_projection_cache::save_bootstrap(
                &app,
                &state,
                &store,
                machine_id,
                &snapshot,
                &projections,
            );
        }
    }
    Ok(result)
}

/// Stop the shared Host on the way out. Best effort: a Host that is already
/// gone, or one that cannot be reached, must not keep the desktop open.
pub fn stop_shared_host(app: &AppHandle) {
    let (node, entry) = match runtime(app) {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("omnicode: stop shared host: {err}");
            return;
        }
    };
    let mut command = Command::new(node);
    command.arg(entry).arg("stop");
    crate::hide_window_console(&mut command);
    match command.output() {
        Ok(output) if !output.status.success() => eprintln!(
            "omnicode: stop shared host: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
        Err(err) => eprintln!("omnicode: stop shared host: {err}"),
        Ok(_) => {}
    }
}

/// The Windows updater runs NSIS and then `std::process::exit`, skipping the
/// quit path. The detached shared Host keeps executing `node.exe` and
/// `omnicode-supervisor.exe` from the install directory, so the installer
/// cannot overwrite them. Stop it and wait until those images are released.
#[tauri::command(async)]
pub fn prepare_update_install(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        stop_shared_host(&app);
        let root = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("desktop-host");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while let Some(locked) = locked_executable(&root) {
            if std::time::Instant::now() >= deadline {
                return Err(format!(
                    "{} is still in use. Close OmniCode Host and try again.",
                    locked.display()
                ));
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }
    #[cfg(not(windows))]
    let _ = app;
    Ok(())
}

/// A running image cannot be opened for writing on Windows.
#[cfg(windows)]
fn locked_executable(root: &Path) -> Option<PathBuf> {
    std::fs::read_dir(root)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        })
        .find(|path| {
            // ERROR_SHARING_VIOLATION; other failures are left to the installer.
            std::fs::OpenOptions::new()
                .write(true)
                .open(path)
                .is_err_and(|err| err.raw_os_error() == Some(32))
        })
}

fn write_retirement_manifest(desktop: &Path, path: &Path, raw: &[u8]) -> Result<(), String> {
    if std::fs::read(path).is_ok_and(|previous| previous == raw) {
        return Ok(());
    }
    let mut manifest_file = std::fs::OpenOptions::new();
    manifest_file.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        manifest_file.mode(0o600);
    }
    let temporary_manifest =
        desktop.join(format!("legacy-orchestration-{}.tmp", uuid::Uuid::new_v4()));
    let mut manifest_file = manifest_file
        .open(&temporary_manifest)
        .map_err(|e| e.to_string())?;
    {
        use std::io::Write;
        manifest_file.write_all(raw).map_err(|e| e.to_string())?;
        manifest_file.sync_all().map_err(|e| e.to_string())?;
    }
    drop(manifest_file);
    // Windows rename cannot replace an existing file. The authoritative manifest
    // is already durable in SQLite, so an interrupted replacement is recreated
    // on the next bootstrap rather than rescanning conversations.
    #[cfg(windows)]
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    match std::fs::rename(&temporary_manifest, path) {
        Ok(()) => Ok(()),
        Err(_) if std::fs::read(path).is_ok_and(|previous| previous == raw) => {
            let _ = std::fs::remove_file(&temporary_manifest);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::remove_file(&temporary_manifest);
            Err(error.to_string())
        }
    }
}

/// Resource rows are shared with Node Host. Transactions cover row acquisition
/// only; the durable reservation stays in place while a process or buffer lives.
#[derive(Clone)]
pub(crate) struct SharedResourceLease {
    _owner: std::sync::Arc<SharedResourceOwner>,
}

struct SharedResourceOwner {
    database: PathBuf,
    id: String,
    owner_pid: std::sync::atomic::AtomicU32,
}

impl SharedResourceLease {
    pub(crate) fn set_owner_pid(&self, pid: u32) -> Result<(), String> {
        use std::sync::atomic::Ordering;
        if pid == 0 || pid > i32::MAX as u32 {
            return Err("Invalid process resource identity".into());
        }
        let previous = self._owner.owner_pid.load(Ordering::SeqCst);
        let conn = resource_connection(&self._owner.database)?;
        let updated = conn
            .execute(
                "UPDATE checkout_resources SET owner_pid=?1 WHERE id=?2 AND owner_pid=?3",
                rusqlite::params![pid, self._owner.id, previous],
            )
            .map_err(|e| e.to_string())?;
        if updated != 1 {
            return Err("This process no longer owns its checkout reservation".into());
        }
        self._owner.owner_pid.store(pid, Ordering::SeqCst);
        Ok(())
    }
}

impl Drop for SharedResourceOwner {
    fn drop(&mut self) {
        let owner_pid = self.owner_pid.load(std::sync::atomic::Ordering::SeqCst);
        // An exited group leader can leave a live descendant. Keep its durable
        // row until registry recovery observes that the process group is gone.
        if owner_pid != std::process::id() && owner_alive(owner_pid) {
            return;
        }
        let _ = release_resource_row_for_owner(&self.database, &self.id, owner_pid);
    }
}

fn host_database() -> Option<PathBuf> {
    crate::dirs_home().map(|home| Path::new(&home).join(".omnicode-host/host.db"))
}

fn resource_path(path: &Path) -> String {
    if let Ok(Some(target)) = crate::wsl_path::parse(&path.to_string_lossy()) {
        return target.resource_key();
    }
    let mut ancestor = path.to_path_buf();
    let mut suffix = Vec::new();
    while !ancestor.exists() {
        let Some(name) = ancestor.file_name().map(|name| name.to_os_string()) else {
            break;
        };
        suffix.push(name);
        if !ancestor.pop() {
            break;
        }
    }
    let mut canonical = ancestor.canonicalize().unwrap_or(ancestor);
    for part in suffix.into_iter().rev() {
        canonical.push(part);
    }
    let value = canonical.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    let value = value.strip_prefix("//?/").unwrap_or(&value).to_lowercase();
    value.trim_end_matches('/').to_string()
}

fn paths_overlap(left: &str, right: &str) -> bool {
    left == right
        || left.starts_with(&format!("{right}/"))
        || right.starts_with(&format!("{left}/"))
}

fn owner_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        // EPERM denotes a live process we are not allowed to inspect.
        if pid > i32::MAX as u32 {
            return true;
        }
        unsafe {
            libc::kill(pid as i32, 0) == 0
                || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
                || libc::kill(-(pid as i32), 0) == 0
                || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
        }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
        unsafe {
            let process = OpenProcess(0x0010_0000, 0, pid); // SYNCHRONIZE
            if process.is_null() {
                return std::io::Error::last_os_error().raw_os_error() != Some(87);
            }
            let alive = WaitForSingleObject(process, 0) != 0;
            CloseHandle(process);
            alive
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        true
    }
}

fn resource_connection(database: &Path) -> Result<rusqlite::Connection, String> {
    let conn = rusqlite::Connection::open_with_flags(
        database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .map_err(|e| format!("Could not open shared resource registry: {e}"))?;
    conn.execute_batch("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS checkout_resources (id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL, owner_pid INTEGER NOT NULL);")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn acquire_resource_row(
    database: &Path,
    id: &str,
    path: &Path,
    removing: bool,
) -> Result<bool, String> {
    acquire_resource_kind(
        database,
        id,
        path,
        if removing { "removing" } else { "resource" },
    )
}

fn checkout_kinds_conflict(request: &str, held: &str) -> bool {
    if request == "computer" || held == "computer" {
        return request == held;
    }
    if request == "removing" || held == "removing" {
        return true;
    }
    if request == "resource" || held == "resource" {
        return false;
    }
    request == "integrating" || held == "integrating"
}

fn acquire_resource_kind(
    database: &Path,
    id: &str,
    path: &Path,
    requested_kind: &str,
) -> Result<bool, String> {
    if !database.is_file() {
        return Ok(false);
    }
    let conn = resource_connection(database)?;
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
    let rows = {
        let mut statement = conn
            .prepare("SELECT id, path, kind, owner_pid FROM checkout_resources")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u32>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let key = resource_path(path);
    let mut blockers = Vec::new();
    let mut removing = requested_kind == "removing";
    for (other_id, other_path, kind, pid) in rows {
        if !owner_alive(pid) {
            conn.execute(
                "DELETE FROM checkout_resources WHERE id=?1 AND owner_pid=?2",
                rusqlite::params![other_id, pid],
            )
            .map_err(|e| e.to_string())?;
        } else if other_id != id
            && paths_overlap(&key, &other_path)
            && checkout_kinds_conflict(requested_kind, &kind)
        {
            removing |= kind == "removing";
            blockers.push(format!("{other_id} · {kind} · PID {pid} · {other_path}"));
        }
    }
    if !blockers.is_empty() {
        let message = if removing {
            "Close files and terminals using this working copy before cleanup; it may currently be being removed."
        } else {
            "This working copy is receiving an accepted result or an active write. Retry when the operation finishes."
        };
        return Err(format!("{message}\n{}", blockers.join("\n")));
    }
    conn.execute("INSERT INTO checkout_resources VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET path=excluded.path, kind=excluded.kind, owner_pid=excluded.owner_pid", rusqlite::params![id, key, requested_kind, std::process::id()]).map_err(|e| e.to_string())?;
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(true)
}

fn release_resource_row(database: &Path, id: &str) -> Result<(), String> {
    release_resource_row_for_owner(database, id, std::process::id())
}

fn release_resource_row_for_owner(database: &Path, id: &str, owner_pid: u32) -> Result<(), String> {
    if !database.is_file() {
        return Ok(());
    }
    let conn = resource_connection(database)?;
    conn.execute(
        "DELETE FROM checkout_resources WHERE id=?1 AND owner_pid=?2",
        rusqlite::params![id, owner_pid],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn claim_checkout_resource(
    path: &Path,
    id: &str,
) -> Result<Option<SharedResourceLease>, String> {
    claim_checkout(path, id, "resource")
}

pub(crate) fn claim_checkout_removal(path: &Path) -> Result<Option<SharedResourceLease>, String> {
    claim_checkout(
        path,
        &format!("remove:{}", uuid::Uuid::new_v4()),
        "removing",
    )
}

/// Only actual mutations hold this lease; mounted editor buffers remain available.
pub(crate) fn claim_checkout_write(path: &Path) -> Result<Option<SharedResourceLease>, String> {
    claim_checkout(path, &format!("write:{}", uuid::Uuid::new_v4()), "writing")
}

/// A native terminal/provider may write until its last descendant exits.
pub(crate) fn claim_checkout_process_resource(
    path: &Path,
    id: &str,
) -> Result<Option<SharedResourceLease>, String> {
    claim_checkout(path, id, "writing")
}

fn claim_checkout(
    path: &Path,
    id: &str,
    kind: &str,
) -> Result<Option<SharedResourceLease>, String> {
    let Some(database) = host_database() else {
        return Ok(None);
    };
    let id = format!("native:{}:{id}", std::process::id());
    if !acquire_resource_kind(&database, &id, path, kind)? {
        return Ok(None);
    }
    Ok(Some(SharedResourceLease {
        _owner: std::sync::Arc::new(SharedResourceOwner {
            database,
            id,
            owner_pid: std::sync::atomic::AtomicU32::new(std::process::id()),
        }),
    }))
}

fn editor_resource_id(resource_id: &str) -> Result<String, String> {
    if resource_id.is_empty()
        || resource_id.len() > 200
        || !resource_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || "-_:".contains(value))
    {
        return Err("Invalid editor resource identity".into());
    }
    Ok(format!("editor:{}:{resource_id}", std::process::id()))
}

#[tauri::command(async)]
pub fn shared_host_resource_claim(resource_id: String, path: String) -> Result<(), String> {
    let id = editor_resource_id(&resource_id)?;
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("Editor resource path must be absolute".into());
    }
    if let Some(database) = host_database() {
        acquire_resource_row(&database, &id, &path, false)?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn shared_host_resource_release(resource_id: String) -> Result<(), String> {
    let id = editor_resource_id(&resource_id)?;
    if let Some(database) = host_database() {
        release_resource_row(&database, &id)?;
    }
    Ok(())
}

/// Native worktree deletion must also honor conversations owned by Host.
/// The lifecycle's shared removal row prevents new owners while Git runs;
/// this reference check commits before returning to avoid holding a DB lock.
pub fn reserve_worktree_removal(path: &Path) -> Result<Option<rusqlite::Connection>, String> {
    let Some(home) = crate::dirs_home() else {
        return Ok(None);
    };
    worktree_removal_lease(&Path::new(&home).join(".omnicode-host/host.db"), path)
}

fn worktree_removal_lease(
    database: &Path,
    path: &Path,
) -> Result<Option<rusqlite::Connection>, String> {
    if !database.is_file() {
        return Ok(None);
    }
    let conn = rusqlite::Connection::open_with_flags(
        database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .map_err(|e| format!("Could not check shared conversations: {e}"))?;
    conn.execute_batch("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE")
        .map_err(|e| format!("Could not reserve shared conversation worktree: {e}"))?;
    let target = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let paths = {
        let mut statement = conn
            .prepare("SELECT json_extract(snapshot, '$.session.cwd') FROM sessions")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    for cwd in paths {
        let cwd = PathBuf::from(cwd);
        let cwd = cwd.canonicalize().unwrap_or(cwd);
        if cwd.starts_with(&target) {
            return Err("Shared conversations still use this worktree. Delete those conversations before removing it.".into());
        }
    }
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(Some(conn))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retirement_manifest_file_is_reused_and_repaired_from_the_durable_list() {
        let root = std::env::temp_dir().join(format!(
            "omnicode-retirement-manifest-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("manifest.json");
        let raw = br#"{"manifestId":"host-orchestration-v1","entries":[]}"#;
        write_retirement_manifest(&root, &path, raw).unwrap();
        write_retirement_manifest(&root, &path, raw).unwrap();
        std::fs::write(&path, "incomplete").unwrap();
        write_retirement_manifest(&root, &path, raw).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), raw);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn shared_resources_protect_nested_paths_without_locking_database_and_drop_after_last_clone() {
        let root = std::env::temp_dir().join(format!("omnicode-resource-{}", uuid::Uuid::new_v4()));
        let tree = root.join("tree");
        std::fs::create_dir_all(tree.join("nested")).unwrap();
        let database = root.join("host.db");
        let writer = rusqlite::Connection::open(&database).unwrap();
        writer
            .execute_batch("CREATE TABLE unrelated (value TEXT)")
            .unwrap();
        let id = "editor:active";
        assert!(acquire_resource_row(&database, id, &tree.join("nested/file.txt"), false).unwrap());
        let lease = SharedResourceLease {
            _owner: std::sync::Arc::new(SharedResourceOwner {
                database: database.clone(),
                id: id.into(),
                owner_pid: std::sync::atomic::AtomicU32::new(std::process::id()),
            }),
        };
        let clone = lease.clone();
        assert!(acquire_resource_row(&database, "remove:blocked", &tree, true).is_err());
        writer.busy_timeout(std::time::Duration::ZERO).unwrap();
        writer
            .execute("INSERT INTO unrelated VALUES ('unblocked')", [])
            .unwrap();
        drop(lease);
        assert!(acquire_resource_row(&database, "remove:still-blocked", &tree, true).is_err());
        drop(clone);
        assert!(acquire_resource_row(&database, "remove:active", &tree, true).unwrap());
        assert!(acquire_resource_row(
            &database,
            "editor:new",
            &tree.join("nested/file.txt"),
            false
        )
        .is_err());
        assert!(acquire_resource_row(
            &database,
            "editor:sibling",
            &root.join("tree-other/file.txt"),
            false
        )
        .unwrap());
        release_resource_row(&database, "remove:active").unwrap();
        assert!(acquire_resource_row(
            &database,
            "editor:new",
            &tree.join("nested/file.txt"),
            false
        )
        .unwrap());
        drop(writer);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// Host replays the same file in host/checkout-guards.test.ts.
    #[test]
    fn checkout_rules_match_the_shared_host_conformance_cases() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../host/checkout-guards.conformance.json"))
                .unwrap();
        for case in cases["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let root = std::env::temp_dir().join(format!(
                "omnicode-checkout-conformance-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&root).unwrap();
            let database = root.join("host.db");
            let writer = rusqlite::Connection::open(&database).unwrap();
            resource_connection(&database).unwrap();
            for (index, row) in case["rows"].as_array().unwrap().iter().enumerate() {
                let owner = match row["owner"].as_str().unwrap() {
                    "live" => std::process::id(),
                    _ => 0,
                };
                writer
                    .execute(
                        "INSERT INTO checkout_resources VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![
                            format!("row:{index}"),
                            resource_path(&root.join(row["path"].as_str().unwrap())),
                            row["kind"].as_str().unwrap(),
                            owner
                        ],
                    )
                    .unwrap();
            }
            let request = &case["request"];
            let allowed = acquire_resource_kind(
                &database,
                "request",
                &root.join(request["path"].as_str().unwrap()),
                request["kind"].as_str().unwrap(),
            )
            .is_ok();
            assert_eq!(allowed, case["allowed"].as_bool().unwrap(), "{name}");
            drop(writer);
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn dead_resource_owners_are_recovered_without_expiring_live_buffers() {
        let root =
            std::env::temp_dir().join(format!("omnicode-resource-dead-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let database = root.join("host.db");
        let writer = rusqlite::Connection::open(&database).unwrap();
        resource_connection(&database).unwrap();
        writer
            .execute(
                "INSERT INTO checkout_resources VALUES (?1, ?2, 'resource', 0)",
                rusqlite::params!["dead", resource_path(&root)],
            )
            .unwrap();
        assert!(acquire_resource_row(&database, "remove", &root, true).unwrap());
        let count: i32 = writer
            .query_row(
                "SELECT COUNT(*) FROM checkout_resources WHERE id='dead'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        drop(writer);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn active_writes_and_integration_exclude_each_other_but_mounted_buffers_do_not() {
        let root = std::env::temp_dir().join(format!(
            "omnicode-integration-resource-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let database = root.join("host.db");
        let conn = rusqlite::Connection::open(&database).unwrap();
        let target = root.join("a.txt");
        std::fs::write(&target, "baseline").unwrap();
        assert!(acquire_resource_kind(&database, "editor:mounted", &target, "resource").unwrap());
        assert!(acquire_resource_kind(&database, "write:active", &target, "writing").unwrap());
        assert!(
            acquire_resource_kind(&database, "integration:blocked", &root, "integrating").is_err()
        );
        release_resource_row(&database, "write:active").unwrap();
        assert!(
            acquire_resource_kind(&database, "integration:active", &root, "integrating").unwrap()
        );
        assert!(acquire_resource_kind(&database, "write:blocked", &target, "writing").is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "baseline");
        assert!(acquire_resource_kind(&database, "editor:new", &target, "resource").unwrap());
        conn.busy_timeout(std::time::Duration::ZERO).unwrap();
        conn.execute_batch("CREATE TABLE unrelated (value TEXT)")
            .unwrap();
        release_resource_row(&database, "integration:active").unwrap();
        assert!(acquire_resource_kind(&database, "write:after", &target, "writing").unwrap());
        std::fs::write(&target, "saved after apply").unwrap();
        assert_eq!(
            std::fs::read_to_string(target).unwrap(),
            "saved after apply"
        );
        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_mutations_respect_host_execution_leases_and_leave_other_paths_available() {
        let root =
            std::env::temp_dir().join(format!("omnicode-bot-resource-{}", uuid::Uuid::new_v4()));
        let project = root.join("project");
        let unrelated = root.join("other");
        std::fs::create_dir_all(project.join("nested")).unwrap();
        std::fs::create_dir_all(&unrelated).unwrap();
        let database = root.join("host.db");
        drop(rusqlite::Connection::open(&database).unwrap());
        assert!(acquire_resource_kind(&database, "bot:run", &project, "executing").unwrap());
        for path in [&project, &project.join("nested"), &root] {
            assert!(acquire_resource_kind(&database, "write:shared", path, "writing").unwrap());
            release_resource_row(&database, "write:shared").unwrap();
            assert!(
                acquire_resource_kind(&database, "integrate:blocked", path, "integrating").is_err()
            );
        }
        assert!(acquire_resource_kind(&database, "editor:read", &project, "resource").unwrap());
        assert!(acquire_resource_kind(&database, "write:other", &unrelated, "writing").unwrap());
        release_resource_row(&database, "bot:run").unwrap();
        assert!(acquire_resource_kind(&database, "write:after", &project, "writing").unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn transferred_process_resource_survives_lease_drop_until_process_exit() {
        use std::os::unix::process::CommandExt;
        let root =
            std::env::temp_dir().join(format!("omnicode-live-resource-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let database = root.join("host.db");
        let conn = rusqlite::Connection::open(&database).unwrap();
        assert!(acquire_resource_kind(&database, "native:process", &root, "writing").unwrap());
        let lease = SharedResourceLease {
            _owner: std::sync::Arc::new(SharedResourceOwner {
                database: database.clone(),
                id: "native:process".into(),
                owner_pid: std::sync::atomic::AtomicU32::new(std::process::id()),
            }),
        };
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .process_group(0)
            .spawn()
            .unwrap();
        lease.set_owner_pid(child.id()).unwrap();
        drop(lease);
        let blocked =
            acquire_resource_kind(&database, "integration", &root, "integrating").is_err();
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(blocked);
        assert!(acquire_resource_kind(&database, "integration", &root, "integrating").unwrap());
        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn native_removal_honors_shared_conversation_references_without_holding_a_write_transaction() {
        let root =
            std::env::temp_dir().join(format!("omnicode-shared-worktree-{}", uuid::Uuid::new_v4()));
        let tree = root.join("tree");
        std::fs::create_dir_all(tree.join("nested")).unwrap();
        let database = root.join("host.db");
        let writer = rusqlite::Connection::open(&database).unwrap();
        writer
            .execute_batch("CREATE TABLE sessions (snapshot TEXT)")
            .unwrap();
        writer
            .execute(
                "INSERT INTO sessions VALUES (?1)",
                [serde_json::json!({ "session": { "cwd": tree.join("nested") } }).to_string()],
            )
            .unwrap();
        assert!(worktree_removal_lease(&database, &tree)
            .unwrap_err()
            .contains("Shared conversations"));
        writer.execute("DELETE FROM sessions", []).unwrap();
        let lease = worktree_removal_lease(&database, &tree).unwrap();
        writer.busy_timeout(std::time::Duration::ZERO).unwrap();
        assert!(writer
            .execute("INSERT INTO sessions VALUES ('{}')", [])
            .is_ok());
        drop(lease);
        assert!(writer
            .execute("INSERT INTO sessions VALUES ('{}')", [])
            .is_ok());
        drop(writer);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn packaged_runtime_requires_both_node_and_host() {
        let root = std::env::temp_dir().join(format!("omnicode-runtime-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("bin")).unwrap();
        assert!(bundled_runtime(&root).is_none());
        std::fs::write(root.join("host.mjs"), "").unwrap();
        assert!(bundled_runtime(&root).is_none());
        std::fs::write(
            if cfg!(windows) {
                root.join("node.exe")
            } else {
                root.join("bin/node")
            },
            "",
        )
        .unwrap();
        assert!(bundled_runtime(&root).is_some());
        std::fs::remove_dir_all(root).unwrap();
    }
}

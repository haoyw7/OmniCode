//! Disposable Host projections. These never update the rollback session rows.
use crate::{remote::RemoteConnections, session_store::SessionStore};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use tauri::{AppHandle, State};

fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS host_projection_cache (scope TEXT NOT NULL, entry TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(scope, entry)); CREATE TABLE IF NOT EXISTS host_projection_bootstrap (id INTEGER PRIMARY KEY CHECK(id=1), machine_id TEXT NOT NULL, scope TEXT NOT NULL, snapshot TEXT NOT NULL);")
        .map_err(|error| error.to_string())
}

fn put(conn: &Connection, scope: &str, snapshot: &Value) -> Result<(), String> {
    let id = snapshot
        .pointer("/session/id")
        .and_then(Value::as_str)
        .ok_or("Invalid Host projection")?;
    let revision = snapshot
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|value| *value >= 0)
        .ok_or("Invalid Host revision")?;
    if !snapshot
        .pointer("/session/blocks")
        .is_some_and(Value::is_array)
        || !snapshot.get("projectId").is_some_and(Value::is_string)
    {
        return Err("Invalid Host projection".into());
    }
    init(conn)?;
    conn.execute("INSERT INTO host_projection_cache VALUES (?1, ?2, ?3, ?4) ON CONFLICT(scope, entry) DO UPDATE SET revision=excluded.revision, snapshot=excluded.snapshot WHERE excluded.revision >= host_projection_cache.revision", params![scope, id, revision, snapshot.to_string()])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn get(conn: &Connection, scope: &str, id: &str) -> Result<Option<Value>, String> {
    init(conn)?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT snapshot FROM host_projection_cache WHERE scope=?1 AND entry=?2",
            params![scope, id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    raw.map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

#[tauri::command(async)]
pub fn host_projection_cache_put(
    app: AppHandle,
    connections: State<'_, RemoteConnections>,
    store: State<'_, SessionStore>,
    machine_id: String,
    snapshot: Value,
    expected_scope: String,
) -> Result<(), String> {
    crate::remote::with_cache_identity(&app, &connections, &machine_id, |scope, _| {
        if scope != expected_scope {
            return Err("Host cache identity changed during sync".into());
        }
        put(&*store.lock_conn()?, scope, &snapshot)
    })
}

#[tauri::command(async)]
pub fn host_projection_cache_identity(
    app: AppHandle,
    connections: State<'_, RemoteConnections>,
    machine_id: String,
) -> Result<String, String> {
    crate::remote::with_cache_identity(&app, &connections, &machine_id, |scope, _| {
        Ok(scope.to_string())
    })
}

#[tauri::command(async)]
pub fn host_projection_cache_get(
    app: AppHandle,
    connections: State<'_, RemoteConnections>,
    store: State<'_, SessionStore>,
    machine_id: String,
    session_id: String,
) -> Result<Option<Value>, String> {
    crate::remote::with_cache_identity(&app, &connections, &machine_id, |scope, _| {
        get(&*store.lock_conn()?, scope, &session_id)
    })
}

#[tauri::command(async)]
pub fn host_projection_cache_list(
    app: AppHandle,
    connections: State<'_, RemoteConnections>,
    store: State<'_, SessionStore>,
    machine_id: String,
    project_id: String,
) -> Result<Vec<Value>, String> {
    crate::remote::with_cache_identity(&app, &connections, &machine_id, |scope, _| {
        let conn = store.lock_conn()?;
        init(&conn)?;
        let mut statement = conn
            .prepare(
                "SELECT snapshot FROM host_projection_cache WHERE scope=?1 AND snapshot != 'null'",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([scope], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        let mut snapshots = Vec::new();
        for row in rows {
            let snapshot: Value = serde_json::from_str(&row.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
            if snapshot.get("projectId").and_then(Value::as_str) == Some(&project_id) {
                snapshots.push(snapshot);
            }
        }
        Ok(snapshots)
    })
}

#[tauri::command(async)]
pub fn host_projection_cache_delete(
    app: AppHandle,
    connections: State<'_, RemoteConnections>,
    store: State<'_, SessionStore>,
    machine_id: String,
    session_id: String,
    expected_scope: String,
) -> Result<(), String> {
    crate::remote::with_cache_identity(&app, &connections, &machine_id, |scope, _| {
        if scope != expected_scope {
            return Err("Host cache identity changed during deletion".into());
        }
        let conn = store.lock_conn()?;
        init(&conn)?;
        // A response already in flight cannot resurrect a deleted projection.
        conn.execute(
            "INSERT OR REPLACE INTO host_projection_cache VALUES (?1, ?2, ?3, 'null')",
            params![scope, session_id, i64::MAX],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    })
}

pub(crate) fn save_bootstrap(
    app: &AppHandle,
    connections: &RemoteConnections,
    store: &SessionStore,
    machine_id: &str,
    snapshot: &Value,
    projections: &[Value],
) -> Result<(), String> {
    crate::remote::with_cache_identity(app, connections, machine_id, |scope, _| {
        let mut conn = store.lock_conn()?;
        let transaction = conn.transaction().map_err(|error| error.to_string())?;
        init(&transaction)?;
        // Another window can already hold a later revision. Monotonic upserts
        // retain it, and the bootstrap pointer commits with its full cache.
        for projection in projections {
            put(&transaction, scope, projection)?;
        }
        if let Some(sessions) = snapshot.get("sessions").and_then(Value::as_array) {
            for row in sessions
                .iter()
                .filter(|row| row.get("deleted").and_then(Value::as_bool) == Some(true))
            {
                if let Some(id) = row.get("id").and_then(Value::as_str) {
                    transaction.execute("INSERT OR REPLACE INTO host_projection_cache VALUES (?1, ?2, ?3, 'null')", params![scope, id, i64::MAX]).map_err(|error| error.to_string())?;
                }
            }
        }
        transaction
            .execute(
                "INSERT OR REPLACE INTO host_projection_bootstrap VALUES (1, ?1, ?2, ?3)",
                params![machine_id, scope, snapshot.to_string()],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    })
}

/// Remember roots learned after startup, including projects created by another
/// device. Scope comes from the exact credential used by the native request.
pub(crate) fn cache_projects(
    store: &SessionStore,
    scope: &str,
    projects: &[Value],
) -> Result<(), String> {
    let conn = store.lock_conn()?;
    init(&conn)?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT snapshot FROM host_projection_bootstrap WHERE id=1 AND scope=?1",
            [scope],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(raw) = raw else {
        return Ok(());
    };
    let mut snapshot: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let saved = snapshot
        .get_mut("projects")
        .and_then(Value::as_array_mut)
        .ok_or("Invalid cached Host projects")?;
    for project in projects {
        let Some(id) = project.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !project.get("cwd").is_some_and(Value::is_string) {
            continue;
        }
        if let Some(existing) = saved
            .iter_mut()
            .find(|existing| existing.get("id").and_then(Value::as_str) == Some(id))
        {
            *existing = project.clone();
        } else {
            saved.push(project.clone());
        }
    }
    conn.execute(
        "UPDATE host_projection_bootstrap SET snapshot=?2 WHERE id=1 AND scope=?1",
        params![scope, snapshot.to_string()],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command(async)]
pub fn shared_host_cached_prepare(
    app: AppHandle,
    connections: State<'_, RemoteConnections>,
    store: State<'_, SessionStore>,
) -> Result<Option<Value>, String> {
    let cached: Option<(String, String, String)> = {
        let conn = store.lock_conn()?;
        init(&conn)?;
        conn.query_row(
            "SELECT machine_id, scope, snapshot FROM host_projection_bootstrap WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
    };
    let Some((machine_id, expected, raw)) = cached else {
        return Ok(None);
    };
    crate::remote::with_cache_identity(&app, &connections, &machine_id, |scope, machine| {
        if scope != expected {
            return Ok(None);
        }
        let mut snapshot: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        snapshot["machine"] = serde_json::to_value(machine).map_err(|error| error.to_string())?;
        let projects = snapshot
            .get("projects")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let conn = store.lock_conn()?;
        let mut statement = conn
            .prepare(
                "SELECT snapshot FROM host_projection_cache WHERE scope=?1 AND snapshot != 'null'",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([scope], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        let sessions = snapshot
            .get_mut("sessions")
            .and_then(Value::as_array_mut)
            .ok_or("Invalid cached Host sessions")?;
        for row in rows {
            let projection: Value = serde_json::from_str(&row.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
            let (Some(id), Some(project_id)) = (
                projection.pointer("/session/id").and_then(Value::as_str),
                projection.get("projectId").and_then(Value::as_str),
            ) else {
                continue;
            };
            let Some(project) = projects
                .iter()
                .find(|project| project.get("id").and_then(Value::as_str) == Some(project_id))
            else {
                continue;
            };
            if !sessions
                .iter()
                .any(|session| session.get("id").and_then(Value::as_str) == Some(id))
            {
                sessions.push(
                    serde_json::json!({"id": id, "projectId": project_id, "cwd": project["cwd"]}),
                );
            }
        }
        Ok(Some(snapshot))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn new_and_moved_project_roots_remain_available_offline_only_for_their_identity() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            init(&conn).unwrap();
            conn.execute(
                "INSERT INTO host_projection_bootstrap VALUES (1, 'machine', 'scope', ?1)",
                [json!({"projects":[{"id":"old", "cwd":"/before"}], "sessions":[]}).to_string()],
            )
            .unwrap();
        }
        cache_projects(
            &store,
            "different-credential",
            &[json!({"id":"leak", "cwd":"/other"})],
        )
        .unwrap();
        cache_projects(
            &store,
            "scope",
            &[
                json!({"id":"old", "cwd":"/after"}),
                json!({"id":"new", "cwd":"/new"}),
            ],
        )
        .unwrap();
        let conn = store.lock_conn().unwrap();
        let raw: String = conn
            .query_row(
                "SELECT snapshot FROM host_projection_bootstrap",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let snapshot: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            snapshot["projects"],
            json!([{"id":"old", "cwd":"/after"}, {"id":"new", "cwd":"/new"}])
        );
    }

    #[test]
    fn cache_preserves_full_projection_and_rejects_revision_regression_or_other_identity() {
        let conn = Connection::open_in_memory().unwrap();
        let snapshot = json!({"session":{"id":"s", "blocks":[{"id":"b", "text":"retained"}]}, "projectId":"p", "revision":4});
        put(&conn, "credential-a", &snapshot).unwrap();
        let mut stale = snapshot.clone();
        stale["revision"] = json!(3);
        stale["session"]["blocks"] = json!([]);
        put(&conn, "credential-a", &stale).unwrap();
        assert_eq!(get(&conn, "credential-a", "s").unwrap(), Some(snapshot));
        assert_eq!(get(&conn, "credential-b", "s").unwrap(), None);
        assert!(!conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='sessions')",
                [],
                |row| row.get::<_, bool>(0)
            )
            .unwrap());
    }
}

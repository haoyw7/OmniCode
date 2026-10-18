//! Exact, retryable retirement of the pre-Host orchestration conversations.
//! The source manifest commits before either database removes any record.
use std::collections::BTreeSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::session_store::SessionStore;

const VERSION: &str = "host-orchestration-v1";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetiredEntry {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetirementManifest {
    pub manifest_id: String,
    pub entries: Vec<RetiredEntry>,
}

pub(crate) fn ensure_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS legacy_orchestration_retirement (
             version TEXT PRIMARY KEY, manifest TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS retired_sessions (id TEXT PRIMARY KEY);",
    )
}

pub(crate) fn is_retired(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM retired_sessions WHERE id=?1)",
        [id],
        |row| row.get(0),
    )
}

pub(crate) fn authorize_session(store: &SessionStore, id: &str) -> Result<(), String> {
    let conn = store.lock_conn()?;
    if is_retired(&conn, id).map_err(|e| e.to_string())? {
        return Err("This legacy orchestration conversation has been deleted".into());
    }
    Ok(())
}

pub(crate) fn prepare(store: &SessionStore) -> Result<RetirementManifest, String> {
    let conn = store.lock_conn()?;
    prepare_manifest(&conn).map_err(|e| e.to_string())
}

fn collect_run(ids: &mut BTreeSet<String>, lead: &str, raw: &str) {
    ids.insert(lead.to_owned());
    if let Ok(run) = serde_json::from_str::<Value>(raw) {
        if let Some(tasks) = run["tasks"].as_array() {
            for task in tasks {
                if let Some(id) = task["sessionId"].as_str() {
                    ids.insert(id.to_owned());
                }
            }
        }
    }
}

fn prepare_manifest(conn: &Connection) -> rusqlite::Result<RetirementManifest> {
    let tx = conn.unchecked_transaction()?;
    if let Some(raw) = tx
        .query_row(
            "SELECT manifest FROM legacy_orchestration_retirement WHERE version=?1",
            [VERSION],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        return serde_json::from_str(&raw)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)));
    }
    let mut ids = BTreeSet::new();
    for table in ["orchestration_runs", "orchestration_sidebar"] {
        let column = if table == "orchestration_runs" {
            "state"
        } else {
            "summary"
        };
        let mut query = tx.prepare(&format!("SELECT lead_id, {column} FROM {table}"))?;
        for row in query.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })? {
            let (lead, raw) = row?;
            collect_run(&mut ids, &lead, &raw);
        }
    }
    {
        let mut query = tx.prepare("SELECT session_id, lead_id FROM orchestration_workers")?;
        for row in query.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })? {
            let (worker, lead) = row?;
            ids.insert(worker);
            ids.insert(lead);
        }
    }
    {
        let mut query = tx.prepare("SELECT id, blocks_json FROM sessions WHERE blocks_json LIKE '%orchestration%' OR blocks_json LIKE '%orchestrate%'")?;
        for row in query.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })? {
            let (id, raw) = row?;
            let blocks: Value = serde_json::from_str(&raw)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
            for block in blocks.as_array().into_iter().flatten() {
                if let Some(lead) = block["orchestrationLeadId"].as_str() {
                    ids.insert(id.clone());
                    ids.insert(lead.to_owned());
                }
                if block["orchestration"].is_object() || block["intent"] == "orchestrate" {
                    ids.insert(id.clone());
                }
            }
        }
    }
    let mut entries = Vec::new();
    for id in ids {
        let metadata = tx
            .query_row(
                "SELECT cwd, harness FROM sessions WHERE id=?1",
                [&id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        entries.push(RetiredEntry {
            id: id.clone(),
            cwd: metadata.as_ref().map(|m| m.0.clone()),
            harness: metadata.map(|m| m.1),
        });
        tx.execute("INSERT OR IGNORE INTO retired_sessions VALUES (?1)", [&id])?;
    }
    let manifest = RetirementManifest {
        manifest_id: VERSION.into(),
        entries,
    };
    tx.execute(
        "INSERT INTO legacy_orchestration_retirement(version, manifest) VALUES (?1, ?2)",
        params![
            VERSION,
            serde_json::to_string(&manifest)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?
        ],
    )?;
    tx.commit()?;
    Ok(manifest)
}

pub(crate) fn finish(store: &SessionStore, manifest: &RetirementManifest) -> Result<(), String> {
    let conn = store.lock_conn()?;
    finish_manifest(&conn, manifest).map_err(|e| e.to_string())
}

fn finish_manifest(conn: &Connection, manifest: &RetirementManifest) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let raw: String = tx.query_row(
        "SELECT manifest FROM legacy_orchestration_retirement WHERE version=?1",
        [&manifest.manifest_id],
        |row| row.get(0),
    )?;
    let saved: RetirementManifest = serde_json::from_str(&raw)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    if saved != *manifest {
        return Err(rusqlite::Error::InvalidParameterName(
            "Retirement manifest changed".into(),
        ));
    }
    for entry in &manifest.entries {
        tx.execute(
            "DELETE FROM orchestration_runs WHERE lead_id=?1",
            [&entry.id],
        )?;
        tx.execute(
            "DELETE FROM orchestration_sidebar WHERE lead_id=?1",
            [&entry.id],
        )?;
        tx.execute(
            "DELETE FROM orchestration_workers WHERE lead_id=?1 OR session_id=?1",
            [&entry.id],
        )?;
        tx.execute(
            "DELETE FROM in_flight_sessions WHERE session_id=?1",
            [&entry.id],
        )?;
        // Delete records only. Never call generated-image, branch or worktree cleanup.
        tx.execute("DELETE FROM sessions WHERE id=?1", [&entry.id])?;
    }
    tx.execute(
        "UPDATE legacy_orchestration_retirement SET completed=1 WHERE version=?1",
        [&manifest.manifest_id],
    )?;
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions(id TEXT PRIMARY KEY, cwd TEXT, harness TEXT, blocks_json TEXT);
            CREATE TABLE orchestration_runs(lead_id TEXT PRIMARY KEY, state TEXT);
            CREATE TABLE orchestration_sidebar(lead_id TEXT PRIMARY KEY, summary TEXT);
            CREATE TABLE orchestration_workers(session_id TEXT PRIMARY KEY, lead_id TEXT);
            CREATE TABLE in_flight_sessions(session_id TEXT PRIMARY KEY);",
        )
        .unwrap();
        ensure_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn retirement_is_exact_durable_and_cannot_rescan_new_runs() {
        let conn = database();
        conn.execute_batch("INSERT INTO sessions VALUES ('lead','/repo','codex','[]'),('worker','/repo/w','pi','[]'),('ordinary','/repo','codex','[]');
            INSERT INTO orchestration_runs VALUES ('lead','{\"tasks\":[{\"sessionId\":\"worker\"},{\"sessionId\":\"missing\"}]}');
            INSERT INTO in_flight_sessions VALUES ('worker');").unwrap();
        let manifest = prepare_manifest(&conn).unwrap();
        assert_eq!(
            manifest
                .entries
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            vec!["lead", "missing", "worker"]
        );
        assert!(is_retired(&conn, "lead").unwrap());
        conn.execute("INSERT INTO orchestration_runs VALUES ('new','{}')", [])
            .unwrap();
        assert_eq!(prepare_manifest(&conn).unwrap(), manifest);
        finish_manifest(&conn, &manifest).unwrap();
        finish_manifest(&conn, &manifest).unwrap();
        assert_eq!(
            conn.query_row("SELECT id FROM sessions", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "ordinary"
        );
        assert_eq!(
            conn.query_row("SELECT lead_id FROM orchestration_runs", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "new"
        );
        assert!(is_retired(&conn, "worker").unwrap());
    }

    #[test]
    fn transcript_only_workers_and_proposals_are_retired() {
        let conn = database();
        conn.execute_batch(
            "INSERT INTO sessions VALUES
          ('old-worker','/repo','pi','[{\"orchestrationLeadId\":\"old-lead\"}]'),
          ('proposal','/repo','codex','[{\"orchestration\":{\"status\":\"ready\"}}]'),
          ('mention','/repo','codex','[{\"text\":\"orchestrationLeadId example\"}]');",
        )
        .unwrap();
        let ids = prepare_manifest(&conn)
            .unwrap()
            .entries
            .into_iter()
            .map(|e| e.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, ["old-lead", "old-worker", "proposal"]);
    }

    #[test]
    fn failed_deletion_rolls_back_and_preserves_retry_manifest() {
        let conn = database();
        conn.execute_batch("INSERT INTO sessions VALUES ('lead','/repo','codex','[{\"intent\":\"orchestrate\"}]');
            CREATE TRIGGER fail_retirement BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let manifest = prepare_manifest(&conn).unwrap();
        assert!(finish_manifest(&conn, &manifest).is_err());
        assert_eq!(prepare_manifest(&conn).unwrap(), manifest);
        assert_eq!(
            conn.query_row(
                "SELECT completed FROM legacy_orchestration_retirement",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        conn.execute_batch("DROP TRIGGER fail_retirement").unwrap();
        finish_manifest(&conn, &manifest).unwrap();
    }
}

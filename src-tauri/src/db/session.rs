use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::{activity, new_id, setting};
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Type)]
pub struct Session {
    pub id: String,
    pub activity_id: String,
    #[specta(type = specta_typescript::Number)]
    pub start_ms: i64,
    /// `None` while running.
    #[specta(type = Option<specta_typescript::Number>)]
    pub end_ms: Option<i64>,
    pub note: Option<String>,
    pub continues_id: Option<String>,
    /// Set when the session was logged automatically from a recurring plan.
    pub plan_id: Option<String>,
}

/// Create (`id: None`) or edit a finished session. Running sessions are only created through `start`.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct SessionInput {
    pub id: Option<String>,
    pub activity_id: String,
    #[specta(type = specta_typescript::Number)]
    pub start_ms: i64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub end_ms: Option<i64>,
    pub note: Option<String>,
}

/// At most one of the two is set.
#[derive(Debug, Clone, Default, Serialize, Type)]
pub struct TimerState {
    pub running: Option<Session>,
    pub paused: Option<Session>,
}

const COLUMNS: &str = "id, activity_id, start_ms, end_ms, note, continues_id, plan_id";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Session> {
    Ok(Session {
        id: r.get(0)?,
        activity_id: r.get(1)?,
        start_ms: r.get(2)?,
        end_ms: r.get(3)?,
        note: r.get(4)?,
        continues_id: r.get(5)?,
        plan_id: r.get(6)?,
    })
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Session>> {
    let sql = format!("SELECT {COLUMNS} FROM session WHERE id = ?1 AND deleted_ms IS NULL");
    Ok(conn.query_row(&sql, [id], from_row).optional()?)
}

fn running(conn: &Connection) -> Result<Option<Session>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM session WHERE end_ms IS NULL AND deleted_ms IS NULL
         ORDER BY start_ms DESC LIMIT 1"
    );
    Ok(conn.query_row(&sql, [], from_row).optional()?)
}

/// Ends every running session (the "one running session, globally" rule) and returns the latest one.
fn end_running(tx: &Transaction<'_>, device: &str, now: i64) -> Result<Option<Session>> {
    let latest = running(tx)?;
    tx.execute(
        "UPDATE session SET end_ms = MAX(?1, start_ms), updated_ms = MAX(?1, updated_ms + 1), device_id = ?2, dirty = 1
         WHERE end_ms IS NULL AND deleted_ms IS NULL",
        params![now, device],
    )?;
    Ok(match latest {
        Some(s) => get(tx, &s.id)?,
        None => None,
    })
}

fn begin(tx: &Transaction<'_>, device: &str, now: i64, activity_id: &str, continues_id: Option<&str>) -> Result<Session> {
    end_running(tx, device, now)?;
    setting::remove(tx, setting::PAUSED_SESSION_ID)?;
    let id = new_id();
    tx.execute(
        "INSERT INTO session (id, activity_id, start_ms, continues_id, updated_ms, device_id)
         VALUES (?1, ?2, ?3, ?4, ?3, ?5)",
        params![id, activity_id, now, continues_id, device],
    )?;
    get(tx, &id)?.ok_or(Error::NotFound("session"))
}

pub fn start(conn: &mut Connection, device: &str, now: i64, activity_id: &str) -> Result<Session> {
    let tx = conn.transaction()?;
    if activity::get(&tx, activity_id)?.is_none() {
        return Err(Error::NotFound("activity"));
    }
    let s = begin(&tx, device, now, activity_id, None)?;
    tx.commit()?;
    Ok(s)
}

/// Pausing ends the running session and remembers it so `resume` can continue the chain.
pub fn pause(conn: &mut Connection, device: &str, now: i64) -> Result<Option<Session>> {
    let tx = conn.transaction()?;
    let ended = end_running(&tx, device, now)?;
    if let Some(s) = &ended {
        setting::set(&tx, setting::PAUSED_SESSION_ID, &s.id)?;
    }
    tx.commit()?;
    Ok(ended)
}

/// Starts a new session for the paused activity, linked through `continues_id`.
pub fn resume(conn: &mut Connection, device: &str, now: i64) -> Result<Session> {
    let tx = conn.transaction()?;
    let paused = paused(&tx)?.ok_or(Error::NotFound("paused session"))?;
    let s = begin(&tx, device, now, &paused.activity_id, Some(&paused.id))?;
    tx.commit()?;
    Ok(s)
}

pub fn stop(conn: &mut Connection, device: &str, now: i64) -> Result<Option<Session>> {
    let tx = conn.transaction()?;
    let ended = end_running(&tx, device, now)?;
    setting::remove(&tx, setting::PAUSED_SESSION_ID)?;
    tx.commit()?;
    Ok(ended)
}

fn paused(conn: &Connection) -> Result<Option<Session>> {
    match setting::get(conn, setting::PAUSED_SESSION_ID)? {
        Some(id) => Ok(get(conn, &id)?.filter(|s| s.end_ms.is_some())),
        None => Ok(None),
    }
}

pub fn current(conn: &Connection) -> Result<TimerState> {
    let running = running(conn)?;
    let paused = if running.is_some() { None } else { paused(conn)? };
    Ok(TimerState { running, paused })
}

/// Sessions overlapping `[from_ms, to_ms)`, including a running one.
pub fn list(conn: &Connection, from_ms: i64, to_ms: i64) -> Result<Vec<Session>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM session
         WHERE deleted_ms IS NULL AND start_ms < ?2 AND (end_ms IS NULL OR end_ms > ?1)
         ORDER BY start_ms"
    );
    let rows = conn
        .prepare(&sql)?
        .query_map([from_ms, to_ms], from_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Fails with `Overlap` if `[start, end)` intersects another live session (a running one ends at `now`).
fn check_overlap(conn: &Connection, id: Option<&str>, start: i64, end: Option<i64>, now: i64) -> Result<()> {
    let end = end.unwrap_or(now.max(start));
    let clashes: i64 = conn.query_row(
        "SELECT COUNT(*) FROM session
         WHERE deleted_ms IS NULL AND id IS NOT ?1 AND start_ms < ?3 AND COALESCE(end_ms, ?4) > ?2",
        params![id, start, end, now],
        |r| r.get(0),
    )?;
    if clashes > 0 { Err(Error::Overlap) } else { Ok(()) }
}

/// Edits or adds a session by hand. Overlapping another session is rejected, never trimmed.
pub fn upsert(conn: &Connection, device: &str, now: i64, input: SessionInput) -> Result<Session> {
    if let Some(end) = input.end_ms {
        if end < input.start_ms {
            return Err(Error::Invalid("session ends before it starts".into()));
        }
    }
    check_overlap(conn, input.id.as_deref(), input.start_ms, input.end_ms, now)?;
    let note = input.note.as_deref().map(str::trim).filter(|n| !n.is_empty());
    let id = match input.id {
        Some(id) => {
            let existing = get(conn, &id)?.ok_or(Error::NotFound("session"))?;
            if input.end_ms.is_none() && existing.end_ms.is_some() {
                return Err(Error::Invalid("cannot reopen a finished session".into()));
            }
            conn.execute(
                "UPDATE session SET activity_id = ?2, start_ms = ?3, end_ms = ?4, note = ?5,
                     updated_ms = MAX(?6, updated_ms + 1), device_id = ?7, dirty = 1
                 WHERE id = ?1",
                params![id, input.activity_id, input.start_ms, input.end_ms, note, now, device],
            )?;
            id
        }
        None => {
            let end = input.end_ms.ok_or_else(|| Error::Invalid("use start to begin a running session".into()))?;
            let id = new_id();
            conn.execute(
                "INSERT INTO session (id, activity_id, start_ms, end_ms, note, updated_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, input.activity_id, input.start_ms, end, note, now, device],
            )?;
            id
        }
    };
    get(conn, &id)?.ok_or(Error::NotFound("session"))
}

/// Saves several sessions (e.g. every segment of a pause chain) all-or-nothing.
pub fn upsert_many(conn: &mut Connection, device: &str, now: i64, inputs: Vec<SessionInput>) -> Result<Vec<Session>> {
    let tx = conn.transaction()?;
    let saved = inputs.into_iter().map(|i| upsert(&tx, device, now, i)).collect::<Result<Vec<_>>>()?;
    tx.commit()?;
    Ok(saved)
}

/// Soft-deletes several sessions all-or-nothing.
pub fn delete_many(conn: &mut Connection, device: &str, now: i64, ids: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    for id in ids {
        delete(&tx, device, now, id)?;
    }
    if let Some(paused) = setting::get(&tx, setting::PAUSED_SESSION_ID)? {
        if ids.contains(&paused) {
            setting::remove(&tx, setting::PAUSED_SESSION_ID)?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Soft delete.
pub fn delete(conn: &Connection, device: &str, now: i64, id: &str) -> Result<()> {
    let changed = conn.execute(
        "UPDATE session SET deleted_ms = ?2, updated_ms = MAX(?2, updated_ms + 1), device_id = ?3, dirty = 1
         WHERE id = ?1 AND deleted_ms IS NULL",
        params![id, now, device],
    )?;
    if changed == 0 {
        return Err(Error::NotFound("session"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::activity::{upsert as add_activity, ActivityColor, ActivityInput};
    use crate::db::test_conn;

    fn activity(conn: &Connection, name: &str) -> String {
        add_activity(
            conn,
            "d",
            0,
            ActivityInput { id: None, name: name.into(), color: ActivityColor::Blue, symbol: None, sort: None, parent_id: None },
        )
        .unwrap()
        .id
    }

    #[test]
    fn starting_ends_the_previous_session() {
        let mut conn = test_conn();
        let (a, b) = (activity(&conn, "A"), activity(&conn, "B"));
        let first = start(&mut conn, "d", 100, &a).unwrap();
        let second = start(&mut conn, "d", 200, &b).unwrap();

        assert_eq!(get(&conn, &first.id).unwrap().unwrap().end_ms, Some(200));
        let state = current(&conn).unwrap();
        assert_eq!(state.running.unwrap().id, second.id);
        assert!(state.paused.is_none());
    }

    #[test]
    fn pause_then_resume_links_the_chain() {
        let mut conn = test_conn();
        let a = activity(&conn, "A");
        let first = start(&mut conn, "d", 100, &a).unwrap();
        let paused_s = pause(&mut conn, "d", 150).unwrap().unwrap();
        assert_eq!(paused_s.end_ms, Some(150));

        let state = current(&conn).unwrap();
        assert!(state.running.is_none());
        assert_eq!(state.paused.unwrap().id, first.id);

        let resumed = resume(&mut conn, "d", 300).unwrap();
        assert_eq!(resumed.continues_id.as_deref(), Some(first.id.as_str()));
        assert_eq!(resumed.activity_id, a);
        assert!(current(&conn).unwrap().paused.is_none());
    }

    #[test]
    fn stop_clears_pause() {
        let mut conn = test_conn();
        let a = activity(&conn, "A");
        start(&mut conn, "d", 100, &a).unwrap();
        pause(&mut conn, "d", 150).unwrap();
        stop(&mut conn, "d", 160).unwrap();
        let state = current(&conn).unwrap();
        assert!(state.running.is_none() && state.paused.is_none());
        assert!(matches!(resume(&mut conn, "d", 170), Err(Error::NotFound(_))));
    }

    #[test]
    fn start_rejects_unknown_activity() {
        let mut conn = test_conn();
        assert!(matches!(start(&mut conn, "d", 1, "missing"), Err(Error::NotFound(_))));
    }

    #[test]
    fn list_returns_overlapping_and_running() {
        let mut conn = test_conn();
        let a = activity(&conn, "A");
        let mk = |s, e| SessionInput { id: None, activity_id: a.clone(), start_ms: s, end_ms: Some(e), note: None };
        upsert(&conn, "d", 0, mk(0, 50)).unwrap(); // before
        let overlap = upsert(&conn, "d", 0, mk(90, 110)).unwrap();
        upsert(&conn, "d", 0, mk(200, 250)).unwrap(); // after
        let run = start(&mut conn, "d", 150, &a).unwrap();

        let ids: Vec<_> = list(&conn, 100, 200).unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, [overlap.id, run.id]);
    }

    #[test]
    fn upsert_validates_and_delete_hides() {
        let conn = test_conn();
        let a = activity(&conn, "A");
        let bad = SessionInput { id: None, activity_id: a.clone(), start_ms: 10, end_ms: Some(5), note: None };
        assert!(matches!(upsert(&conn, "d", 0, bad), Err(Error::Invalid(_))));
        let open = SessionInput { id: None, activity_id: a.clone(), start_ms: 10, end_ms: None, note: None };
        assert!(matches!(upsert(&conn, "d", 0, open), Err(Error::Invalid(_))));

        let s = upsert(
            &conn,
            "d",
            0,
            SessionInput { id: None, activity_id: a, start_ms: 10, end_ms: Some(20), note: Some("  ".into()) },
        )
        .unwrap();
        assert_eq!(s.note, None);
        delete(&conn, "d", 30, &s.id).unwrap();
        assert!(list(&conn, 0, 100).unwrap().is_empty());
    }

    #[test]
    fn manual_edits_cannot_overlap() {
        let mut conn = test_conn();
        let a = activity(&conn, "A");
        let mk = |id: Option<String>, s, e| SessionInput { id, activity_id: a.clone(), start_ms: s, end_ms: Some(e), note: None };
        let first = upsert(&conn, "d", 0, mk(None, 100, 200)).unwrap();
        upsert(&conn, "d", 0, mk(None, 200, 300)).unwrap(); // touching is fine
        assert!(matches!(upsert(&conn, "d", 0, mk(None, 150, 250)), Err(Error::Overlap)));
        assert!(matches!(upsert(&conn, "d", 0, mk(Some(first.id.clone()), 100, 210)), Err(Error::Overlap)));
        upsert(&conn, "d", 0, mk(Some(first.id), 90, 200)).unwrap(); // editing itself is not a clash

        start(&mut conn, "d", 1000, &a).unwrap(); // running from 1000, counts until now
        assert!(matches!(upsert(&conn, "d", 1500, mk(None, 1200, 1300)), Err(Error::Overlap)));
        upsert(&conn, "d", 1500, mk(None, 600, 900)).unwrap();
    }

    #[test]
    fn saving_many_is_all_or_nothing() {
        let mut conn = test_conn();
        let a = activity(&conn, "A");
        let mk = |s, e| SessionInput { id: None, activity_id: a.clone(), start_ms: s, end_ms: Some(e), note: None };
        upsert(&conn, "d", 0, mk(500, 600)).unwrap();
        let res = upsert_many(&mut conn, "d", 0, vec![mk(100, 200), mk(550, 650)]);
        assert!(matches!(res, Err(Error::Overlap)));
        assert_eq!(list(&conn, 0, 1000).unwrap().len(), 1, "first segment rolled back");
    }

    #[test]
    fn orphan_sessions_still_listed() {
        // No foreign keys: a session whose activity is unknown must survive.
        let conn = test_conn();
        let s = SessionInput { id: None, activity_id: "gone".into(), start_ms: 0, end_ms: Some(10), note: None };
        upsert(&conn, "d", 0, s).unwrap();
        assert_eq!(list(&conn, 0, 10).unwrap().len(), 1);
    }
}

//! JSON import / export (rebuild-plan 3.3): the only way data enters or leaves the app.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::activity::ActivityColor;
use super::day::{self, DayInput};
use super::plan::{self, PlanInput};
use super::{new_id, validate};
use crate::error::{Error, Result};

pub const FORMAT: &str = "hope/1";

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportFile {
    pub format: String,
    #[serde(default)]
    pub exported_at: i64,
    #[serde(default)]
    pub activity: Vec<ActivityRow>,
    #[serde(default)]
    pub session: Vec<SessionRow>,
    #[serde(default)]
    pub plan: Vec<PlanRow>,
    #[serde(default)]
    pub journal: Vec<JournalRow>,
    /// Added in schema v2; absent in older files.
    #[serde(default)]
    pub day: Vec<DayRow>,
}

// Rows: `id` and `updated_ms` may be missing on import (generated / set to now).

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct ActivityRow {
    pub id: Option<String>,
    pub name: String,
    pub color: ActivityColor,
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub sort: i64,
    #[serde(default)]
    pub archived_at: Option<i64>,
    /// Added in schema v2; absent in older files.
    #[serde(default)]
    pub parent_id: Option<String>,
    pub updated_ms: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct SessionRow {
    pub id: Option<String>,
    pub activity_id: String,
    pub start_ms: i64,
    pub end_ms: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub continues_id: Option<String>,
    /// Added in schema v2; absent in older files.
    #[serde(default)]
    pub plan_id: Option<String>,
    pub updated_ms: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct PlanRow {
    pub id: Option<String>,
    pub activity_id: String,
    pub date: String,
    pub start_hm: String,
    pub end_hm: String,
    #[serde(default)]
    pub rule: Option<String>,
    /// Added in schema v2; older files mean "on".
    #[serde(default = "default_true")]
    pub auto_log: bool,
    /// Added in schema v2; absent in older files.
    #[serde(default)]
    pub until: Option<String>,
    pub updated_ms: Option<i64>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct JournalRow {
    pub id: Option<String>,
    pub date: String,
    pub text: String,
    pub updated_ms: Option<i64>,
}

/// Keyed by `date` (one row per day), not by a UUID.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct DayRow {
    pub date: String,
    #[serde(default)]
    pub wake_ms: Option<i64>,
    #[serde(default)]
    pub sleep_ms: Option<i64>,
    pub utc_offset_min: i32,
    pub updated_ms: Option<i64>,
}

/// Per-table counts shown to the user after an import.
#[derive(Debug, Default, Clone, Serialize, Type, PartialEq)]
pub struct TableCounts {
    pub added: u32,
    pub updated: u32,
    /// Already present with an equal or newer `updated_ms`.
    pub unchanged: u32,
}

#[derive(Debug, Default, Clone, Serialize, Type)]
pub struct ImportReport {
    pub activity: TableCounts,
    pub session: TableCounts,
    pub plan: TableCounts,
    pub journal: TableCounts,
    pub day: TableCounts,
}

/// Every live row, in the same shape `import` reads.
pub fn export(conn: &Connection, now: i64) -> Result<ExportFile> {
    let activity = conn
        .prepare(
            "SELECT id, name, color, symbol, sort, archived_at, parent_id, updated_ms FROM activity
             WHERE deleted_ms IS NULL ORDER BY sort, name",
        )?
        .query_map([], |r| {
            Ok(ActivityRow {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                symbol: r.get(3)?,
                sort: r.get(4)?,
                archived_at: r.get(5)?,
                parent_id: r.get(6)?,
                updated_ms: r.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let session = conn
        .prepare(
            "SELECT id, activity_id, start_ms, end_ms, note, continues_id, plan_id, updated_ms FROM session
             WHERE deleted_ms IS NULL ORDER BY start_ms",
        )?
        .query_map([], |r| {
            Ok(SessionRow {
                id: r.get(0)?,
                activity_id: r.get(1)?,
                start_ms: r.get(2)?,
                end_ms: r.get(3)?,
                note: r.get(4)?,
                continues_id: r.get(5)?,
                plan_id: r.get(6)?,
                updated_ms: r.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let plan = conn
        .prepare(
            "SELECT id, activity_id, date, start_hm, end_hm, rule, auto_log, until, updated_ms FROM plan
             WHERE deleted_ms IS NULL ORDER BY date, start_hm",
        )?
        .query_map([], |r| {
            Ok(PlanRow {
                id: r.get(0)?,
                activity_id: r.get(1)?,
                date: r.get(2)?,
                start_hm: r.get(3)?,
                end_hm: r.get(4)?,
                rule: r.get(5)?,
                auto_log: r.get(6)?,
                until: r.get(7)?,
                updated_ms: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let journal = conn
        .prepare("SELECT id, date, text, updated_ms FROM journal WHERE deleted_ms IS NULL ORDER BY date")?
        .query_map([], |r| Ok(JournalRow { id: r.get(0)?, date: r.get(1)?, text: r.get(2)?, updated_ms: r.get(3)? }))?
        .collect::<rusqlite::Result<_>>()?;
    let day = conn
        .prepare("SELECT date, wake_ms, sleep_ms, utc_offset_min, updated_ms FROM day WHERE deleted_ms IS NULL ORDER BY date")?
        .query_map([], |r| {
            Ok(DayRow { date: r.get(0)?, wake_ms: r.get(1)?, sleep_ms: r.get(2)?, utc_offset_min: r.get(3)?, updated_ms: r.get(4)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ExportFile { format: FORMAT.into(), exported_at: now, activity, session, plan, journal, day })
}

pub fn parse(json: &str) -> Result<ExportFile> {
    let file: ExportFile = serde_json::from_str(json).map_err(|e| Error::Invalid(format!("not a Hope export: {e}")))?;
    if file.format != FORMAT {
        return Err(Error::Invalid(format!("unsupported format {:?}, expected {FORMAT:?}", file.format)));
    }
    Ok(file)
}

/// Upserts every row by `id`, newer `updated_ms` wins. All or nothing.
pub fn import(conn: &mut Connection, device: &str, now: i64, file: ExportFile) -> Result<ImportReport> {
    let tx = conn.transaction()?;
    let mut report = ImportReport::default();

    for row in file.activity {
        if row.name.trim().is_empty() {
            return Err(Error::Invalid("activity with an empty name".into()));
        }
        let (id, ms) = (row.id.unwrap_or_else(new_id), row.updated_ms.unwrap_or(now));
        let action = decide(&tx, "activity", &id, ms)?;
        if action != Action::Skip {
            tx.execute(
                "INSERT INTO activity (id, name, color, symbol, sort, archived_at, parent_id, updated_ms, deleted_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9)
                 ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color,
                   symbol = excluded.symbol, sort = excluded.sort, archived_at = excluded.archived_at,
                   parent_id = excluded.parent_id,
                   updated_ms = excluded.updated_ms, deleted_ms = NULL, device_id = excluded.device_id",
                params![id, row.name.trim(), row.color, row.symbol, row.sort, row.archived_at, row.parent_id, ms, device],
            )?;
        }
        action.count(&mut report.activity);
    }

    for row in file.session {
        if row.end_ms.is_some_and(|e| e < row.start_ms) {
            return Err(Error::Invalid("session ends before it starts".into()));
        }
        let (id, ms) = (row.id.unwrap_or_else(new_id), row.updated_ms.unwrap_or(now));
        let action = decide(&tx, "session", &id, ms)?;
        if action != Action::Skip {
            let note = row.note.as_deref().map(str::trim).filter(|n| !n.is_empty());
            tx.execute(
                "INSERT INTO session (id, activity_id, start_ms, end_ms, note, continues_id, plan_id, updated_ms, deleted_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9)
                 ON CONFLICT (id) DO UPDATE SET activity_id = excluded.activity_id, start_ms = excluded.start_ms,
                   end_ms = excluded.end_ms, note = excluded.note, continues_id = excluded.continues_id,
                   plan_id = excluded.plan_id,
                   updated_ms = excluded.updated_ms, deleted_ms = NULL, device_id = excluded.device_id",
                params![id, row.activity_id, row.start_ms, row.end_ms, note, row.continues_id, row.plan_id, ms, device],
            )?;
        }
        action.count(&mut report.session);
    }

    for row in file.plan {
        let input = PlanInput {
            id: None,
            activity_id: row.activity_id,
            date: row.date,
            start_hm: row.start_hm,
            end_hm: row.end_hm,
            rule: row.rule,
            auto_log: row.auto_log,
            until: row.until.clone(),
        };
        let rule = plan::check(&input)?;
        let (id, ms) = (row.id.unwrap_or_else(new_id), row.updated_ms.unwrap_or(now));
        let action = decide(&tx, "plan", &id, ms)?;
        if action != Action::Skip {
            tx.execute(
                "INSERT INTO plan (id, activity_id, date, start_hm, end_hm, rule, auto_log, until, updated_ms, deleted_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10)
                 ON CONFLICT (id) DO UPDATE SET activity_id = excluded.activity_id, date = excluded.date,
                   start_hm = excluded.start_hm, end_hm = excluded.end_hm, rule = excluded.rule,
                   auto_log = excluded.auto_log, until = excluded.until,
                   updated_ms = excluded.updated_ms, deleted_ms = NULL, device_id = excluded.device_id",
                params![id, input.activity_id, input.date, input.start_hm, input.end_hm, rule, row.auto_log, row.until, ms, device],
            )?;
        }
        action.count(&mut report.plan);
    }

    for row in file.journal {
        validate::date(&row.date)?;
        let (id, ms) = (row.id.unwrap_or_else(new_id), row.updated_ms.unwrap_or(now));
        let action = decide(&tx, "journal", &id, ms)?;
        if action != Action::Skip {
            tx.execute(
                "INSERT INTO journal (id, date, text, updated_ms, deleted_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4, NULL, ?5)
                 ON CONFLICT (id) DO UPDATE SET date = excluded.date, text = excluded.text,
                   updated_ms = excluded.updated_ms, deleted_ms = NULL, device_id = excluded.device_id",
                params![id, row.date, row.text, ms, device],
            )?;
        }
        action.count(&mut report.journal);
    }

    for row in file.day {
        let ms = row.updated_ms.unwrap_or(now);
        day::check(&DayInput { date: row.date.clone(), wake_ms: row.wake_ms, sleep_ms: row.sleep_ms, utc_offset_min: row.utc_offset_min })?;
        let existing: Option<i64> =
            tx.query_row("SELECT updated_ms FROM day WHERE date = ?1", [&row.date], |r| r.get(0)).optional()?;
        let action = match existing {
            None => Action::Insert,
            Some(old) if ms > old => Action::Update,
            Some(_) => Action::Skip,
        };
        if action != Action::Skip {
            tx.execute(
                "INSERT INTO day (date, wake_ms, sleep_ms, utc_offset_min, updated_ms, deleted_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)
                 ON CONFLICT (date) DO UPDATE SET wake_ms = excluded.wake_ms, sleep_ms = excluded.sleep_ms,
                   utc_offset_min = excluded.utc_offset_min, updated_ms = excluded.updated_ms,
                   deleted_ms = NULL, device_id = excluded.device_id",
                params![row.date, row.wake_ms, row.sleep_ms, row.utc_offset_min, ms, device],
            )?;
        }
        action.count(&mut report.day);
    }

    // An imported file may bring its own running session; keep the "one running, globally" rule.
    tx.execute(
        "UPDATE session SET end_ms = MAX(?1, start_ms), updated_ms = ?1, device_id = ?2
         WHERE end_ms IS NULL AND deleted_ms IS NULL
           AND id != (SELECT id FROM session WHERE end_ms IS NULL AND deleted_ms IS NULL
                      ORDER BY start_ms DESC LIMIT 1)",
        params![now, device],
    )?;

    tx.commit()?;
    Ok(report)
}

/// Soft-deletes every record (so the deletion also syncs). Local settings stay.
pub fn wipe(conn: &mut Connection, device: &str, now: i64) -> Result<()> {
    let tx = conn.transaction()?;
    for table in ["activity", "session", "plan", "journal", "day"] {
        tx.execute(
            &format!("UPDATE {table} SET deleted_ms = ?1, updated_ms = ?1, device_id = ?2 WHERE deleted_ms IS NULL"),
            params![now, device],
        )?;
    }
    super::setting::remove(&tx, super::setting::PAUSED_SESSION_ID)?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum Action {
    Insert,
    Update,
    Skip,
}

impl Action {
    fn count(&self, c: &mut TableCounts) {
        match self {
            Action::Insert => c.added += 1,
            Action::Update => c.updated += 1,
            Action::Skip => c.unchanged += 1,
        }
    }
}

/// Last write wins: the incoming row applies only if it is newer than what we have
/// (including a local soft delete, which also bumps `updated_ms`).
fn decide(tx: &Transaction<'_>, table: &str, id: &str, incoming_ms: i64) -> Result<Action> {
    let sql = format!("SELECT updated_ms FROM {table} WHERE id = ?1");
    let existing: Option<i64> = tx.query_row(&sql, [id], |r| r.get(0)).optional()?;
    Ok(match existing {
        None => Action::Insert,
        Some(ms) if incoming_ms > ms => Action::Update,
        Some(_) => Action::Skip,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::activity::{self, ActivityInput};
    use crate::db::{journal, session, test_conn};

    fn seeded() -> Connection {
        let mut conn = test_conn();
        let a = activity::upsert(
            &conn,
            "d",
            10,
            ActivityInput { id: None, name: "Read".into(), color: ActivityColor::Green, symbol: Some("book".into()), sort: None, parent_id: None },
        )
        .unwrap();
        let linalg = activity::upsert(
            &conn,
            "d",
            11,
            ActivityInput { id: None, name: "Linear algebra".into(), color: ActivityColor::Green, symbol: None, sort: None, parent_id: Some(a.id.clone()) },
        )
        .unwrap();
        session::start(&mut conn, "d", 100, &linalg.id).unwrap();
        session::stop(&mut conn, "d", 200).unwrap();
        plan::upsert(
            &conn,
            "d",
            20,
            PlanInput {
                id: None,
                activity_id: a.id.clone(),
                date: "2026-10-01".into(),
                start_hm: "09:00".into(),
                end_hm: "10:00".into(),
                rule: Some("weekly:1,3".into()),
                auto_log: false,
                until: Some("2026-12-31".into()),
            },
        )
        .unwrap();
        journal::upsert(&conn, "d", 30, "2026-10-02", "hi").unwrap();
        day::set(&conn, "d", 40, DayInput { date: "2026-10-02".into(), wake_ms: Some(1), sleep_ms: Some(2), utc_offset_min: 480 }).unwrap();
        conn
    }

    #[test]
    fn export_import_round_trip_is_lossless() {
        let source = seeded();
        let exported = export(&source, 999).unwrap();
        let json = serde_json::to_string(&exported).unwrap();

        let mut target = test_conn();
        let report = import(&mut target, "other", 1000, parse(&json).unwrap()).unwrap();
        assert_eq!(report.activity.added, 2);
        assert_eq!(report.session.added, 1);
        assert_eq!(report.plan.added, 1);
        assert_eq!(report.journal.added, 1);
        assert_eq!(report.day.added, 1);

        let again = export(&target, 999).unwrap();
        assert_eq!(serde_json::to_value(&again).unwrap(), serde_json::to_value(&exported).unwrap());

        // Importing the same file twice changes nothing.
        let second = import(&mut target, "other", 1001, parse(&json).unwrap()).unwrap();
        assert_eq!(second.session, TableCounts { added: 0, updated: 0, unchanged: 1 });
    }

    #[test]
    fn newer_rows_win_and_missing_ids_are_generated() {
        let mut conn = seeded();
        let id = export(&conn, 0).unwrap().activity.into_iter().find(|a| a.parent_id.is_none()).unwrap().id;
        let json = format!(
            r#"{{"format":"hope/1","activity":[
                {{"id":{id:?},"name":"Reading","color":"blue","updated_ms":50}},
                {{"id":{id:?},"name":"Stale","color":"gray","updated_ms":1}},
                {{"name":"New","color":"pink"}}
            ]}}"#,
            id = id.unwrap()
        );
        let report = import(&mut conn, "d", 500, parse(&json).unwrap()).unwrap();
        assert_eq!(report.activity, TableCounts { added: 1, updated: 1, unchanged: 1 });
        let names: Vec<_> = activity::list(&conn, true).unwrap().into_iter().map(|a| a.name).collect();
        assert!(names.contains(&"Reading".to_string()) && names.contains(&"New".to_string()));
    }

    #[test]
    fn rejects_wrong_format_and_bad_rows_atomically() {
        assert!(matches!(parse(r#"{"format":"hope/2"}"#), Err(Error::Invalid(_))));
        assert!(matches!(parse("not json"), Err(Error::Invalid(_))));

        let mut conn = test_conn();
        let json = r#"{"format":"hope/1",
            "activity":[{"name":"Ok","color":"blue"}],
            "plan":[{"activity_id":"x","date":"2026-10-02","start_hm":"10:00","end_hm":"09:00"}]}"#;
        assert!(import(&mut conn, "d", 1, parse(json).unwrap()).is_err());
        assert!(activity::list(&conn, true).unwrap().is_empty(), "failed import must not leave partial data");
    }

    #[test]
    fn v1_files_without_new_fields_import_with_defaults() {
        let mut conn = test_conn();
        let json = r#"{"format":"hope/1",
            "activity":[{"id":"a","name":"Study","color":"blue","updated_ms":1}],
            "plan":[{"id":"p","activity_id":"a","date":"2026-10-01","start_hm":"09:00","end_hm":"10:00","rule":"weekly:1","updated_ms":1}]}"#;
        import(&mut conn, "d", 5, parse(json).unwrap()).unwrap();
        let out = export(&conn, 0).unwrap();
        assert_eq!(out.activity[0].parent_id, None);
        assert!(out.plan[0].auto_log, "plans from older files auto-log by default");
        assert_eq!(out.plan[0].until, None);
    }

    #[test]
    fn wipe_removes_everything_live() {
        let mut conn = seeded();
        wipe(&mut conn, "d", 999).unwrap();
        let out = export(&conn, 0).unwrap();
        assert!(out.activity.is_empty() && out.session.is_empty() && out.plan.is_empty() && out.journal.is_empty());
        assert!(out.day.is_empty());
    }

    #[test]
    fn keeps_a_single_running_session() {
        let mut conn = test_conn();
        let json = r#"{"format":"hope/1","session":[
            {"id":"s1","activity_id":"a","start_ms":100,"end_ms":null},
            {"id":"s2","activity_id":"a","start_ms":200,"end_ms":null}]}"#;
        import(&mut conn, "d", 300, parse(json).unwrap()).unwrap();
        let state = session::current(&conn).unwrap();
        assert_eq!(state.running.unwrap().id, "s2");
        assert_eq!(session::get(&conn, "s1").unwrap().unwrap().end_ms, Some(300));
    }
}

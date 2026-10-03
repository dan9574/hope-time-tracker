//! Recurring plans that log themselves (rebuild-plan 10 F).
//!
//! The page works out when each occurrence happens (that needs the local time zone) and sends the ones
//! that have ended. This module decides whether to log them and does it idempotently: ids are UUID v5
//! of plan + date, so devices that log the same occurrence independently produce the same rows.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use specta::Type;
use uuid::Uuid;

use super::validate;
use crate::error::Result;

/// Namespace for autolog ids. Never change it: the Swift apps derive the same ids from it.
pub const NAMESPACE: Uuid = Uuid::from_u128(0x6b9f_4c1e_8a2d_4f7b_9e3c_5d1a_2b4c_6e8f);

/// Pieces shorter than this (left between manual records) are not worth a record.
const MIN_PIECE_MS: i64 = 60_000;
const MAX_OCCURRENCE_MS: i64 = 24 * 3_600_000;

/// One occurrence of a recurring plan on a local date, as absolute times.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct Occurrence {
    pub plan_id: String,
    pub date: String,
    #[specta(type = specta_typescript::Number)]
    pub start_ms: i64,
    #[specta(type = specta_typescript::Number)]
    pub end_ms: i64,
}

/// Deterministic id of the `index`-th logged piece of an occurrence.
pub fn session_id(plan_id: &str, date: &str, index: usize) -> String {
    Uuid::new_v5(&NAMESPACE, format!("hope-autolog/{plan_id}/{date}/{index}").as_bytes()).to_string()
}

/// `[start, end)` minus the given intervals, in order.
fn uncovered(start: i64, end: i64, mut covered: Vec<(i64, i64)>) -> Vec<(i64, i64)> {
    covered.sort_unstable();
    let mut pieces = Vec::new();
    let mut cursor = start;
    for (s, e) in covered {
        if e <= cursor {
            continue;
        }
        if s >= end {
            break;
        }
        if s > cursor {
            pieces.push((cursor, s.min(end)));
        }
        cursor = cursor.max(e);
        if cursor >= end {
            break;
        }
    }
    if cursor < end {
        pieces.push((cursor, end));
    }
    pieces
}

/// Logs every eligible occurrence; returns how many sessions were created.
pub fn log(conn: &mut Connection, device: &str, now: i64, occurrences: &[Occurrence]) -> Result<u32> {
    let tx = conn.transaction()?;
    let mut created = 0;
    for occ in occurrences {
        if occ.end_ms > now || occ.end_ms <= occ.start_ms || occ.end_ms - occ.start_ms > MAX_OCCURRENCE_MS {
            continue;
        }
        if validate::date(&occ.date).is_err() {
            continue;
        }
        type PlanRow = (String, Option<String>, bool, String, Option<String>, i64);
        let plan: Option<PlanRow> = tx
            .query_row(
                "SELECT activity_id, rule, auto_log, date, until, updated_ms FROM plan WHERE id = ?1 AND deleted_ms IS NULL",
                [&occ.plan_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .optional()?;
        let Some((activity_id, rule, auto_log, first_day, until, plan_updated)) = plan else { continue };
        if rule.is_none() || !auto_log || occ.date < first_day || until.is_some_and(|u| occ.date > u) {
            continue;
        }
        // Editing a plan only affects the future, and a new plan never fills in the past.
        if occ.end_ms <= plan_updated {
            continue;
        }
        // Already logged — or logged and then deleted, which means "skipped that class". Either way, done.
        let done: i64 = tx.query_row(
            "SELECT COUNT(*) FROM session WHERE id = ?1 OR (plan_id = ?2 AND start_ms < ?4 AND end_ms > ?3)",
            params![session_id(&occ.plan_id, &occ.date, 0), occ.plan_id, occ.start_ms, occ.end_ms],
            |r| r.get(0),
        )?;
        if done > 0 {
            continue;
        }
        let covered: Vec<(i64, i64)> = tx
            .prepare(
                "SELECT start_ms, COALESCE(end_ms, ?3) FROM session
                 WHERE deleted_ms IS NULL AND start_ms < ?2 AND COALESCE(end_ms, ?3) > ?1",
            )?
            .query_map(params![occ.start_ms, occ.end_ms, now], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let pieces = uncovered(occ.start_ms, occ.end_ms, covered);
        for (index, (s, e)) in pieces.into_iter().filter(|(s, e)| e - s >= MIN_PIECE_MS).enumerate() {
            created += tx.execute(
                "INSERT OR IGNORE INTO session (id, activity_id, start_ms, end_ms, plan_id, updated_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![session_id(&occ.plan_id, &occ.date, index), activity_id, s, e, occ.plan_id, now, device],
            )? as u32;
        }
    }
    tx.commit()?;
    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::plan::{self, PlanInput};
    use crate::db::session::{self, SessionInput};
    use crate::db::test_conn;

    const M: i64 = 60_000;

    fn weekly(conn: &Connection, created_at: i64) -> String {
        plan::upsert(
            conn,
            "d",
            created_at,
            PlanInput {
                id: None,
                activity_id: "class".into(),
                date: "2026-09-01".into(),
                start_hm: "09:00".into(),
                end_hm: "10:00".into(),
                rule: Some("weekly:1".into()),
                auto_log: true,
                until: None,
            },
        )
        .unwrap()
        .id
    }

    fn occ(plan_id: &str, date: &str, start: i64) -> Occurrence {
        Occurrence { plan_id: plan_id.into(), date: date.into(), start_ms: start, end_ms: start + 60 * M }
    }

    #[test]
    fn uncovered_subtracts_intervals() {
        assert_eq!(uncovered(0, 100, vec![]), vec![(0, 100)]);
        assert_eq!(uncovered(0, 100, vec![(20, 40), (60, 120)]), vec![(0, 20), (40, 60)]);
        assert_eq!(uncovered(0, 100, vec![(-10, 200)]), vec![]);
        assert_eq!(uncovered(0, 100, vec![(30, 50), (40, 70)]), vec![(0, 30), (70, 100)]);
    }

    #[test]
    fn logs_once_with_deterministic_ids() {
        let mut conn = test_conn();
        let p = weekly(&conn, 0);
        let o = occ(&p, "2026-10-05", 1000 * M);
        assert_eq!(log(&mut conn, "a", 2000 * M, &[o.clone()]).unwrap(), 1);
        assert_eq!(log(&mut conn, "b", 2001 * M, &[o.clone()]).unwrap(), 0, "second run is a no-op");
        let s = session::get(&conn, &session_id(&p, "2026-10-05", 0)).unwrap().unwrap();
        assert_eq!((s.start_ms, s.end_ms, s.plan_id.as_deref()), (1000 * M, Some(1060 * M), Some(p.as_str())));
        assert_eq!(session_id(&p, "2026-10-05", 0), session_id(&p, "2026-10-05", 0));
    }

    #[test]
    fn deleting_a_logged_session_means_skipped() {
        let mut conn = test_conn();
        let p = weekly(&conn, 0);
        let o = occ(&p, "2026-10-05", 1000 * M);
        log(&mut conn, "d", 2000 * M, &[o.clone()]).unwrap();
        session::delete(&conn, "d", 2001 * M, &session_id(&p, "2026-10-05", 0)).unwrap();
        assert_eq!(log(&mut conn, "d", 2002 * M, &[o]).unwrap(), 0);
    }

    #[test]
    fn only_uncovered_parts_and_only_ended_occurrences() {
        let mut conn = test_conn();
        let p = weekly(&conn, 0);
        let manual = SessionInput { id: None, activity_id: "x".into(), start_ms: 1020 * M, end_ms: Some(1030 * M), note: None };
        session::upsert(&conn, "d", 0, manual).unwrap();

        let o = occ(&p, "2026-10-05", 1000 * M);
        assert_eq!(log(&mut conn, "d", 1050 * M, &[o.clone()]).unwrap(), 0, "not over yet");
        assert_eq!(log(&mut conn, "d", 1100 * M, &[o]).unwrap(), 2, "before and after the manual record");
        let logged = session::list(&conn, 0, 2000 * M).unwrap().into_iter().filter(|s| s.plan_id.is_some()).count();
        assert_eq!(logged, 2);
    }

    #[test]
    fn respects_switch_dates_and_edits() {
        let mut conn = test_conn();
        let p = weekly(&conn, 5000 * M); // created/edited at 5000
        assert_eq!(log(&mut conn, "d", 9000 * M, &[occ(&p, "2026-10-05", 1000 * M)]).unwrap(), 0, "before the last edit");
        assert_eq!(log(&mut conn, "d", 9000 * M, &[occ(&p, "2026-08-31", 6000 * M)]).unwrap(), 0, "before the first day");
        conn.execute("UPDATE plan SET auto_log = 0", []).unwrap();
        assert_eq!(log(&mut conn, "d", 9000 * M, &[occ(&p, "2026-10-12", 6000 * M)]).unwrap(), 0, "switched off");
        conn.execute("UPDATE plan SET auto_log = 1, until = '2026-10-10'", []).unwrap();
        assert_eq!(log(&mut conn, "d", 9000 * M, &[occ(&p, "2026-10-12", 6000 * M)]).unwrap(), 0, "after until");
        assert_eq!(log(&mut conn, "d", 9000 * M, &[occ(&p, "2026-10-05", 6000 * M)]).unwrap(), 1);
    }
}

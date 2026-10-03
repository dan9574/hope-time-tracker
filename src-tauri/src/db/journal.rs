use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use specta::Type;

use super::plan::DateRange;
use super::{new_id, validate};
use crate::error::{Error, Result};

/// One journal per day. Sync could leave two live rows for a date; reads take the newest.
#[derive(Debug, Clone, Serialize, Type)]
pub struct Journal {
    pub id: String,
    pub date: String,
    pub text: String,
}

const COLUMNS: &str = "id, date, text";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Journal> {
    Ok(Journal { id: r.get(0)?, date: r.get(1)?, text: r.get(2)? })
}

fn for_date(conn: &Connection, date: &str) -> Result<Option<Journal>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM journal WHERE date = ?1 AND deleted_ms IS NULL ORDER BY updated_ms DESC LIMIT 1"
    );
    Ok(conn.query_row(&sql, [date], from_row).optional()?)
}

pub fn list(conn: &Connection, range: &DateRange) -> Result<Vec<Journal>> {
    // Newest row per date.
    let sql = format!(
        "SELECT {COLUMNS} FROM journal j
         WHERE deleted_ms IS NULL AND date BETWEEN ?1 AND ?2
           AND updated_ms = (SELECT MAX(updated_ms) FROM journal
                             WHERE date = j.date AND deleted_ms IS NULL)
         GROUP BY date ORDER BY date"
    );
    let rows = conn
        .prepare(&sql)?
        .query_map([&range.from, &range.to], from_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Saves the day's text. Blank text removes the entry; returns `None` then.
pub fn upsert(conn: &Connection, device: &str, now: i64, date: &str, text: &str) -> Result<Option<Journal>> {
    validate::date(date)?;
    let existing = for_date(conn, date)?;
    if text.trim().is_empty() {
        if let Some(j) = existing {
            delete(conn, device, now, &j.id)?;
        }
        return Ok(None);
    }
    match existing {
        Some(j) => {
            conn.execute(
                "UPDATE journal SET text = ?2, updated_ms = ?3, device_id = ?4 WHERE id = ?1",
                params![j.id, text, now, device],
            )?;
        }
        None => {
            conn.execute(
                "INSERT INTO journal (id, date, text, updated_ms, device_id) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![new_id(), date, text, now, device],
            )?;
        }
    }
    for_date(conn, date)
}

pub fn delete(conn: &Connection, device: &str, now: i64, id: &str) -> Result<()> {
    let changed = conn.execute(
        "UPDATE journal SET deleted_ms = ?2, updated_ms = ?2, device_id = ?3 WHERE id = ?1 AND deleted_ms IS NULL",
        params![id, now, device],
    )?;
    if changed == 0 {
        return Err(Error::NotFound("journal"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    #[test]
    fn one_entry_per_day_and_blank_deletes() {
        let conn = test_conn();
        let first = upsert(&conn, "d", 1, "2026-10-02", "hello").unwrap().unwrap();
        let second = upsert(&conn, "d", 2, "2026-10-02", "hello again").unwrap().unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(second.text, "hello again");

        let range = DateRange { from: "2026-10-01".into(), to: "2026-10-31".into() };
        assert_eq!(list(&conn, &range).unwrap().len(), 1);

        assert!(upsert(&conn, "d", 3, "2026-10-02", "  ").unwrap().is_none());
        assert!(list(&conn, &range).unwrap().is_empty());
    }

    #[test]
    fn duplicate_rows_from_sync_read_newest() {
        let conn = test_conn();
        for (id, text, ms) in [("x", "old", 1), ("y", "new", 5)] {
            conn.execute(
                "INSERT INTO journal (id, date, text, updated_ms, device_id) VALUES (?1, '2026-10-02', ?2, ?3, 'd')",
                params![id, text, ms],
            )
            .unwrap();
        }
        let range = DateRange { from: "2026-10-02".into(), to: "2026-10-02".into() };
        let rows = list(&conn, &range).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "new");
    }
}

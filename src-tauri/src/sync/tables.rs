//! The five synced tables and how one row moves between SQLite and JSON (rebuild-plan 12.1–12.3).
//!
//! Rows travel as JSON objects keyed by column name, exactly as PostgREST reads and writes them.
//! `dirty` is local-only; `user_id` and `server_seq` exist only on the server and are ignored here.

use std::cmp::Ordering;

use rusqlite::types::Value as Sql;
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde_json::{Map, Value as Json};

use super::error::SyncError;

pub type Row = Map<String, Json>;

pub struct Table {
    pub name: &'static str,
    /// Local primary key. On the server the key is `(user_id, <key>)`.
    pub key: &'static str,
    /// Every synced column, key first.
    pub columns: &'static [&'static str],
}

/// Order does not matter (there are no foreign keys); activities first just reads naturally.
pub const TABLES: [Table; 5] = [
    Table {
        name: "activity",
        key: "id",
        columns: &["id", "name", "color", "symbol", "sort", "archived_at", "parent_id", "updated_ms", "deleted_ms", "device_id"],
    },
    Table {
        name: "plan",
        key: "id",
        columns: &[
            "id", "activity_id", "date", "start_hm", "end_hm", "rule", "auto_log", "until", "updated_ms", "deleted_ms", "device_id",
        ],
    },
    Table {
        name: "session",
        key: "id",
        columns: &[
            "id", "activity_id", "start_ms", "end_ms", "note", "continues_id", "plan_id", "updated_ms", "deleted_ms", "device_id",
        ],
    },
    Table { name: "journal", key: "id", columns: &["id", "date", "text", "updated_ms", "deleted_ms", "device_id"] },
    Table {
        name: "day",
        key: "date",
        columns: &["date", "wake_ms", "sleep_ms", "utc_offset_min", "updated_ms", "deleted_ms", "device_id"],
    },
];

/// The pair that decides which copy of a row wins: later `updated_ms`, then the larger `device_id`
/// (compared bytewise, like `COLLATE "C"` on the server) so every device reaches the same answer.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    pub updated_ms: i64,
    pub device_id: String,
}

impl Version {
    pub fn of(row: &Row) -> Result<Self, SyncError> {
        let updated_ms = row.get("updated_ms").and_then(Json::as_i64).ok_or_else(|| SyncError::decode("row without updated_ms"))?;
        let device_id = row.get("device_id").and_then(Json::as_str).ok_or_else(|| SyncError::decode("row without device_id"))?;
        Ok(Self { updated_ms, device_id: device_id.to_owned() })
    }
}

pub fn key_of<'a>(table: &Table, row: &'a Row) -> Result<&'a str, SyncError> {
    row.get(table.key)
        .and_then(Json::as_str)
        .ok_or_else(|| SyncError::decode(format!("{} row without {}", table.name, table.key)))
}

fn to_json(v: Sql) -> Result<Json, SyncError> {
    Ok(match v {
        Sql::Null => Json::Null,
        Sql::Integer(i) => Json::from(i),
        Sql::Real(f) => Json::from(f),
        Sql::Text(s) => Json::from(s),
        Sql::Blob(_) => return Err(SyncError::decode("unexpected blob column")),
    })
}

fn to_sql(v: &Json) -> Result<Sql, SyncError> {
    Ok(match v {
        Json::Null => Sql::Null,
        Json::Bool(b) => Sql::Integer(i64::from(*b)),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Sql::Integer(i),
            None => Sql::Real(n.as_f64().ok_or_else(|| SyncError::decode("bad number"))?),
        },
        Json::String(s) => Sql::Text(s.clone()),
        Json::Array(_) | Json::Object(_) => return Err(SyncError::decode("nested value in a row")),
    })
}

/// Dirty rows with `rowid > after_rowid`, in rowid order. Keyset paging means a push walks each dirty
/// row once even if some stay dirty (edited again while the request was in flight).
pub fn read_dirty(conn: &Connection, table: &Table, after_rowid: i64, limit: usize) -> Result<Vec<(i64, Row)>, SyncError> {
    let sql = format!(
        "SELECT rowid, {} FROM {} WHERE dirty = 1 AND rowid > ?1 ORDER BY rowid LIMIT ?2",
        table.columns.join(", "),
        table.name
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params![after_rowid, limit as i64])?;
    let mut out = Vec::new();
    while let Some(r) = rows.next()? {
        let rowid: i64 = r.get(0)?;
        let mut row = Row::new();
        for (i, col) in table.columns.iter().enumerate() {
            row.insert((*col).to_owned(), to_json(r.get::<_, Sql>(i + 1)?)?);
        }
        out.push((rowid, row));
    }
    Ok(out)
}

/// What merging one server row did locally.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Merge {
    /// New row, or the server's copy is newer and replaced ours. Views must refresh.
    Applied,
    /// The server has exactly our version: the row is no longer dirty.
    Acknowledged,
    /// Ours is newer (or the same and already clean); kept, and left / marked dirty so it gets pushed.
    Kept,
}

/// Applies a row from the server with the server's own rule (rebuild-plan 12.1 / 12.3).
/// Used both for pulled rows and for the rows a push returns.
pub fn merge(conn: &Connection, table: &Table, row: &Row) -> Result<Merge, SyncError> {
    let key = key_of(table, row)?;
    let theirs = Version::of(row)?;
    let local: Option<(i64, String, bool)> = conn
        .query_row(
            &format!("SELECT updated_ms, device_id, dirty FROM {} WHERE {} = ?1", table.name, table.key),
            [key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;

    let values = table
        .columns
        .iter()
        .map(|c| to_sql(row.get(*c).unwrap_or(&Json::Null)))
        .collect::<Result<Vec<_>, _>>()?;

    let Some((ms, device, dirty)) = local else {
        let placeholders: Vec<String> = (1..=values.len()).map(|i| format!("?{i}")).collect();
        conn.execute(
            &format!(
                "INSERT INTO {} ({}, dirty) VALUES ({}, 0)",
                table.name,
                table.columns.join(", "),
                placeholders.join(", ")
            ),
            params_from_iter(values),
        )?;
        return Ok(Merge::Applied);
    };

    let ours = Version { updated_ms: ms, device_id: device };
    match theirs.cmp(&ours) {
        Ordering::Greater => {
            let sets: Vec<String> =
                table.columns.iter().enumerate().map(|(i, c)| format!("{c} = ?{}", i + 1)).collect();
            let key_param = values.len() + 1;
            let mut params = values;
            params.push(Sql::Text(key.to_owned()));
            conn.execute(
                &format!("UPDATE {} SET {}, dirty = 0 WHERE {} = ?{key_param}", table.name, sets.join(", "), table.key),
                params_from_iter(params),
            )?;
            Ok(Merge::Applied)
        }
        Ordering::Equal => {
            if dirty {
                conn.execute(&format!("UPDATE {} SET dirty = 0 WHERE {} = ?1", table.name, table.key), [key])?;
                Ok(Merge::Acknowledged)
            } else {
                Ok(Merge::Kept)
            }
        }
        Ordering::Less => {
            // Normally ours is still dirty. If it is not (e.g. it was synced to another account), make
            // sure it gets pushed rather than silently diverging from the server.
            if !dirty {
                conn.execute(&format!("UPDATE {} SET dirty = 1 WHERE {} = ?1", table.name, table.key), [key])?;
            }
            Ok(Merge::Kept)
        }
    }
}

/// After switching accounts every row must be offered to the new account, and its cursors restart.
pub fn reset_for_new_account(conn: &Connection) -> Result<(), SyncError> {
    for t in &TABLES {
        conn.execute(&format!("UPDATE {} SET dirty = 1 WHERE dirty = 0", t.name), [])?;
    }
    conn.execute("DELETE FROM setting WHERE key LIKE 'sync.cursor.%'", [])?;
    Ok(())
}

#[cfg(test)]
pub fn dirty_count(conn: &Connection) -> Result<u32, SyncError> {
    let mut n = 0;
    for t in &TABLES {
        let c: u32 = conn.query_row(&format!("SELECT COUNT(*) FROM {} WHERE dirty = 1", t.name), [], |r| r.get(0))?;
        n += c;
    }
    Ok(n)
}

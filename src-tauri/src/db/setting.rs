use rusqlite::{Connection, OptionalExtension};

use crate::error::Result;

pub const DEVICE_ID: &str = "device_id";
/// Session most recently ended by "pause"; cleared by start / resume / stop.
pub const PAUSED_SESSION_ID: &str = "paused_session_id";

pub fn get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM setting WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

pub fn set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO setting (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

pub fn remove(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("DELETE FROM setting WHERE key = ?1", [key])?;
    Ok(())
}

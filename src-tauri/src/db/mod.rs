pub mod activity;
pub mod day;
pub mod journal;
pub mod plan;
pub mod session;
pub mod setting;
pub mod transfer;
mod validate;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::error::Result;

/// Ordered list of migrations; index + 1 is the resulting `user_version`.
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/0001_init.sql"),
    include_str!("migrations/0002_subactivities_days_autolog.sql"),
];

pub struct Db {
    conn: Mutex<Connection>,
    path: PathBuf,
    device_id: String,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        migrate(&mut conn)?;
        let device_id = match setting::get(&conn, setting::DEVICE_ID)? {
            Some(id) => id,
            None => {
                let id = new_id();
                setting::set(&conn, setting::DEVICE_ID, &id)?;
                id
            }
        };
        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
            device_id,
        })
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        // A poisoned lock only means another command panicked mid-call;
        // SQLite itself is still consistent, so keep serving.
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }
}

/// All IDs are created here, never by the frontend.
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn schema_version(conn: &Connection) -> rusqlite::Result<u32> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let current = schema_version(conn)? as usize;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as u32)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
pub fn test_conn() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    conn
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_fresh_db_to_latest() {
        let mut conn = test_conn();
        assert_eq!(schema_version(&conn).unwrap() as usize, MIGRATIONS.len());

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(tables, ["activity", "day", "journal", "plan", "session", "setting"]);

        // Running again is a no-op.
        migrate(&mut conn).unwrap();
    }

    #[test]
    fn v1_databases_upgrade_in_place() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tx = conn.transaction().unwrap();
        tx.execute_batch(MIGRATIONS[0]).unwrap();
        tx.pragma_update(None, "user_version", 1).unwrap();
        tx.commit().unwrap();
        conn.execute(
            "INSERT INTO plan (id, activity_id, date, start_hm, end_hm, updated_ms, device_id)
             VALUES ('p', 'a', '2026-10-01', '09:00', '10:00', 0, 'd')",
            [],
        )
        .unwrap();

        migrate(&mut conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 2);
        let (auto_log, until): (i64, Option<String>) =
            conn.query_row("SELECT auto_log, until FROM plan WHERE id = 'p'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((auto_log, until), (1, None), "existing plans default to auto-log, no end date");
    }

    #[test]
    fn rejects_colors_outside_palette() {
        let conn = test_conn();
        let insert = "INSERT INTO activity (id, name, color, updated_ms, device_id) VALUES ('a', 'Read', ?1, 0, 'd')";
        assert!(conn.execute(insert, ["blue"]).is_ok());
        assert!(conn.execute(insert, ["#ff0000"]).is_err());
    }

    #[test]
    fn device_id_is_stable_across_opens() {
        let dir = std::env::temp_dir().join(format!("hope-test-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        let first = Db::open(&path).unwrap().device_id().to_owned();
        let second = Db::open(&path).unwrap().device_id().to_owned();
        assert_eq!(first, second);
        std::fs::remove_dir_all(dir).ok();
    }
}

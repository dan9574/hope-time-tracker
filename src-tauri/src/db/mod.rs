use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

/// Ordered list of migrations; index + 1 is the resulting `user_version`.
const MIGRATIONS: &[&str] = &[include_str!("migrations/0001_init.sql")];

pub struct Db {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        migrate(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
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
mod tests {
    use super::*;

    #[test]
    fn migrates_fresh_db_to_latest() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap() as usize, MIGRATIONS.len());

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(tables, ["activity", "journal", "plan", "session", "setting"]);

        // Running again is a no-op.
        migrate(&mut conn).unwrap();
    }

    #[test]
    fn rejects_colors_outside_palette() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        let insert = "INSERT INTO activity (id, name, color, updated_ms, device_id) VALUES ('a', 'Read', ?1, 0, 'd')";
        assert!(conn.execute(insert, ["blue"]).is_ok());
        assert!(conn.execute(insert, ["#ff0000"]).is_err());
    }
}

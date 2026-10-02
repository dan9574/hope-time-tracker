use rusqlite::OptionalExtension;
use tauri::State;

use super::CmdResult;
use crate::db::Db;

#[tauri::command]
#[specta::specta]
pub fn setting_get(db: State<'_, Db>, key: String) -> CmdResult<Option<String>> {
    let value = db
        .conn()
        .query_row("SELECT value FROM setting WHERE key = ?1", [&key], |r| r.get(0))
        .optional()?;
    Ok(value)
}

#[tauri::command]
#[specta::specta]
pub fn setting_set(db: State<'_, Db>, key: String, value: String) -> CmdResult<()> {
    db.conn().execute(
        "INSERT INTO setting (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [&key, &value],
    )?;
    Ok(())
}

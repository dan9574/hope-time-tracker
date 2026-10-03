use tauri::State;

use super::CmdResult;
use crate::db::{setting, Db};

#[tauri::command]
#[specta::specta]
pub fn setting_get(db: State<'_, Db>, key: String) -> CmdResult<Option<String>> {
    Ok(setting::get(&db.conn(), &key)?)
}

#[tauri::command]
#[specta::specta]
pub fn setting_set(db: State<'_, Db>, key: String, value: String) -> CmdResult<()> {
    Ok(setting::set(&db.conn(), &key, &value)?)
}

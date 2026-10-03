use tauri::{AppHandle, State};
use tauri_specta::Event;

use super::CmdResult;
use crate::db::{setting, Db};
use crate::events::SettingChanged;

#[tauri::command]
#[specta::specta]
pub fn setting_get(db: State<'_, Db>, key: String) -> CmdResult<Option<String>> {
    Ok(setting::get(&db.conn(), &key)?)
}

#[tauri::command]
#[specta::specta]
pub fn setting_set(app: AppHandle, db: State<'_, Db>, key: String, value: String) -> CmdResult<()> {
    setting::set(&db.conn(), &key, &value)?;
    let _ = SettingChanged { key }.emit(&app);
    Ok(())
}

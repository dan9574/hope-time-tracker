use tauri::{AppHandle, State};

use super::CmdResult;
use crate::db::journal::{self, Journal};
use crate::db::plan::DateRange;
use crate::db::{now_ms, Db};
use crate::events;

#[tauri::command]
#[specta::specta]
pub fn journal_list(db: State<'_, Db>, range: DateRange) -> CmdResult<Vec<Journal>> {
    Ok(journal::list(&db.conn(), &range)?)
}

/// Saves the day's entry; blank text removes it and returns `null`.
#[tauri::command]
#[specta::specta]
pub fn journal_upsert(app: AppHandle, db: State<'_, Db>, date: String, text: String) -> CmdResult<Option<Journal>> {
    let j = journal::upsert(&db.conn(), db.device_id(), now_ms(), &date, &text)?;
    events::data_changed(&app);
    Ok(j)
}

#[tauri::command]
#[specta::specta]
pub fn journal_delete(app: AppHandle, db: State<'_, Db>, id: String) -> CmdResult<()> {
    journal::delete(&db.conn(), db.device_id(), now_ms(), &id)?;
    events::data_changed(&app);
    Ok(())
}

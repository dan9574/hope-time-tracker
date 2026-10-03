use tauri::{AppHandle, State};

use super::CmdResult;
use crate::db::activity::{self, Activity, ActivityInput};
use crate::db::{now_ms, Db};
use crate::events;

#[tauri::command]
#[specta::specta]
pub fn activity_list(db: State<'_, Db>, include_archived: bool) -> CmdResult<Vec<Activity>> {
    Ok(activity::list(&db.conn(), include_archived)?)
}

#[tauri::command]
#[specta::specta]
pub fn activity_upsert(app: AppHandle, db: State<'_, Db>, input: ActivityInput) -> CmdResult<Activity> {
    let a = activity::upsert(&db.conn(), db.device_id(), now_ms(), input)?;
    events::data_changed(&app);
    Ok(a)
}

#[tauri::command]
#[specta::specta]
pub fn activity_archive(app: AppHandle, db: State<'_, Db>, id: String, archived: bool) -> CmdResult<()> {
    activity::set_archived(&db.conn(), db.device_id(), now_ms(), &id, archived)?;
    events::data_changed(&app);
    Ok(())
}

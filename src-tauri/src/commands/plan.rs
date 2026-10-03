use tauri::{AppHandle, State};

use super::CmdResult;
use crate::db::plan::{self, DateRange, Plan, PlanInput};
use crate::db::{now_ms, Db};
use crate::events;

/// One-off plans in the range plus recurring plans that have started; the frontend expands occurrences.
#[tauri::command]
#[specta::specta]
pub fn plan_list(db: State<'_, Db>, range: DateRange) -> CmdResult<Vec<Plan>> {
    Ok(plan::list(&db.conn(), &range)?)
}

#[tauri::command]
#[specta::specta]
pub fn plan_upsert(app: AppHandle, db: State<'_, Db>, input: PlanInput) -> CmdResult<Plan> {
    let p = plan::upsert(&db.conn(), db.device_id(), now_ms(), input)?;
    events::data_changed(&app);
    Ok(p)
}

#[tauri::command]
#[specta::specta]
pub fn plan_delete(app: AppHandle, db: State<'_, Db>, id: String) -> CmdResult<()> {
    plan::delete(&db.conn(), db.device_id(), now_ms(), &id)?;
    events::data_changed(&app);
    Ok(())
}

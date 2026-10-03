use tauri::{AppHandle, State};

use super::CmdResult;
use crate::db::autolog::{self, Occurrence};
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

/// Logs recurring-plan occurrences that have ended (the page sends today's and the past 30 days').
/// Returns how many sessions were created.
#[tauri::command]
#[specta::specta]
pub fn plan_autolog(app: AppHandle, db: State<'_, Db>, occurrences: Vec<Occurrence>) -> CmdResult<u32> {
    let created = autolog::log(&mut db.conn(), db.device_id(), now_ms(), &occurrences)?;
    if created > 0 {
        events::data_changed(&app);
    }
    Ok(created)
}

#[tauri::command]
#[specta::specta]
pub fn plan_delete(app: AppHandle, db: State<'_, Db>, id: String) -> CmdResult<()> {
    plan::delete(&db.conn(), db.device_id(), now_ms(), &id)?;
    events::data_changed(&app);
    Ok(())
}

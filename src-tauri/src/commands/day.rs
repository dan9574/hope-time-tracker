use tauri::{AppHandle, State};

use super::CmdResult;
use crate::db::day::{self, Day, DayInput};
use crate::db::plan::DateRange;
use crate::db::{now_ms, Db};
use crate::events;

#[tauri::command]
#[specta::specta]
pub fn day_list(db: State<'_, Db>, range: DateRange) -> CmdResult<Vec<Day>> {
    Ok(day::list(&db.conn(), &range)?)
}

/// Sets both times of a day by hand (editing the ring's end labels, undoing sleep).
#[tauri::command]
#[specta::specta]
pub fn day_set(app: AppHandle, db: State<'_, Db>, input: DayInput) -> CmdResult<Day> {
    let d = day::set(&db.conn(), db.device_id(), now_ms(), input)?;
    events::data_changed(&app);
    Ok(d)
}

/// "Wake up": records now. The page decides which local date that is.
#[tauri::command]
#[specta::specta]
pub fn day_wake_now(app: AppHandle, db: State<'_, Db>, date: String, utc_offset_min: i32) -> CmdResult<Day> {
    let d = day::wake_now(&db.conn(), db.device_id(), now_ms(), &date, utc_offset_min)?;
    events::data_changed(&app);
    Ok(d)
}

/// "Go to sleep": records now and stops the running timer.
#[tauri::command]
#[specta::specta]
pub fn day_sleep_now(app: AppHandle, db: State<'_, Db>, date: String, utc_offset_min: i32) -> CmdResult<Day> {
    let d = day::sleep_now(&mut db.conn(), db.device_id(), now_ms(), &date, utc_offset_min)?;
    events::data_changed(&app);
    Ok(d)
}

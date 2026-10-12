//! Timetable import (rebuild-plan 13.2–13.3). The page parses the file; Rust picks it and writes the result.

use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use super::CmdResult;
use crate::db::schedule::{self, ScheduleImport, ScheduleImportReport};
use crate::db::{now_ms, Db};
use crate::error::Error;
use crate::events;

/// A timetable is a few hundred events; anything far larger is not one.
const MAX_ICS_BYTES: u64 = 5 * 1024 * 1024;

/// Opens a file panel for an `.ics` file and returns its text. `None` if cancelled.
#[tauri::command]
#[specta::specta]
pub async fn ics_pick(app: AppHandle, window: WebviewWindow) -> CmdResult<Option<String>> {
    let Some(path) = app.dialog().file().set_parent(&window).add_filter("ICS", &["ics"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| Error::Invalid(e.to_string()))?;
    if std::fs::metadata(&path).map_err(Error::from)?.len() > MAX_ICS_BYTES {
        return Err(Error::Invalid("calendar file is larger than 5 MB".into()).into());
    }
    Ok(Some(std::fs::read_to_string(&path).map_err(Error::from)?))
}

/// Files parsed courses under the timetable group, all or nothing.
#[tauri::command]
#[specta::specta]
pub fn schedule_import(app: AppHandle, db: State<'_, Db>, input: ScheduleImport) -> CmdResult<ScheduleImportReport> {
    let report = schedule::import(&mut db.conn(), db.device_id(), now_ms(), input)?;
    events::data_changed(&app);
    Ok(report)
}

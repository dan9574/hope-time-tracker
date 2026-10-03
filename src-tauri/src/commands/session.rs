use serde::Deserialize;
use specta::Type;
use tauri::{AppHandle, State};

use super::CmdResult;
use crate::db::session::{self, Session, SessionInput, TimerState};
use crate::db::{now_ms, Db};
use crate::events;

#[tauri::command]
#[specta::specta]
pub fn session_start(app: AppHandle, db: State<'_, Db>, activity_id: String) -> CmdResult<Session> {
    let s = session::start(&mut db.conn(), db.device_id(), now_ms(), &activity_id)?;
    events::data_changed(&app);
    Ok(s)
}

#[tauri::command]
#[specta::specta]
pub fn session_pause(app: AppHandle, db: State<'_, Db>) -> CmdResult<Option<Session>> {
    let s = session::pause(&mut db.conn(), db.device_id(), now_ms())?;
    events::data_changed(&app);
    Ok(s)
}

#[tauri::command]
#[specta::specta]
pub fn session_resume(app: AppHandle, db: State<'_, Db>) -> CmdResult<Session> {
    let s = session::resume(&mut db.conn(), db.device_id(), now_ms())?;
    events::data_changed(&app);
    Ok(s)
}

#[tauri::command]
#[specta::specta]
pub fn session_stop(app: AppHandle, db: State<'_, Db>) -> CmdResult<Option<Session>> {
    let s = session::stop(&mut db.conn(), db.device_id(), now_ms())?;
    events::data_changed(&app);
    Ok(s)
}

#[tauri::command]
#[specta::specta]
pub fn session_current(db: State<'_, Db>) -> CmdResult<TimerState> {
    Ok(session::current(&db.conn())?)
}

/// Half-open `[from_ms, to_ms)`. The frontend computes day/week bounds in the system time zone.
#[derive(Debug, Deserialize, Type)]
pub struct TimeRange {
    #[specta(type = specta_typescript::Number)]
    pub from_ms: i64,
    #[specta(type = specta_typescript::Number)]
    pub to_ms: i64,
}

/// Sessions overlapping the range, including a running one.
#[tauri::command]
#[specta::specta]
pub fn session_list(db: State<'_, Db>, range: TimeRange) -> CmdResult<Vec<Session>> {
    Ok(session::list(&db.conn(), range.from_ms, range.to_ms)?)
}

#[tauri::command]
#[specta::specta]
pub fn session_upsert(app: AppHandle, db: State<'_, Db>, input: SessionInput) -> CmdResult<Session> {
    let s = session::upsert(&db.conn(), db.device_id(), now_ms(), input)?;
    events::data_changed(&app);
    Ok(s)
}

#[tauri::command]
#[specta::specta]
pub fn session_delete(app: AppHandle, db: State<'_, Db>, id: String) -> CmdResult<()> {
    session::delete(&db.conn(), db.device_id(), now_ms(), &id)?;
    events::data_changed(&app);
    Ok(())
}

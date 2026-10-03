use tauri::AppHandle;

use super::CmdResult;
use crate::overlay::{self, CardFrame};

#[tauri::command]
#[specta::specta]
pub fn overlay_show(app: AppHandle) -> CmdResult<()> {
    Ok(overlay::show(&app)?)
}

#[tauri::command]
#[specta::specta]
pub fn overlay_hide(app: AppHandle) -> CmdResult<()> {
    Ok(overlay::hide(&app)?)
}

/// `true` lifts the overlay so it can be dragged; `false` saves the position and sinks it back.
#[tauri::command]
#[specta::specta]
pub fn overlay_set_editing(app: AppHandle, editing: bool) -> CmdResult<()> {
    Ok(overlay::set_editing(&app, editing)?)
}

#[tauri::command]
#[specta::specta]
pub fn overlay_reset_position(app: AppHandle) -> CmdResult<()> {
    Ok(overlay::reset_position(&app)?)
}

/// Called by the overlay page whenever its cards move or resize.
#[tauri::command]
#[specta::specta]
pub fn overlay_layout(app: AppHandle, cards: Vec<CardFrame>) -> CmdResult<()> {
    Ok(overlay::set_layout(&app, cards)?)
}

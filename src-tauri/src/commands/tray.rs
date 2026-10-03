use tauri::{AppHandle, LogicalPosition, Window};

use super::CmdResult;
use crate::tray::{self, DayAction, TrayStrings};

#[tauri::command]
#[specta::specta]
pub fn tray_set_strings(app: AppHandle, strings: TrayStrings) {
    tray::set_strings(&app, strings);
}

/// The wake/sleep item the tray should offer now (`null` outside both time windows).
#[tauri::command]
#[specta::specta]
pub fn tray_set_day_action(app: AppHandle, action: Option<DayAction>) {
    tray::set_day_action(&app, action);
}

/// Shows the tray's timer menu below the main window's timer button (logical px).
#[tauri::command]
#[specta::specta]
pub fn timer_menu_popup(app: AppHandle, window: Window, x: i32, y: i32) -> CmdResult<()> {
    let menu = tray::build_menu(&app, false)?;
    window.popup_menu_at(&menu, LogicalPosition::new(x, y))?;
    Ok(())
}

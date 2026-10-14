use tauri::AppHandle;

use crate::break_reminder::{self, BreakStrings};

/// The break-reminder notification text, from the frontend's locale files (rebuild-plan 15.4).
#[tauri::command]
#[specta::specta]
pub fn break_set_strings(app: AppHandle, strings: BreakStrings) {
    break_reminder::set_strings(&app, strings);
}

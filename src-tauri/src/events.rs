use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;

use crate::tray;

/// Activities or sessions changed; views should refetch.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct DataChanged;

/// A local setting was written; windows that depend on it should re-read.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct SettingChanged {
    pub key: String,
}

/// Call after every mutation, from commands and from the tray alike.
pub fn data_changed(app: &AppHandle) {
    if let Err(e) = DataChanged.emit(app) {
        eprintln!("failed to emit DataChanged: {e}");
    }
    tray::refresh(app);
}

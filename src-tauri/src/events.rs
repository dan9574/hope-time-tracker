use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;

use crate::{sync, tray};

/// Activities or sessions changed; views should refetch.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct DataChanged;

/// A local setting was written; windows that depend on it should re-read.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct SettingChanged {
    pub key: String,
}

/// Call after every local mutation, from commands and from the tray alike. Also schedules a push.
pub fn data_changed(app: &AppHandle) {
    refresh_views(app);
    sync::notify_local_write(app);
}

/// A pull changed local data: refresh every window and the tray, but there is nothing to push.
pub fn data_changed_by_sync(app: &AppHandle) {
    refresh_views(app);
}

fn refresh_views(app: &AppHandle) {
    if let Err(e) = DataChanged.emit(app) {
        eprintln!("failed to emit DataChanged: {e}");
    }
    tray::refresh(app);
}

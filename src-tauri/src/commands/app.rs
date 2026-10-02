use serde::Serialize;
use tauri::{AppHandle, State};

use super::CmdResult;
use crate::db::{self, Db};

#[derive(Serialize, specta::Type)]
pub struct AppInfo {
    pub version: String,
    pub schema_version: u32,
    pub db_path: String,
}

#[tauri::command]
#[specta::specta]
pub fn app_info(app: AppHandle, db: State<'_, Db>) -> CmdResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        schema_version: db::schema_version(&db.conn())?,
        db_path: db.path().display().to_string(),
    })
}

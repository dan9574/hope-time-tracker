//! JSON import / export. File paths come only from native panels opened here, never from the page.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

use super::{CmdResult, CommandError};
use crate::db::transfer::{self, ImportReport};
use crate::db::{now_ms, Db};
use crate::error::Error;
use crate::events;

fn to_path(p: FilePath) -> Result<PathBuf, CommandError> {
    p.into_path().map_err(|e| Error::Invalid(e.to_string()).into())
}

/// Opens a save panel (attached to the window) and writes every live record. `None` if cancelled.
#[tauri::command]
#[specta::specta]
pub async fn data_export(app: AppHandle, window: WebviewWindow, default_name: String) -> CmdResult<Option<String>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("JSON", &["json"])
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = to_path(path)?;
    let file = {
        let db = app.state::<Db>();
        let conn = db.conn();
        transfer::export(&conn, now_ms())?
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| Error::Invalid(e.to_string()))?;
    std::fs::write(&path, json).map_err(Error::from)?;
    Ok(Some(path.display().to_string()))
}

/// Opens a file panel and merges the chosen export into the database. `None` if cancelled.
#[tauri::command]
#[specta::specta]
pub async fn data_import(app: AppHandle, window: WebviewWindow) -> CmdResult<Option<ImportReport>> {
    let Some(path) = app.dialog().file().set_parent(&window).add_filter("JSON", &["json"]).blocking_pick_file() else {
        return Ok(None);
    };
    let json = std::fs::read_to_string(to_path(path)?).map_err(Error::from)?;
    let file = transfer::parse(&json)?;
    let report = {
        let db = app.state::<Db>();
        let mut conn = db.conn();
        transfer::import(&mut conn, db.device_id(), now_ms(), file)?
    };
    events::data_changed(&app);
    Ok(Some(report))
}

/// The phrase the user must type before everything is cleared.
const WIPE_PHRASE: &str = "DELETE";

/// Clears all records after saving a JSON backup to the Downloads folder. Returns the backup path.
#[tauri::command]
#[specta::specta]
pub async fn data_wipe(app: AppHandle, confirmation: String, backup_name: String) -> CmdResult<String> {
    if confirmation != WIPE_PHRASE {
        return Err(Error::Invalid("confirmation phrase does not match".into()).into());
    }
    if backup_name.contains(['/', '\\']) || !backup_name.ends_with(".json") {
        return Err(Error::Invalid("bad backup file name".into()).into());
    }
    let path = app.path().download_dir()?.join(backup_name);
    let db = app.state::<Db>();
    let mut conn = db.conn();
    let json = serde_json::to_string_pretty(&transfer::export(&conn, now_ms())?).map_err(|e| Error::Invalid(e.to_string()))?;
    std::fs::write(&path, json).map_err(Error::from)?;
    transfer::wipe(&mut conn, db.device_id(), now_ms())?;
    drop(conn);
    events::data_changed(&app);
    Ok(path.display().to_string())
}

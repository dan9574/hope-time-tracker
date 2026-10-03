pub mod activity;
pub mod app;
pub mod overlay;
pub mod session;
pub mod setting;
pub mod tray;

use serde::Serialize;

/// Error returned to the frontend as a plain message string.
#[derive(Debug, Serialize, specta::Type)]
#[serde(transparent)]
pub struct CommandError(String);

impl From<crate::error::Error> for CommandError {
    fn from(e: crate::error::Error) -> Self {
        Self(e.to_string())
    }
}

impl From<rusqlite::Error> for CommandError {
    fn from(e: rusqlite::Error) -> Self {
        Self(e.to_string())
    }
}

impl From<tauri::Error> for CommandError {
    fn from(e: tauri::Error) -> Self {
        Self(e.to_string())
    }
}

pub type CmdResult<T> = Result<T, CommandError>;

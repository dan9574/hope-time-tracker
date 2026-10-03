pub mod activity;
pub mod app;
pub mod data;
pub mod day;
pub mod dialog;
pub mod journal;
pub mod overlay;
pub mod plan;
pub mod session;
pub mod setting;
pub mod tray;

use serde::Serialize;
use specta::Type;

use crate::error::Error;

/// Stable reason the frontend can turn into a localized message.
#[derive(Debug, Clone, Copy, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Invalid,
    NotFound,
    Overlap,
    InUse,
    Database,
    File,
    Internal,
}

/// Error returned to the frontend: a code for the UI plus the developer-facing message.
#[derive(Debug, Serialize, Type)]
pub struct CommandError {
    pub code: ErrorCode,
    pub message: String,
}

impl From<Error> for CommandError {
    fn from(e: Error) -> Self {
        let code = match &e {
            Error::Invalid(_) => ErrorCode::Invalid,
            Error::NotFound(_) => ErrorCode::NotFound,
            Error::Overlap => ErrorCode::Overlap,
            Error::InUse => ErrorCode::InUse,
            Error::Sql(_) => ErrorCode::Database,
            Error::Io(_) => ErrorCode::File,
            Error::Tauri(_) => ErrorCode::Internal,
        };
        Self { code, message: e.to_string() }
    }
}

impl From<rusqlite::Error> for CommandError {
    fn from(e: rusqlite::Error) -> Self {
        Error::from(e).into()
    }
}

impl From<tauri::Error> for CommandError {
    fn from(e: tauri::Error) -> Self {
        Error::from(e).into()
    }
}

pub type CmdResult<T> = Result<T, CommandError>;

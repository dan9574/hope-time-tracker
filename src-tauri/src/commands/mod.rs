pub mod app;
pub mod setting;

use serde::Serialize;

/// Error returned to the frontend as a plain message string.
#[derive(Debug, Serialize, specta::Type)]
#[serde(transparent)]
pub struct CommandError(String);

impl From<rusqlite::Error> for CommandError {
    fn from(e: rusqlite::Error) -> Self {
        Self(e.to_string())
    }
}

pub type CmdResult<T> = Result<T, CommandError>;

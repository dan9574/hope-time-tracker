use std::fmt;

#[derive(Debug)]
pub enum Error {
    Sql(rusqlite::Error),
    Tauri(tauri::Error),
    /// Input rejected by validation; the message is developer-facing.
    Invalid(String),
    NotFound(&'static str),
}

pub type Result<T> = std::result::Result<T, Error>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Sql(e) => write!(f, "database error: {e}"),
            Error::Tauri(e) => write!(f, "tauri error: {e}"),
            Error::Invalid(msg) => write!(f, "invalid input: {msg}"),
            Error::NotFound(what) => write!(f, "{what} not found"),
        }
    }
}

impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Sql(e)
    }
}

impl From<tauri::Error> for Error {
    fn from(e: tauri::Error) -> Self {
        Error::Tauri(e)
    }
}

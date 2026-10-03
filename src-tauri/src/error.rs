use std::fmt;

#[derive(Debug)]
pub enum Error {
    Sql(rusqlite::Error),
    Tauri(tauri::Error),
    Io(std::io::Error),
    /// Input rejected by validation; the message is developer-facing.
    Invalid(String),
    NotFound(&'static str),
    /// A session would overlap another one.
    Overlap,
    /// An activity still has sessions, so it can only be archived.
    InUse,
}

pub type Result<T> = std::result::Result<T, Error>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Sql(e) => write!(f, "database error: {e}"),
            Error::Tauri(e) => write!(f, "tauri error: {e}"),
            Error::Io(e) => write!(f, "file error: {e}"),
            Error::Invalid(msg) => write!(f, "invalid input: {msg}"),
            Error::NotFound(what) => write!(f, "{what} not found"),
            Error::Overlap => write!(f, "overlaps another session"),
            Error::InUse => write!(f, "activity has sessions"),
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

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

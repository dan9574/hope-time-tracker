use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::new_id;
use crate::error::{Error, Result};

/// The fixed activity palette (rebuild-plan 4.3). Stored by name; hex lives in tokens.css.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ActivityColor {
    Blue,
    Green,
    Orange,
    Pink,
    Purple,
    Teal,
    Yellow,
    Gray,
}

impl ActivityColor {
    pub const ALL: [ActivityColor; 8] = [
        Self::Blue,
        Self::Green,
        Self::Orange,
        Self::Pink,
        Self::Purple,
        Self::Teal,
        Self::Yellow,
        Self::Gray,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blue => "blue",
            Self::Green => "green",
            Self::Orange => "orange",
            Self::Pink => "pink",
            Self::Purple => "purple",
            Self::Teal => "teal",
            Self::Yellow => "yellow",
            Self::Gray => "gray",
        }
    }

    /// RGB for native surfaces (tray menu) that cannot read CSS. Must match tokens.css.
    pub fn rgb(self) -> [u8; 3] {
        match self {
            Self::Blue => [0x6A, 0xA9, 0xFF],
            Self::Green => [0x5F, 0xD3, 0x9A],
            Self::Orange => [0xFF, 0xAB, 0x6B],
            Self::Pink => [0xFF, 0x8F, 0xB8],
            Self::Purple => [0xB0, 0x8C, 0xFF],
            Self::Teal => [0x5C, 0xD0, 0xD0],
            Self::Yellow => [0xF5, 0xD5, 0x6A],
            Self::Gray => [0xA5, 0xA5, 0xAC],
        }
    }
}

impl ToSql for ActivityColor {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}

impl FromSql for ActivityColor {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        Self::ALL
            .into_iter()
            .find(|c| c.as_str() == s)
            .ok_or_else(|| FromSqlError::Other(format!("unknown activity color {s:?}").into()))
    }
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct Activity {
    pub id: String,
    pub name: String,
    pub color: ActivityColor,
    pub symbol: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub sort: i64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub archived_at: Option<i64>,
}

/// Create (`id: None`) or update an activity. `sort: None` appends on create and keeps the current value on update.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct ActivityInput {
    pub id: Option<String>,
    pub name: String,
    pub color: ActivityColor,
    pub symbol: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub sort: Option<i64>,
}

const COLUMNS: &str = "id, name, color, symbol, sort, archived_at";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Activity> {
    Ok(Activity {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        symbol: r.get(3)?,
        sort: r.get(4)?,
        archived_at: r.get(5)?,
    })
}

pub fn list(conn: &Connection, include_archived: bool) -> Result<Vec<Activity>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM activity
         WHERE deleted_ms IS NULL AND (?1 OR archived_at IS NULL)
         ORDER BY sort, name"
    );
    let rows = conn
        .prepare(&sql)?
        .query_map([include_archived], from_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Activity>> {
    let sql = format!("SELECT {COLUMNS} FROM activity WHERE id = ?1 AND deleted_ms IS NULL");
    Ok(conn.query_row(&sql, [id], from_row).optional()?)
}

pub fn upsert(conn: &Connection, device: &str, now: i64, input: ActivityInput) -> Result<Activity> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("activity name is empty".into()));
    }
    let id = match input.id {
        Some(id) => {
            let changed = conn.execute(
                "UPDATE activity
                 SET name = ?2, color = ?3, symbol = ?4, sort = COALESCE(?5, sort),
                     updated_ms = ?6, device_id = ?7
                 WHERE id = ?1 AND deleted_ms IS NULL",
                params![id, name, input.color, input.symbol, input.sort, now, device],
            )?;
            if changed == 0 {
                return Err(Error::NotFound("activity"));
            }
            id
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO activity (id, name, color, symbol, sort, updated_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4,
                         COALESCE(?5, (SELECT COALESCE(MAX(sort), -1) + 1 FROM activity)),
                         ?6, ?7)",
                params![id, name, input.color, input.symbol, input.sort, now, device],
            )?;
            id
        }
    };
    get(conn, &id)?.ok_or(Error::NotFound("activity"))
}

pub fn set_archived(conn: &Connection, device: &str, now: i64, id: &str, archived: bool) -> Result<()> {
    let changed = conn.execute(
        "UPDATE activity
         SET archived_at = CASE WHEN ?2 THEN COALESCE(archived_at, ?3) END,
             updated_ms = ?3, device_id = ?4
         WHERE id = ?1 AND deleted_ms IS NULL",
        params![id, archived, now, device],
    )?;
    if changed == 0 {
        return Err(Error::NotFound("activity"));
    }
    Ok(())
}

/// Sets `sort` to each id's position in `ids`.
pub fn reorder(conn: &mut Connection, device: &str, now: i64, ids: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE activity SET sort = ?2, updated_ms = ?3, device_id = ?4 WHERE id = ?1 AND deleted_ms IS NULL",
            params![id, i as i64, now, device],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Debug builds only: give an empty database something to click on.
#[cfg(debug_assertions)]
pub fn seed_samples_if_empty(conn: &Connection, device: &str, now: i64) -> Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM activity", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }
    let samples = [
        ("工作", ActivityColor::Blue),
        ("阅读", ActivityColor::Green),
        ("运动", ActivityColor::Orange),
        ("学习", ActivityColor::Purple),
    ];
    for (name, color) in samples {
        upsert(
            conn,
            device,
            now,
            ActivityInput { id: None, name: name.into(), color, symbol: None, sort: None },
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    fn input(name: &str) -> ActivityInput {
        ActivityInput { id: None, name: name.into(), color: ActivityColor::Teal, symbol: None, sort: None }
    }

    #[test]
    fn create_appends_and_update_keeps_sort() {
        let conn = test_conn();
        let a = upsert(&conn, "d", 1, input("A")).unwrap();
        let b = upsert(&conn, "d", 1, input("B")).unwrap();
        assert_eq!((a.sort, b.sort), (0, 1));

        let renamed = upsert(&conn, "d", 2, ActivityInput { id: Some(a.id.clone()), ..input(" A2 ") }).unwrap();
        assert_eq!(renamed.name, "A2");
        assert_eq!(renamed.sort, 0);
        assert_eq!(renamed.color, ActivityColor::Teal);
    }

    #[test]
    fn rejects_blank_name_and_unknown_id() {
        let conn = test_conn();
        assert!(matches!(upsert(&conn, "d", 1, input("  ")), Err(Error::Invalid(_))));
        let missing = ActivityInput { id: Some("nope".into()), ..input("X") };
        assert!(matches!(upsert(&conn, "d", 1, missing), Err(Error::NotFound(_))));
    }

    #[test]
    fn reorder_sets_positions() {
        let mut conn = test_conn();
        let a = upsert(&conn, "d", 1, input("A")).unwrap();
        let b = upsert(&conn, "d", 1, input("B")).unwrap();
        reorder(&mut conn, "d", 2, &[b.id.clone(), a.id.clone()]).unwrap();
        let names: Vec<_> = list(&conn, false).unwrap().into_iter().map(|x| x.name).collect();
        assert_eq!(names, ["B", "A"]);
    }

    #[test]
    fn archived_hidden_unless_requested() {
        let conn = test_conn();
        let a = upsert(&conn, "d", 1, input("A")).unwrap();
        set_archived(&conn, "d", 5, &a.id, true).unwrap();
        assert!(list(&conn, false).unwrap().is_empty());
        assert_eq!(list(&conn, true).unwrap()[0].archived_at, Some(5));
        set_archived(&conn, "d", 6, &a.id, false).unwrap();
        assert_eq!(list(&conn, false).unwrap().len(), 1);
    }
}

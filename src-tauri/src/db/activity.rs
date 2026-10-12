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
    /// `None` = top level. Sub-activities are one level deep and always take their parent's color.
    pub parent_id: Option<String>,
    /// `None` = normal; `"schedule"` = the timetable group (rebuild-plan 13.1, top level only).
    pub kind: Option<String>,
}

/// Create (`id: None`) or update an activity. `sort: None` appends on create and keeps the current value
/// on update. For a sub-activity, `color` is ignored: it is copied from the parent.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct ActivityInput {
    pub id: Option<String>,
    pub name: String,
    pub color: ActivityColor,
    pub symbol: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub sort: Option<i64>,
    pub parent_id: Option<String>,
    /// `None` or `"schedule"` (see `Activity.kind`). Editors must send the current value back.
    pub kind: Option<String>,
}

/// `activity.kind` of the timetable group (rebuild-plan 13.1).
pub const KIND_SCHEDULE: &str = "schedule";

// Reads take the color from a live parent, so a child can never drift from it.
// A child whose parent is missing (sync may deliver it later) reads as a top-level activity.
const SELECT: &str = "SELECT a.id, a.name, COALESCE(p.color, a.color), a.symbol, a.sort, a.archived_at, a.parent_id, a.kind
     FROM activity a LEFT JOIN activity p ON p.id = a.parent_id AND p.deleted_ms IS NULL";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Activity> {
    Ok(Activity {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        symbol: r.get(3)?,
        sort: r.get(4)?,
        archived_at: r.get(5)?,
        parent_id: r.get(6)?,
        kind: r.get(7)?,
    })
}

/// Live activities ordered by `sort`. Without archived ones, children of an archived parent are hidden too.
pub fn list(conn: &Connection, include_archived: bool) -> Result<Vec<Activity>> {
    let sql = format!(
        "{SELECT}
         WHERE a.deleted_ms IS NULL
           AND (?1 OR (a.archived_at IS NULL AND (p.id IS NULL OR p.archived_at IS NULL)))
         ORDER BY a.sort, a.name"
    );
    let rows = conn
        .prepare(&sql)?
        .query_map([include_archived], from_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Activity>> {
    let sql = format!("{SELECT} WHERE a.id = ?1 AND a.deleted_ms IS NULL");
    Ok(conn.query_row(&sql, [id], from_row).optional()?)
}

/// Enforces the one-level rule and returns the color the activity must be stored with.
fn check_parent(conn: &Connection, id: Option<&str>, parent_id: Option<&str>, color: ActivityColor) -> Result<ActivityColor> {
    let Some(parent_id) = parent_id else { return Ok(color) };
    if Some(parent_id) == id {
        return Err(Error::Invalid("an activity cannot be its own parent".into()));
    }
    let parent = get(conn, parent_id)?.ok_or(Error::NotFound("parent activity"))?;
    if parent.parent_id.is_some() {
        return Err(Error::Invalid("sub-activities cannot have sub-activities".into()));
    }
    if let Some(id) = id {
        let children: i64 = conn.query_row(
            "SELECT COUNT(*) FROM activity WHERE parent_id = ?1 AND deleted_ms IS NULL",
            [id],
            |r| r.get(0),
        )?;
        if children > 0 {
            return Err(Error::Invalid("an activity with sub-activities cannot become one".into()));
        }
    }
    Ok(parent.color)
}

/// `kind` must be `None` or `"schedule"`; shared by `upsert` and the JSON importer.
pub fn validate_kind(kind: Option<&str>) -> Result<()> {
    match kind {
        None | Some(KIND_SCHEDULE) => Ok(()),
        Some(other) => Err(Error::Invalid(format!("unknown activity kind {other:?}"))),
    }
}

/// Enforces rebuild-plan 13.1: a timetable group is top level, and this device keeps at most one live one.
/// (Sync may still deliver a second; readers treat every `kind = 'schedule'` activity as a timetable.)
fn check_kind(conn: &Connection, id: Option<&str>, parent_id: Option<&str>, kind: Option<&str>) -> Result<()> {
    validate_kind(kind)?;
    if kind != Some(KIND_SCHEDULE) {
        return Ok(());
    }
    if parent_id.is_some() {
        return Err(Error::Invalid("a timetable group must be a top-level activity".into()));
    }
    let others: i64 = conn.query_row(
        "SELECT COUNT(*) FROM activity WHERE kind = ?1 AND deleted_ms IS NULL AND id IS NOT ?2",
        params![KIND_SCHEDULE, id],
        |r| r.get(0),
    )?;
    if others > 0 {
        return Err(Error::Invalid("there is already a timetable group".into()));
    }
    Ok(())
}

pub fn upsert(conn: &Connection, device: &str, now: i64, input: ActivityInput) -> Result<Activity> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("activity name is empty".into()));
    }
    let parent_id = input.parent_id.as_deref();
    let kind = input.kind.as_deref();
    check_kind(conn, input.id.as_deref(), parent_id, kind)?;
    let color = check_parent(conn, input.id.as_deref(), parent_id, input.color)?;
    let id = match input.id {
        Some(id) => {
            let changed = conn.execute(
                "UPDATE activity
                 SET name = ?2, color = ?3, symbol = ?4, sort = COALESCE(?5, sort), parent_id = ?6, kind = ?7,
                     updated_ms = MAX(?8, updated_ms + 1), device_id = ?9, dirty = 1
                 WHERE id = ?1 AND deleted_ms IS NULL",
                params![id, name, color, input.symbol, input.sort, parent_id, kind, now, device],
            )?;
            if changed == 0 {
                return Err(Error::NotFound("activity"));
            }
            // Keep stored child colors in step (reads already use the parent's).
            conn.execute(
                "UPDATE activity SET color = ?2, updated_ms = MAX(?3, updated_ms + 1), device_id = ?4, dirty = 1
                 WHERE parent_id = ?1 AND deleted_ms IS NULL AND color != ?2",
                params![id, color, now, device],
            )?;
            id
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO activity (id, name, color, symbol, sort, parent_id, kind, updated_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4,
                         COALESCE(?5, (SELECT COALESCE(MAX(sort), -1) + 1 FROM activity
                                       WHERE parent_id IS ?6 AND deleted_ms IS NULL)),
                         ?6, ?7, ?8, ?9)",
                params![id, name, color, input.symbol, input.sort, parent_id, kind, now, device],
            )?;
            id
        }
    };
    get(conn, &id)?.ok_or(Error::NotFound("activity"))
}

/// The timetable group: the live top-level `kind = 'schedule'` activity with the smallest `sort`
/// (a restored, unarchived one first if there are several).
pub fn schedule_group(conn: &Connection) -> Result<Option<Activity>> {
    let sql = format!(
        "{SELECT} WHERE a.kind = ?1 AND a.parent_id IS NULL AND a.deleted_ms IS NULL ORDER BY a.archived_at IS NOT NULL, a.sort, a.name LIMIT 1"
    );
    Ok(conn.query_row(&sql, [KIND_SCHEDULE], from_row).optional()?)
}

/// Inserts a new activity that starts out archived (`archived_at = now`), in the same write as far as sync
/// is concerned: one `updated_ms`, one dirty row. Used for the timetable, whose group and courses are only
/// ever logged automatically and so never offered when starting a timer (rebuild-plan 13.7).
pub fn create_archived(conn: &Connection, device: &str, now: i64, input: ActivityInput) -> Result<Activity> {
    if input.id.is_some() {
        return Err(Error::Invalid("create_archived only creates new activities".into()));
    }
    let created = upsert(conn, device, now, input)?;
    conn.execute("UPDATE activity SET archived_at = ?2 WHERE id = ?1", params![created.id, now])?;
    get(conn, &created.id)?.ok_or(Error::NotFound("activity"))
}

/// Returns the timetable group, creating it archived (pink, graduation cap) when there is none
/// (rebuild-plan 13.3, 13.7). An existing group is returned as it is, archived or not.
/// The flag says whether it was created; `name` is only used then.
pub fn schedule_ensure(conn: &Connection, device: &str, now: i64, name: &str) -> Result<(Activity, bool)> {
    if let Some(group) = schedule_group(conn)? {
        return Ok((group, false));
    }
    let input = ActivityInput {
        id: None,
        name: name.into(),
        color: ActivityColor::Pink,
        symbol: Some("graduationcap".into()),
        sort: None,
        parent_id: None,
        kind: Some(KIND_SCHEDULE.into()),
    };
    Ok((create_archived(conn, device, now, input)?, true))
}

pub fn set_archived(conn: &Connection, device: &str, now: i64, id: &str, archived: bool) -> Result<()> {
    let changed = conn.execute(
        "UPDATE activity
         SET archived_at = CASE WHEN ?2 THEN COALESCE(archived_at, ?3) END,
             updated_ms = MAX(?3, updated_ms + 1), device_id = ?4, dirty = 1
         WHERE id = ?1 AND deleted_ms IS NULL",
        params![id, archived, now, device],
    )?;
    if changed == 0 {
        return Err(Error::NotFound("activity"));
    }
    Ok(())
}

/// Live sessions logged on this activity or any of its sub-activities.
pub fn usage(conn: &Connection, id: &str) -> Result<u32> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM session WHERE deleted_ms IS NULL AND activity_id IN
           (SELECT id FROM activity WHERE (id = ?1 OR parent_id = ?1) AND deleted_ms IS NULL)",
        [id],
        |r| r.get(0),
    )?)
}

/// Soft-deletes an activity with no sessions, its sub-activities and their plans.
/// Activities with sessions can only be archived.
pub fn delete(conn: &mut Connection, device: &str, now: i64, id: &str) -> Result<()> {
    if get(conn, id)?.is_none() {
        return Err(Error::NotFound("activity"));
    }
    if usage(conn, id)? > 0 {
        return Err(Error::InUse);
    }
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE plan SET deleted_ms = ?2, updated_ms = MAX(?2, updated_ms + 1), device_id = ?3, dirty = 1
         WHERE deleted_ms IS NULL AND activity_id IN
           (SELECT id FROM activity WHERE (id = ?1 OR parent_id = ?1) AND deleted_ms IS NULL)",
        params![id, now, device],
    )?;
    tx.execute(
        "UPDATE activity SET deleted_ms = ?2, updated_ms = MAX(?2, updated_ms + 1), device_id = ?3, dirty = 1
         WHERE (id = ?1 OR parent_id = ?1) AND deleted_ms IS NULL",
        params![id, now, device],
    )?;
    tx.commit()?;
    Ok(())
}

/// Sets `sort` to each id's position in `ids`.
pub fn reorder(conn: &mut Connection, device: &str, now: i64, ids: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE activity SET sort = ?2, updated_ms = MAX(?3, updated_ms + 1), device_id = ?4, dirty = 1 WHERE id = ?1 AND deleted_ms IS NULL",
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
            ActivityInput { id: None, name: name.into(), color, symbol: None, sort: None, parent_id: None, kind: None },
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    fn input(name: &str) -> ActivityInput {
        ActivityInput { id: None, name: name.into(), color: ActivityColor::Teal, symbol: None, sort: None, parent_id: None, kind: None }
    }

    fn schedule(name: &str) -> ActivityInput {
        ActivityInput { kind: Some(KIND_SCHEDULE.into()), ..input(name) }
    }

    fn child(name: &str, parent: &str) -> ActivityInput {
        ActivityInput { parent_id: Some(parent.into()), color: ActivityColor::Pink, ..input(name) }
    }

    #[test]
    fn children_follow_parent_color_and_sort_among_siblings() {
        let conn = test_conn();
        let study = upsert(&conn, "d", 1, input("Study")).unwrap();
        upsert(&conn, "d", 1, input("Read")).unwrap();
        let linalg = upsert(&conn, "d", 1, child("Linear algebra", &study.id)).unwrap();
        let calc = upsert(&conn, "d", 1, child("Calculus", &study.id)).unwrap();
        assert_eq!(linalg.color, ActivityColor::Teal, "pink ignored, parent's teal used");
        assert_eq!((linalg.sort, calc.sort), (0, 1), "children are numbered among siblings");

        upsert(&conn, "d", 2, ActivityInput { id: Some(study.id.clone()), color: ActivityColor::Orange, ..input("Study") }).unwrap();
        assert_eq!(get(&conn, &calc.id).unwrap().unwrap().color, ActivityColor::Orange);
        let stored: String = conn.query_row("SELECT color FROM activity WHERE id = ?1", [&calc.id], |r| r.get(0)).unwrap();
        assert_eq!(stored, "orange", "stored child color is kept in step");
    }

    #[test]
    fn only_one_level() {
        let conn = test_conn();
        let study = upsert(&conn, "d", 1, input("Study")).unwrap();
        let read = upsert(&conn, "d", 1, input("Read")).unwrap();
        let linalg = upsert(&conn, "d", 1, child("Linear algebra", &study.id)).unwrap();

        assert!(matches!(upsert(&conn, "d", 2, child("Deeper", &linalg.id)), Err(Error::Invalid(_))));
        let study_under_read = ActivityInput { id: Some(study.id.clone()), ..child("Study", &read.id) };
        assert!(matches!(upsert(&conn, "d", 2, study_under_read), Err(Error::Invalid(_))), "has children");
        let own_parent = ActivityInput { id: Some(read.id.clone()), ..child("Read", &read.id) };
        assert!(matches!(upsert(&conn, "d", 2, own_parent), Err(Error::Invalid(_))));
        assert!(matches!(upsert(&conn, "d", 2, child("X", "missing")), Err(Error::NotFound(_))));

        // Moving a child to another parent is allowed.
        let moved = upsert(&conn, "d", 3, ActivityInput { id: Some(linalg.id.clone()), ..child("Linear algebra", &read.id) }).unwrap();
        assert_eq!(moved.parent_id.as_deref(), Some(read.id.as_str()));
    }

    #[test]
    fn at_most_one_top_level_schedule_group() {
        let conn = test_conn();
        let group = upsert(&conn, "d", 1, schedule("Courses")).unwrap();
        assert_eq!(group.kind.as_deref(), Some(KIND_SCHEDULE));
        let renamed = upsert(&conn, "d", 2, ActivityInput { id: Some(group.id.clone()), ..schedule("Classes") }).unwrap();
        assert_eq!(renamed.name, "Classes", "the group itself may be edited");

        assert!(matches!(upsert(&conn, "d", 3, schedule("Second")), Err(Error::Invalid(_))));
        let other = upsert(&conn, "d", 3, input("Read")).unwrap();
        let promote = ActivityInput { id: Some(other.id.clone()), ..schedule("Read") };
        assert!(matches!(upsert(&conn, "d", 4, promote), Err(Error::Invalid(_))));

        let nested = ActivityInput { kind: Some(KIND_SCHEDULE.into()), ..child("Nested", &other.id) };
        assert!(matches!(upsert(&conn, "d", 4, nested), Err(Error::Invalid(_))));
        let demote = ActivityInput { id: Some(group.id.clone()), kind: Some(KIND_SCHEDULE.into()), ..child("Classes", &other.id) };
        assert!(matches!(upsert(&conn, "d", 4, demote), Err(Error::Invalid(_))), "a group cannot become a sub-activity");
        assert!(matches!(upsert(&conn, "d", 4, ActivityInput { kind: Some("work".into()), ..input("X") }), Err(Error::Invalid(_))));

        // Clearing the flag frees the slot.
        upsert(&conn, "d", 5, ActivityInput { id: Some(group.id.clone()), ..input("Classes") }).unwrap();
        upsert(&conn, "d", 6, schedule("Second")).unwrap();
    }

    #[test]
    fn schedule_ensure_creates_once_and_prefers_smallest_sort() {
        let conn = test_conn();
        let (group, created) = schedule_ensure(&conn, "d", 1, "Courses").unwrap();
        assert!(created);
        assert_eq!((group.color, group.symbol.as_deref(), group.parent_id.as_deref()), (ActivityColor::Pink, Some("graduationcap"), None));
        assert_eq!(group.archived_at, Some(1), "created archived (rebuild-plan 13.7)");
        assert!(list(&conn, false).unwrap().is_empty(), "not offered when starting a timer");
        let (again, created) = schedule_ensure(&conn, "d", 2, "Other name").unwrap();
        assert_eq!((again.id.as_str(), created, again.archived_at), (group.id.as_str(), false, Some(1)));

        // Restoring is allowed and sticks: ensuring again neither re-archives nor duplicates.
        set_archived(&conn, "d", 3, &group.id, false).unwrap();
        let (restored, created) = schedule_ensure(&conn, "d", 4, "Courses").unwrap();
        assert_eq!((restored.id.as_str(), created, restored.archived_at), (group.id.as_str(), false, None));

        // A second group arriving through sync: the one sorted first wins.
        conn.execute(
            "INSERT INTO activity (id, name, color, sort, kind, updated_ms, device_id) VALUES ('synced', 'A', 'pink', -1, 'schedule', 0, 'x')",
            [],
        )
        .unwrap();
        assert_eq!(schedule_ensure(&conn, "d", 5, "Courses").unwrap().0.id, "synced");
    }

    #[test]
    fn create_archived_is_one_new_dirty_row() {
        let conn = test_conn();
        let a = create_archived(&conn, "d", 7, input("Old course")).unwrap();
        let (archived_at, updated_ms, dirty): (Option<i64>, i64, i64) = conn
            .query_row("SELECT archived_at, updated_ms, dirty FROM activity WHERE id = ?1", [&a.id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((archived_at, updated_ms, dirty), (Some(7), 7, 1));
        let existing = ActivityInput { id: Some(a.id.clone()), ..input("Old course") };
        assert!(matches!(create_archived(&conn, "d", 8, existing), Err(Error::Invalid(_))));
    }

    #[test]
    fn delete_only_without_sessions() {
        let mut conn = test_conn();
        let study = upsert(&conn, "d", 1, input("Study")).unwrap();
        let linalg = upsert(&conn, "d", 1, child("Linear algebra", &study.id)).unwrap();
        conn.execute(
            "INSERT INTO session (id, activity_id, start_ms, end_ms, updated_ms, device_id) VALUES ('s', ?1, 0, 10, 0, 'd')",
            [&linalg.id],
        )
        .unwrap();
        assert_eq!(usage(&conn, &study.id).unwrap(), 1, "counts sub-activity sessions");
        assert!(matches!(delete(&mut conn, "d", 2, &study.id), Err(Error::InUse)));

        conn.execute("UPDATE session SET deleted_ms = 1", []).unwrap();
        delete(&mut conn, "d", 3, &study.id).unwrap();
        assert!(list(&conn, true).unwrap().is_empty(), "children go with the parent");
    }

    #[test]
    fn archiving_a_parent_hides_its_children() {
        let conn = test_conn();
        let study = upsert(&conn, "d", 1, input("Study")).unwrap();
        upsert(&conn, "d", 1, child("Linear algebra", &study.id)).unwrap();
        set_archived(&conn, "d", 2, &study.id, true).unwrap();
        assert!(list(&conn, false).unwrap().is_empty());
        assert_eq!(list(&conn, true).unwrap().len(), 2);
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

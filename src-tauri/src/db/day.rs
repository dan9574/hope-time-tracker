//! Each day's actual wake-up and bedtime (rebuild-plan 10 E). Sleep is not an activity.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::plan::DateRange;
use super::{session, validate};
use crate::error::{Error, Result};

/// A day is keyed by the local date of its wake-up; `sleep_ms` may fall after midnight.
#[derive(Debug, Clone, Serialize, Type, PartialEq)]
pub struct Day {
    pub date: String,
    /// `None` = fall back to the default wake-up time from Settings.
    #[specta(type = Option<specta_typescript::Number>)]
    pub wake_ms: Option<i64>,
    /// `None` = still awake (or fall back to the default bedtime).
    #[specta(type = Option<specta_typescript::Number>)]
    pub sleep_ms: Option<i64>,
    /// Minutes east of UTC on that day, so history can show that day's local clock times.
    pub utc_offset_min: i32,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct DayInput {
    pub date: String,
    #[specta(type = Option<specta_typescript::Number>)]
    pub wake_ms: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub sleep_ms: Option<i64>,
    pub utc_offset_min: i32,
}

/// Longest plausible day, wake-up to bedtime.
const MAX_DAY_MS: i64 = 36 * 3_600_000;

fn from_row(r: &Row<'_>) -> rusqlite::Result<Day> {
    Ok(Day { date: r.get(0)?, wake_ms: r.get(1)?, sleep_ms: r.get(2)?, utc_offset_min: r.get(3)? })
}

const COLUMNS: &str = "date, wake_ms, sleep_ms, utc_offset_min";

pub fn get(conn: &Connection, date: &str) -> Result<Option<Day>> {
    let sql = format!("SELECT {COLUMNS} FROM day WHERE date = ?1 AND deleted_ms IS NULL");
    Ok(conn.query_row(&sql, [date], from_row).optional()?)
}

pub fn list(conn: &Connection, range: &DateRange) -> Result<Vec<Day>> {
    let sql = format!("SELECT {COLUMNS} FROM day WHERE deleted_ms IS NULL AND date BETWEEN ?1 AND ?2 ORDER BY date");
    let rows = conn
        .prepare(&sql)?
        .query_map([&range.from, &range.to], from_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn check(input: &DayInput) -> Result<()> {
    validate::date(&input.date)?;
    if !(-14 * 60..=14 * 60).contains(&input.utc_offset_min) {
        return Err(Error::Invalid("bad UTC offset".into()));
    }
    if let (Some(wake), Some(sleep)) = (input.wake_ms, input.sleep_ms) {
        if sleep <= wake {
            return Err(Error::Invalid("bedtime must be after wake-up".into()));
        }
        if sleep - wake > MAX_DAY_MS {
            return Err(Error::Invalid("day is longer than 36 hours".into()));
        }
    }
    Ok(())
}

/// Replaces both times of a day (either may be `None` to fall back to the defaults).
pub fn set(conn: &Connection, device: &str, now: i64, input: DayInput) -> Result<Day> {
    check(&input)?;
    conn.execute(
        "INSERT INTO day (date, wake_ms, sleep_ms, utc_offset_min, updated_ms, deleted_ms, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)
         ON CONFLICT (date) DO UPDATE SET wake_ms = excluded.wake_ms, sleep_ms = excluded.sleep_ms,
           utc_offset_min = excluded.utc_offset_min, updated_ms = excluded.updated_ms,
           deleted_ms = NULL, device_id = excluded.device_id",
        params![input.date, input.wake_ms, input.sleep_ms, input.utc_offset_min, now, device],
    )?;
    get(conn, &input.date)?.ok_or(Error::NotFound("day"))
}

/// "Wake up" button: records now, keeping any bedtime already set.
pub fn wake_now(conn: &Connection, device: &str, now: i64, date: &str, utc_offset_min: i32) -> Result<Day> {
    let sleep_ms = get(conn, date)?.and_then(|d| d.sleep_ms).filter(|s| *s > now);
    set(conn, device, now, DayInput { date: date.into(), wake_ms: Some(now), sleep_ms, utc_offset_min })
}

/// "Go to sleep" button: records now and ends whatever is being timed.
pub fn sleep_now(conn: &mut Connection, device: &str, now: i64, date: &str, utc_offset_min: i32) -> Result<Day> {
    let tx = conn.transaction()?;
    let wake_ms = get(&tx, date)?.and_then(|d| d.wake_ms).filter(|w| *w < now);
    let day = set(&tx, device, now, DayInput { date: date.into(), wake_ms, sleep_ms: Some(now), utc_offset_min })?;
    tx.commit()?;
    session::stop(conn, device, now)?;
    Ok(day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::activity::{upsert, ActivityColor, ActivityInput};
    use crate::db::test_conn;

    const H: i64 = 3_600_000;

    #[test]
    fn set_validates_and_upserts_by_date() {
        let conn = test_conn();
        let input = |wake, sleep| DayInput { date: "2026-10-03".into(), wake_ms: wake, sleep_ms: sleep, utc_offset_min: -420 };
        assert!(matches!(set(&conn, "d", 0, input(Some(10 * H), Some(9 * H))), Err(Error::Invalid(_))));
        assert!(matches!(set(&conn, "d", 0, input(Some(0), Some(37 * H))), Err(Error::Invalid(_))));

        set(&conn, "d", 0, input(Some(7 * H), None)).unwrap();
        let day = set(&conn, "d", 1, input(Some(7 * H), Some(25 * H))).unwrap(); // bedtime after midnight
        assert_eq!(day.sleep_ms, Some(25 * H));
        let range = DateRange { from: "2026-10-01".into(), to: "2026-10-31".into() };
        assert_eq!(list(&conn, &range).unwrap().len(), 1);
    }

    #[test]
    fn sleep_now_stops_the_timer_and_keeps_wake() {
        let mut conn = test_conn();
        let a = upsert(
            &conn,
            "d",
            0,
            ActivityInput { id: None, name: "A".into(), color: ActivityColor::Blue, symbol: None, sort: None, parent_id: None },
        )
        .unwrap();
        wake_now(&conn, "d", 7 * H, "2026-10-03", 0).unwrap();
        session::start(&mut conn, "d", 20 * H, &a.id).unwrap();

        let day = sleep_now(&mut conn, "d", 23 * H, "2026-10-03", 0).unwrap();
        assert_eq!((day.wake_ms, day.sleep_ms), (Some(7 * H), Some(23 * H)));
        assert!(session::current(&conn).unwrap().running.is_none());

        // "Undo sleep" clears the bedtime only.
        let undone = set(&conn, "d", 24 * H, DayInput { date: "2026-10-03".into(), wake_ms: day.wake_ms, sleep_ms: None, utc_offset_min: 0 }).unwrap();
        assert_eq!((undone.wake_ms, undone.sleep_ms), (Some(7 * H), None));
    }
}

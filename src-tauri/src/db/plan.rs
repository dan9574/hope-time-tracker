use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::{new_id, validate};
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Type)]
pub struct Plan {
    pub id: String,
    pub activity_id: String,
    /// The day of a one-off plan, or the first day a recurring plan applies.
    pub date: String,
    pub start_hm: String,
    pub end_hm: String,
    /// `None` = one-off; `"weekly:1,3,5"` = Monday, Wednesday, Friday (ISO weekdays, 1 = Monday).
    pub rule: Option<String>,
    /// Recurring plans only: log a session when an occurrence ends (rebuild-plan 10 F).
    pub auto_log: bool,
    /// Recurring plans only: last day (inclusive); `None` = repeats forever.
    pub until: Option<String>,
    /// Recurring plans only: 'YYYY-MM-DD' days without an occurrence (holidays from a timetable import,
    /// rebuild-plan 13.1). Sorted, no duplicates.
    pub skip_dates: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct PlanInput {
    pub id: Option<String>,
    pub activity_id: String,
    pub date: String,
    pub start_hm: String,
    pub end_hm: String,
    pub rule: Option<String>,
    pub auto_log: bool,
    pub until: Option<String>,
    /// Editors have no UI for these but must send them back unchanged, or they are cleared.
    /// Required (no serde default) so the TypeScript type forces every caller to pass it.
    pub skip_dates: Vec<String>,
}

/// Inclusive range of 'YYYY-MM-DD' dates.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct DateRange {
    pub from: String,
    pub to: String,
}

const COLUMNS: &str = "id, activity_id, date, start_hm, end_hm, rule, auto_log, until, skip_dates";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Plan> {
    Ok(Plan {
        id: r.get(0)?,
        activity_id: r.get(1)?,
        date: r.get(2)?,
        start_hm: r.get(3)?,
        end_hm: r.get(4)?,
        rule: r.get(5)?,
        auto_log: r.get(6)?,
        until: r.get(7)?,
        skip_dates: parse_skip_dates(r.get::<_, Option<String>>(8)?.as_deref()),
    })
}

/// Canonical form of a rule: `weekly:` + sorted, de-duplicated ISO weekdays.
pub fn normalize_rule(rule: Option<&str>) -> Result<Option<String>> {
    let Some(rule) = rule.map(str::trim).filter(|r| !r.is_empty()) else { return Ok(None) };
    let bad = || Error::Invalid(format!("bad rule {rule:?}"));
    let days = rule.strip_prefix("weekly:").ok_or_else(bad)?;
    let mut parsed: Vec<u8> = days
        .split(',')
        .map(|d| d.trim().parse::<u8>().ok().filter(|d| (1..=7).contains(d)).ok_or_else(bad))
        .collect::<Result<_>>()?;
    parsed.sort_unstable();
    parsed.dedup();
    let list: Vec<String> = parsed.iter().map(u8::to_string).collect();
    Ok(Some(format!("weekly:{}", list.join(","))))
}

/// Stored form of skipped dates: sorted, de-duplicated, comma-joined; `None` when there are none.
pub fn normalize_skip_dates(dates: &[String]) -> Result<Option<String>> {
    let mut list: Vec<&str> = dates.iter().map(|d| d.trim()).collect();
    for d in &list {
        validate::date(d)?;
    }
    list.sort_unstable();
    list.dedup();
    Ok(if list.is_empty() { None } else { Some(list.join(",")) })
}

/// The stored `skip_dates` text back as a list.
pub fn parse_skip_dates(stored: Option<&str>) -> Vec<String> {
    stored
        .map(|s| s.split(',').map(str::trim).filter(|d| !d.is_empty()).map(Into::into).collect())
        .unwrap_or_default()
}

/// The columns `check` derives from a `PlanInput`, ready to store.
#[derive(Debug)]
pub struct Checked {
    pub rule: Option<String>,
    /// `until` and `skip_dates` only mean something for recurring plans; one-off plans store NULL.
    pub until: Option<String>,
    pub skip_dates: Option<String>,
}

/// Validates and normalizes a plan; shared by `upsert`, the JSON importer and the timetable importer.
pub fn check(input: &PlanInput) -> Result<Checked> {
    validate::date(&input.date)?;
    if validate::hm(&input.start_hm)? >= validate::hm(&input.end_hm)? {
        return Err(Error::Invalid("plan must end after it starts".into()));
    }
    if let Some(until) = &input.until {
        validate::date(until)?;
        if until < &input.date {
            return Err(Error::Invalid("plan ends before it starts repeating".into()));
        }
    }
    let rule = normalize_rule(input.rule.as_deref())?;
    let skip_dates = normalize_skip_dates(&input.skip_dates)?;
    Ok(match rule {
        Some(_) => Checked { rule, until: input.until.clone(), skip_dates },
        None => Checked { rule: None, until: None, skip_dates: None },
    })
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Plan>> {
    let sql = format!("SELECT {COLUMNS} FROM plan WHERE id = ?1 AND deleted_ms IS NULL");
    Ok(conn.query_row(&sql, [id], from_row).optional()?)
}

/// One-off plans inside the range plus every recurring plan that has started by its end.
/// The frontend expands recurring plans into occurrences.
pub fn list(conn: &Connection, range: &DateRange) -> Result<Vec<Plan>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM plan
         WHERE deleted_ms IS NULL
           AND ((rule IS NULL AND date BETWEEN ?1 AND ?2)
                OR (rule IS NOT NULL AND date <= ?2 AND (until IS NULL OR until >= ?1)))
         ORDER BY start_hm, date"
    );
    let rows = conn
        .prepare(&sql)?
        .query_map([&range.from, &range.to], from_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn upsert(conn: &Connection, device: &str, now: i64, input: PlanInput) -> Result<Plan> {
    let Checked { rule, until, skip_dates } = check(&input)?;
    let id = match &input.id {
        Some(id) => {
            let changed = conn.execute(
                "UPDATE plan SET activity_id = ?2, date = ?3, start_hm = ?4, end_hm = ?5, rule = ?6,
                     auto_log = ?7, until = ?8, skip_dates = ?9, updated_ms = MAX(?10, updated_ms + 1), device_id = ?11, dirty = 1
                 WHERE id = ?1 AND deleted_ms IS NULL",
                params![
                    id, input.activity_id, input.date, input.start_hm, input.end_hm, rule, input.auto_log, until, skip_dates, now, device
                ],
            )?;
            if changed == 0 {
                return Err(Error::NotFound("plan"));
            }
            id.clone()
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO plan (id, activity_id, date, start_hm, end_hm, rule, auto_log, until, skip_dates, updated_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    id, input.activity_id, input.date, input.start_hm, input.end_hm, rule, input.auto_log, until, skip_dates, now, device
                ],
            )?;
            id
        }
    };
    get(conn, &id)?.ok_or(Error::NotFound("plan"))
}

/// What `upsert_by_id` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Upserted {
    /// No live plan had this id (a soft-deleted one is revived).
    Added,
    Updated,
}

/// Writes a plan under a caller-chosen id (the timetable importer's deterministic ids, rebuild-plan 13.3).
/// `input.id` is ignored.
pub fn upsert_by_id(conn: &Connection, device: &str, now: i64, id: &str, input: &PlanInput) -> Result<(Plan, Upserted)> {
    let Checked { rule, until, skip_dates } = check(input)?;
    let live: Option<bool> =
        conn.query_row("SELECT deleted_ms IS NULL FROM plan WHERE id = ?1", [id], |r| r.get(0)).optional()?;
    conn.execute(
        "INSERT INTO plan (id, activity_id, date, start_hm, end_hm, rule, auto_log, until, skip_dates, updated_ms, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT (id) DO UPDATE SET activity_id = excluded.activity_id, date = excluded.date,
           start_hm = excluded.start_hm, end_hm = excluded.end_hm, rule = excluded.rule, auto_log = excluded.auto_log,
           until = excluded.until, skip_dates = excluded.skip_dates, updated_ms = MAX(excluded.updated_ms, updated_ms + 1),
           deleted_ms = NULL, device_id = excluded.device_id, dirty = 1",
        params![id, input.activity_id, input.date, input.start_hm, input.end_hm, rule, input.auto_log, until, skip_dates, now, device],
    )?;
    let plan = get(conn, id)?.ok_or(Error::NotFound("plan"))?;
    Ok((plan, if live == Some(true) { Upserted::Updated } else { Upserted::Added }))
}

pub fn delete(conn: &Connection, device: &str, now: i64, id: &str) -> Result<()> {
    let changed = conn.execute(
        "UPDATE plan SET deleted_ms = ?2, updated_ms = MAX(?2, updated_ms + 1), device_id = ?3, dirty = 1 WHERE id = ?1 AND deleted_ms IS NULL",
        params![id, now, device],
    )?;
    if changed == 0 {
        return Err(Error::NotFound("plan"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    fn input(date: &str, rule: Option<&str>) -> PlanInput {
        PlanInput {
            id: None,
            activity_id: "a".into(),
            date: date.into(),
            start_hm: "09:00".into(),
            end_hm: "10:30".into(),
            rule: rule.map(Into::into),
            auto_log: true,
            until: None,
            skip_dates: vec![],
        }
    }

    #[test]
    fn rules_are_normalized_and_validated() {
        assert_eq!(normalize_rule(Some("weekly:5,1,3,3")).unwrap().as_deref(), Some("weekly:1,3,5"));
        assert_eq!(normalize_rule(Some("  ")).unwrap(), None);
        assert!(normalize_rule(Some("weekly:0")).is_err());
        assert!(normalize_rule(Some("daily")).is_err());
    }

    #[test]
    fn skip_dates_are_normalized_and_only_kept_on_recurring_plans() {
        let days = |v: &[&str]| v.iter().map(|d| d.to_string()).collect::<Vec<_>>();
        assert_eq!(
            normalize_skip_dates(&days(&["2026-11-27", "2026-11-11", "2026-11-27"])).unwrap().as_deref(),
            Some("2026-11-11,2026-11-27")
        );
        assert_eq!(normalize_skip_dates(&[]).unwrap(), None);
        assert!(normalize_skip_dates(&days(&["11/27"])).is_err());
        assert_eq!(parse_skip_dates(Some("2026-11-11,2026-11-27")), days(&["2026-11-11", "2026-11-27"]));
        assert!(parse_skip_dates(None).is_empty());

        let conn = test_conn();
        let skip = days(&["2026-11-26", "2026-11-11"]);
        let weekly = upsert(&conn, "d", 0, PlanInput { skip_dates: skip.clone(), ..input("2026-09-01", Some("weekly:3,4")) }).unwrap();
        assert_eq!(weekly.skip_dates, days(&["2026-11-11", "2026-11-26"]));
        let one_off = upsert(&conn, "d", 0, PlanInput { skip_dates: skip, ..input("2026-10-02", None) }).unwrap();
        assert!(one_off.skip_dates.is_empty());
        let stored: Option<String> = conn.query_row("SELECT skip_dates FROM plan WHERE id = ?1", [&one_off.id], |r| r.get(0)).unwrap();
        assert_eq!(stored, None);
    }

    #[test]
    fn upsert_by_id_adds_updates_and_revives() {
        let conn = test_conn();
        let (p, how) = upsert_by_id(&conn, "d", 10, "fixed", &input("2026-09-01", Some("weekly:1"))).unwrap();
        assert_eq!((p.id.as_str(), how), ("fixed", Upserted::Added));
        let moved = PlanInput { start_hm: "08:00".into(), ..input("2026-09-01", Some("weekly:1")) };
        let (p, how) = upsert_by_id(&conn, "d", 5, "fixed", &moved).unwrap();
        assert_eq!((p.start_hm.as_str(), how), ("08:00", Upserted::Updated));
        let updated_ms: i64 = conn.query_row("SELECT updated_ms FROM plan WHERE id = 'fixed'", [], |r| r.get(0)).unwrap();
        assert_eq!(updated_ms, 11, "never goes back in time");

        delete(&conn, "d", 20, "fixed").unwrap();
        let (_, how) = upsert_by_id(&conn, "d", 30, "fixed", &moved).unwrap();
        assert_eq!(how, Upserted::Added, "a deleted plan comes back");
        assert!(get(&conn, "fixed").unwrap().is_some());
    }

    #[test]
    fn rejects_inverted_times() {
        let conn = test_conn();
        let bad = PlanInput { end_hm: "08:00".into(), ..input("2026-10-02", None) };
        assert!(matches!(upsert(&conn, "d", 0, bad), Err(Error::Invalid(_))));
    }

    #[test]
    fn list_includes_started_recurring_plans() {
        let conn = test_conn();
        let one_off = upsert(&conn, "d", 0, input("2026-10-02", None)).unwrap();
        upsert(&conn, "d", 0, input("2026-09-01", None)).unwrap(); // outside
        let weekly = upsert(&conn, "d", 0, input("2026-09-01", Some("weekly:1"))).unwrap();
        upsert(&conn, "d", 0, input("2026-11-01", Some("weekly:1"))).unwrap(); // not started yet
        let ended = PlanInput { until: Some("2026-09-20".into()), ..input("2026-09-01", Some("weekly:2")) };
        upsert(&conn, "d", 0, ended).unwrap(); // already over

        let range = DateRange { from: "2026-09-28".into(), to: "2026-10-04".into() };
        let mut ids: Vec<_> = list(&conn, &range).unwrap().into_iter().map(|p| p.id).collect();
        ids.sort();
        let mut expected = vec![one_off.id.clone(), weekly.id];
        expected.sort();
        assert_eq!(ids, expected);

        delete(&conn, "d", 1, &one_off.id).unwrap();
        assert_eq!(list(&conn, &range).unwrap().len(), 1);
    }
}

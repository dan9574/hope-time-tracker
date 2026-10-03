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
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct PlanInput {
    pub id: Option<String>,
    pub activity_id: String,
    pub date: String,
    pub start_hm: String,
    pub end_hm: String,
    pub rule: Option<String>,
}

/// Inclusive range of 'YYYY-MM-DD' dates.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct DateRange {
    pub from: String,
    pub to: String,
}

const COLUMNS: &str = "id, activity_id, date, start_hm, end_hm, rule";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Plan> {
    Ok(Plan {
        id: r.get(0)?,
        activity_id: r.get(1)?,
        date: r.get(2)?,
        start_hm: r.get(3)?,
        end_hm: r.get(4)?,
        rule: r.get(5)?,
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

/// Validates and normalizes; shared by `upsert` and the JSON importer.
pub fn check(input: &PlanInput) -> Result<Option<String>> {
    validate::date(&input.date)?;
    if validate::hm(&input.start_hm)? >= validate::hm(&input.end_hm)? {
        return Err(Error::Invalid("plan must end after it starts".into()));
    }
    normalize_rule(input.rule.as_deref())
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
           AND ((rule IS NULL AND date BETWEEN ?1 AND ?2) OR (rule IS NOT NULL AND date <= ?2))
         ORDER BY start_hm, date"
    );
    let rows = conn
        .prepare(&sql)?
        .query_map([&range.from, &range.to], from_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn upsert(conn: &Connection, device: &str, now: i64, input: PlanInput) -> Result<Plan> {
    let rule = check(&input)?;
    let id = match &input.id {
        Some(id) => {
            let changed = conn.execute(
                "UPDATE plan SET activity_id = ?2, date = ?3, start_hm = ?4, end_hm = ?5, rule = ?6,
                     updated_ms = ?7, device_id = ?8
                 WHERE id = ?1 AND deleted_ms IS NULL",
                params![id, input.activity_id, input.date, input.start_hm, input.end_hm, rule, now, device],
            )?;
            if changed == 0 {
                return Err(Error::NotFound("plan"));
            }
            id.clone()
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO plan (id, activity_id, date, start_hm, end_hm, rule, updated_ms, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, input.activity_id, input.date, input.start_hm, input.end_hm, rule, now, device],
            )?;
            id
        }
    };
    get(conn, &id)?.ok_or(Error::NotFound("plan"))
}

pub fn delete(conn: &Connection, device: &str, now: i64, id: &str) -> Result<()> {
    let changed = conn.execute(
        "UPDATE plan SET deleted_ms = ?2, updated_ms = ?2, device_id = ?3 WHERE id = ?1 AND deleted_ms IS NULL",
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

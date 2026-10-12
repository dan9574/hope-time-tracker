//! Timetable import (rebuild-plan 13.3).
//!
//! The page parses the `.ics` file (time zones need `Intl`) and sends courses with their plans; this module
//! files them under the timetable group in one transaction. Plan ids are UUID v5 of the event's
//! `source_key`, so importing the same file again updates the plans instead of duplicating them.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

use super::activity::{self, Activity, ActivityInput};
use super::autolog::{self, Occurrence};
use super::plan::{self, PlanInput, Upserted};
use crate::error::{Error, Result};

/// Namespace for imported plan ids. Never change it: re-imports and other devices rely on the same ids.
pub const ICS_NAMESPACE: Uuid = Uuid::from_u128(0x9c1d_2e3f_4a5b_4c6d_8e7f_0a1b_2c3d_4e5f);

/// One plan parsed from the file. `source_key` is the event `UID` (merged events: sorted UIDs joined by `|`).
#[derive(Debug, Clone, Deserialize, Type)]
pub struct PlanImportInput {
    pub source_key: String,
    pub date: String,
    pub start_hm: String,
    pub end_hm: String,
    pub rule: Option<String>,
    pub auto_log: bool,
    pub until: Option<String>,
    pub skip_dates: Vec<String>,
    /// Occurrences that already ended, to log as attended (rebuild-plan 13.3.1). Empty when the page's
    /// backfill switch is off; ignored for one-off plans.
    #[serde(default)]
    pub past: Vec<PastOccurrence>,
}

/// One past occurrence of an imported recurring plan, worked out by the page in local time.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct PastOccurrence {
    pub date: String,
    #[specta(type = specta_typescript::Number)]
    pub start_ms: i64,
    #[specta(type = specta_typescript::Number)]
    pub end_ms: i64,
}

/// One course: becomes (or reuses) a sub-activity of the timetable group, by trimmed name.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct CourseImport {
    pub name: String,
    pub plans: Vec<PlanImportInput>,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct ScheduleImport {
    /// Name for the timetable group if it has to be created (localized by the page).
    pub group_name: String,
    pub courses: Vec<CourseImport>,
}

/// Shown to the user after an import, like the JSON import report.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ScheduleImportReport {
    /// Includes the timetable group when it was created.
    pub activities_created: u32,
    pub plans_added: u32,
    pub plans_updated: u32,
    /// Past classes logged by the backfill.
    pub sessions_logged: u32,
}

/// Deterministic id of an imported plan.
pub fn plan_id(source_key: &str) -> String {
    Uuid::new_v5(&ICS_NAMESPACE, format!("hope-ics/{source_key}").as_bytes()).to_string()
}

/// The live sub-activity of `group` named `name`, or a new one. The flag says whether it was created.
fn course_activity(conn: &Connection, device: &str, now: i64, group: &Activity, name: &str) -> Result<(String, bool)> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM activity WHERE parent_id = ?1 AND name = ?2 AND deleted_ms IS NULL
             ORDER BY archived_at IS NOT NULL, sort LIMIT 1",
            params![group.id, name],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return Ok((id, false));
    }
    let input = ActivityInput {
        id: None,
        name: name.into(),
        color: group.color,
        symbol: None,
        sort: None,
        parent_id: Some(group.id.clone()),
        kind: None,
    };
    Ok((activity::upsert(conn, device, now, input)?.id, true))
}

/// Writes the whole import or nothing.
pub fn import(conn: &mut Connection, device: &str, now: i64, input: ScheduleImport) -> Result<ScheduleImportReport> {
    let tx = conn.transaction()?;
    let mut report = ScheduleImportReport::default();
    let (group, created) = activity::schedule_ensure(&tx, device, now, &input.group_name)?;
    report.activities_created += u32::from(created);

    for course in input.courses {
        // An unchecked course arrives without plans; it must not leave an empty sub-activity behind.
        if course.plans.is_empty() {
            continue;
        }
        let (activity_id, created) = course_activity(&tx, device, now, &group, course.name.trim())?;
        report.activities_created += u32::from(created);
        for mut p in course.plans {
            if p.source_key.is_empty() {
                return Err(Error::Invalid("imported plan without a source key".into()));
            }
            let input = PlanInput {
                id: None,
                activity_id: activity_id.clone(),
                date: p.date,
                start_hm: p.start_hm,
                end_hm: p.end_hm,
                rule: p.rule,
                auto_log: p.auto_log,
                until: p.until,
                skip_dates: p.skip_dates,
            };
            let id = plan_id(&p.source_key);
            let (saved, how) = plan::upsert_by_id(&tx, device, now, &id, &input)?;
            match how {
                Upserted::Added => report.plans_added += 1,
                Upserted::Updated => report.plans_updated += 1,
            }
            // Only here may the past be filled in (rebuild-plan 13.3.1); one-off plans never are.
            if saved.rule.is_some() && !p.past.is_empty() {
                p.past.sort_by(|a, b| a.date.cmp(&b.date));
                let occurrences: Vec<Occurrence> = p
                    .past
                    .into_iter()
                    .map(|o| Occurrence { plan_id: id.clone(), date: o.date, start_ms: o.start_ms, end_ms: o.end_ms })
                    .collect();
                report.sessions_logged += autolog::log_in(&tx, device, now, &occurrences, true)?;
            }
        }
    }

    tx.commit()?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::activity::{ActivityColor, KIND_SCHEDULE};
    use crate::db::{session, test_conn};

    fn weekly(key: &str, days: &str, skip: &[&str]) -> PlanImportInput {
        PlanImportInput {
            source_key: key.into(),
            date: "2026-09-24".into(),
            start_hm: "09:00".into(),
            end_hm: "09:50".into(),
            rule: Some(format!("weekly:{days}")),
            auto_log: true,
            until: Some("2026-12-04".into()),
            skip_dates: skip.iter().map(|d| d.to_string()).collect(),
            past: vec![],
        }
    }

    fn exam(key: &str) -> PlanImportInput {
        PlanImportInput {
            source_key: key.into(),
            date: "2026-12-07".into(),
            start_hm: "11:30".into(),
            end_hm: "14:29".into(),
            rule: None,
            auto_log: true,
            until: None,
            skip_dates: vec![],
            past: vec![],
        }
    }

    fn fall() -> ScheduleImport {
        ScheduleImport {
            group_name: "Courses".into(),
            courses: vec![
                CourseImport { name: "CSE 100".into(), plans: vec![weekly("uid-1", "1,3,5", &["2026-11-11"]), exam("uid-2")] },
                CourseImport { name: " CSE 101 ".into(), plans: vec![weekly("uid-3|uid-4", "2,4", &["2026-11-26"])] },
                CourseImport { name: "Unchecked".into(), plans: vec![] },
            ],
        }
    }

    #[test]
    fn plan_ids_are_deterministic() {
        assert_eq!(plan_id("uid-1"), plan_id("uid-1"));
        assert_ne!(plan_id("uid-1"), plan_id("uid-2"));
        assert_eq!(plan_id("abc"), Uuid::new_v5(&ICS_NAMESPACE, b"hope-ics/abc").to_string());
    }

    #[test]
    fn fresh_import_creates_group_courses_and_plans() {
        let mut conn = test_conn();
        let report = import(&mut conn, "d", 100, fall()).unwrap();
        assert_eq!(report, ScheduleImportReport { activities_created: 3, plans_added: 3, plans_updated: 0, sessions_logged: 0 });

        let all = activity::list(&conn, true).unwrap();
        let group = all.iter().find(|a| a.kind.as_deref() == Some(KIND_SCHEDULE)).unwrap();
        assert_eq!((group.name.as_str(), group.color, group.symbol.as_deref()), ("Courses", ActivityColor::Pink, Some("graduationcap")));
        let courses: Vec<_> = all.iter().filter(|a| a.parent_id.as_deref() == Some(&group.id)).collect();
        let mut names: Vec<_> = courses.iter().map(|a| a.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["CSE 100", "CSE 101"], "trimmed, no sub-activity for a course without plans");
        assert!(courses.iter().all(|a| a.color == ActivityColor::Pink), "courses take the group's color");

        let p = plan::get(&conn, &plan_id("uid-1")).unwrap().unwrap();
        assert_eq!((p.rule.as_deref(), p.skip_dates.as_slice()), (Some("weekly:1,3,5"), ["2026-11-11".to_string()].as_slice()));
        assert!(plan::get(&conn, &plan_id("uid-2")).unwrap().unwrap().rule.is_none());
    }

    #[test]
    fn reimport_updates_instead_of_duplicating() {
        let mut conn = test_conn();
        import(&mut conn, "d", 100, fall()).unwrap();
        let before = activity::list(&conn, true).unwrap().len();
        let report = import(&mut conn, "d", 200, fall()).unwrap();
        assert_eq!(report, ScheduleImportReport { activities_created: 0, plans_added: 0, plans_updated: 3, sessions_logged: 0 });
        assert_eq!(activity::list(&conn, true).unwrap().len(), before);
        let plans: i64 = conn.query_row("SELECT COUNT(*) FROM plan", [], |r| r.get(0)).unwrap();
        assert_eq!(plans, 3);
    }

    #[test]
    fn reuses_existing_group_and_course() {
        let mut conn = test_conn();
        let (group, _) = activity::schedule_ensure(&conn, "d", 1, "My classes").unwrap();
        let input = ActivityInput {
            id: None,
            name: "CSE 100".into(),
            color: ActivityColor::Blue,
            symbol: None,
            sort: None,
            parent_id: Some(group.id.clone()),
            kind: None,
        };
        let existing = activity::upsert(&conn, "d", 1, input).unwrap();

        let report = import(&mut conn, "d", 100, fall()).unwrap();
        assert_eq!(report.activities_created, 1, "only CSE 101 is new");
        assert_eq!(plan::get(&conn, &plan_id("uid-1")).unwrap().unwrap().activity_id, existing.id);
        assert_eq!(activity::schedule_group(&conn).unwrap().unwrap().name, "My classes");
    }

    #[test]
    fn a_second_group_cannot_be_created_by_hand() {
        let mut conn = test_conn();
        import(&mut conn, "d", 100, fall()).unwrap();
        let second = ActivityInput {
            id: None,
            name: "Other".into(),
            color: ActivityColor::Blue,
            symbol: None,
            sort: None,
            parent_id: None,
            kind: Some(KIND_SCHEDULE.into()),
        };
        assert!(matches!(activity::upsert(&conn, "d", 200, second), Err(Error::Invalid(_))));
    }

    #[test]
    fn bad_plans_roll_back_everything() {
        let mut conn = test_conn();
        let mut input = fall();
        input.courses[1].plans[0].end_hm = "08:00".into();
        assert!(matches!(import(&mut conn, "d", 100, input), Err(Error::Invalid(_))));
        assert!(activity::list(&conn, true).unwrap().is_empty());
    }

    /// The real sample: `src/lib/__fixtures__/fall2026.ics` parsed by `src/lib/ics.ts` (regenerate with the
    /// parser if its output format changes). Guards the parser → Rust contract end to end.
    /// 2026-10-12 12:00 UTC: "today" for the backfill tests; times are UTC so the test does not depend on the zone.
    const NOW: i64 = 1_791_806_400_000;
    const HOUR: i64 = 3_600_000;
    const WEEK: i64 = 7 * 24 * HOUR;

    fn past(date: &str, start_ms: i64, minutes: i64) -> PastOccurrence {
        PastOccurrence { date: date.into(), start_ms, end_ms: start_ms + minutes * 60_000 }
    }

    /// The sample with the backfill switch on for CSE 100's Monday 17:00 section (two ended Mondays, listed out
    /// of order), plus a `past` on a one-off exam that must be ignored.
    fn fall2026_with_past() -> ScheduleImport {
        let mut input: ScheduleImport = serde_json::from_str(include_str!("fixtures/fall2026-import.json")).unwrap();
        let cse100 = input.courses.iter_mut().find(|c| c.name == "CSE 100").unwrap();
        let monday_1700 = 1_790_614_800_000; // 2026-09-28 17:00 UTC
        let weekly = cse100.plans.iter_mut().find(|p| p.source_key == "tritoncal-fall2026-4@local").unwrap();
        weekly.past = vec![past("2026-10-05", monday_1700 + WEEK, 50), past("2026-09-28", monday_1700, 50)];
        let exam = cse100.plans.iter_mut().find(|p| p.rule.is_none()).unwrap();
        exam.past = vec![past(&exam.date.clone(), NOW - 4 * HOUR, 60)];
        input
    }

    #[test]
    fn imports_the_parsed_fall2026_sample() {
        let mut conn = test_conn();
        let report = import(&mut conn, "d", NOW, fall2026_with_past()).unwrap();
        assert_eq!(
            (report.activities_created, report.plans_added, report.plans_updated, report.sessions_logged),
            (5, 11, 0, 2)
        );
        let monday = plan_id("tritoncal-fall2026-4@local");
        for date in ["2026-09-28", "2026-10-05"] {
            let s = session::get(&conn, &autolog::session_id(&monday, date, 0)).unwrap().unwrap();
            assert_eq!((s.plan_id.as_deref(), s.end_ms.unwrap() - s.start_ms), (Some(monday.as_str()), 50 * 60_000));
        }
        let logged: i64 = conn.query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0)).unwrap();
        assert_eq!(logged, 2, "nothing for the one-off exam");

        let group = activity::schedule_group(&conn).unwrap().unwrap();
        assert_eq!((group.name.as_str(), group.color, group.kind.as_deref()), ("课程", ActivityColor::Pink, Some(KIND_SCHEDULE)));
        let mut courses: Vec<String> = activity::list(&conn, false)
            .unwrap()
            .into_iter()
            .filter(|a| a.parent_id.as_deref() == Some(group.id.as_str()))
            .map(|a| a.name)
            .collect();
        courses.sort();
        assert_eq!(courses, ["CSE 100", "CSE 101", "MUS 127", "PHIL 27"]);

        let plans = plan::list(&conn, &plan::DateRange { from: "2026-09-01".into(), to: "2026-12-31".into() }).unwrap();
        assert_eq!(plans.len(), 11);
        let weekly = plans.iter().filter(|p| p.rule.is_some()).count();
        assert_eq!(weekly, 7);
        let cse100 = plans.iter().find(|p| p.rule.as_deref() == Some("weekly:1,3,5") && p.start_hm == "09:00").unwrap();
        assert_eq!(cse100.until.as_deref(), Some("2026-12-04"));
        assert_eq!(cse100.skip_dates, ["2026-11-11", "2026-11-27"]);
        assert!(plans.iter().filter(|p| p.rule.is_none()).all(|p| p.skip_dates.is_empty() && p.until.is_none()));
    }

    #[test]
    fn reimporting_the_same_past_logs_nothing_more() {
        let mut conn = test_conn();
        assert_eq!(import(&mut conn, "d", NOW, fall2026_with_past()).unwrap().sessions_logged, 2);
        let again = import(&mut conn, "d", NOW + HOUR, fall2026_with_past()).unwrap();
        assert_eq!((again.plans_updated, again.sessions_logged), (11, 0));
        let logged: i64 = conn.query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0)).unwrap();
        assert_eq!(logged, 2);
    }

    #[test]
    fn a_failed_import_logs_nothing() {
        let mut conn = test_conn();
        let mut input = fall2026_with_past();
        let last = input.courses.last_mut().unwrap();
        last.plans.last_mut().unwrap().end_hm = "00:00".into();
        assert!(import(&mut conn, "d", NOW, input).is_err());
        let logged: i64 = conn.query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0)).unwrap();
        assert_eq!(logged, 0, "the backfill rolls back with the plans");
    }
}

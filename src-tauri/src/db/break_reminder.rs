//! The "take a break" reminder rules (rebuild-plan 15.2) — the Rust twin of HopeCore's `BreakReminder`.
//!
//! A pause/resume chain that has run `elapsed` (pauses excluded, the number the timer shows) is reminded
//! each time it reaches N × 90 minutes. Each device fires at that moment plus its own offset (watch 0,
//! desktop +1 min, iPhone +2 min); a "Keep Going" stamped on the chain (`session.break_ack_ms`) at or
//! after a step's due time settles that step everywhere.

use rusqlite::Connection;

use super::activity::{self, KIND_EXERCISE, KIND_SCHEDULE};
use super::session::{self, Session};
use crate::error::Result;

/// Remind every time the chain has run this much more.
pub const INTERVAL_MS: i64 = 90 * 60_000;
/// The desktop fires one minute after the watch (rebuild-plan 15.2).
pub const DESKTOP_OFFSET_MS: i64 = 60_000;
/// How many future steps a scheduling device (the Apple apps) lines up ahead; the polling desktop asks for one.
#[cfg(test)]
pub const LOOKAHEAD: usize = 4;

/// One reminder of a chain: the N-th (1-based), when it is due, and when this device fires it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Due {
    pub step: i64,
    pub due_ms: i64,
    pub fire_at_ms: i64,
}

/// The reminders a device should have scheduled for a running chain, oldest first.
///
/// `elapsed_ms` is the chain's running time at `now_ms`, pauses excluded; `ack_ms` the chain's latest
/// `break_ack_ms`. A step whose due time is at or before the acknowledgement is settled. A step already
/// overdue (the device learned about the chain late) fires right away — only the most recent one; older
/// overdue steps are dropped rather than delivered in a burst.
pub fn pending(elapsed_ms: i64, now_ms: i64, ack_ms: Option<i64>, offset_ms: i64, lookahead: usize) -> Vec<Due> {
    let elapsed = elapsed_ms.max(0);
    let reached = elapsed / INTERVAL_MS;
    let first = reached.max(1);
    let last = reached + lookahead as i64;
    (first..=last)
        .filter_map(|step| {
            let due = now_ms + step * INTERVAL_MS - elapsed;
            if ack_ms.is_some_and(|ack| ack >= due) {
                return None;
            }
            Some(Due { step, due_ms: due, fire_at_ms: due.max(now_ms) + offset_ms })
        })
        .collect()
}

/// Exercise and timetable time get no reminder (rebuild-plan 15.2): the activity or its parent carries
/// the kind. Unknown activities (not synced yet) are reminded like any other.
pub fn exempt(conn: &Connection, activity_id: &str) -> Result<bool> {
    let Some(a) = activity::get(conn, activity_id)? else { return Ok(false) };
    let is_exempt = |kind: &Option<String>| matches!(kind.as_deref(), Some(KIND_EXERCISE) | Some(KIND_SCHEDULE));
    if is_exempt(&a.kind) {
        return Ok(true);
    }
    match a.parent_id {
        Some(p) => Ok(activity::get(conn, &p)?.is_some_and(|p| is_exempt(&p.kind))),
        None => Ok(false),
    }
}

/// What the desktop should remind about right now, if anything: the running chain's next step, once it
/// has been due for the desktop's offset. `None` while nothing runs, the activity is exempt, or the step
/// is settled. (The desktop polls, so it looks at `due_ms`; `fire_at_ms` is for devices that schedule.)
pub fn desktop_due(conn: &Connection, now_ms: i64) -> Result<Option<(Session, String, Due)>> {
    let Some(running) = session::current(conn)?.running else { return Ok(None) };
    if exempt(conn, &running.activity_id)? {
        return Ok(None);
    }
    let elapsed = session::chain_duration_ms(conn, &running, now_ms)?;
    let ack = session::chain_break_ack_ms(conn, &running)?;
    let chain = session::chain_root_id(conn, &running)?;
    let next = pending(elapsed, now_ms, ack, DESKTOP_OFFSET_MS, 1).into_iter().next();
    Ok(next.filter(|d| d.due_ms + DESKTOP_OFFSET_MS <= now_ms).map(|d| (running, chain, d)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::activity::{ActivityColor, ActivityInput};
    use crate::db::test_conn;

    const MINUTE: i64 = 60_000;

    fn steps(d: &[Due]) -> Vec<i64> {
        d.iter().map(|d| d.step).collect()
    }

    #[test]
    fn fresh_chain_schedules_the_next_steps_from_now() {
        let now = 1_000_000;
        let due = pending(0, now, None, 0, LOOKAHEAD);
        assert_eq!(steps(&due), [1, 2, 3, 4]);
        assert_eq!(due[0].due_ms, now + INTERVAL_MS);
        assert_eq!(due[3].due_ms, now + 4 * INTERVAL_MS);
        assert!(due.iter().all(|d| d.fire_at_ms == d.due_ms));
    }

    #[test]
    fn elapsed_time_and_offsets_shift_the_fire_times() {
        let now = 5_000_000;
        let desktop = pending(30 * MINUTE, now, None, DESKTOP_OFFSET_MS, LOOKAHEAD);
        assert_eq!(desktop[0], Due { step: 1, due_ms: now + 60 * MINUTE, fire_at_ms: now + 61 * MINUTE });
        let phone = pending(30 * MINUTE, now, None, 2 * MINUTE, LOOKAHEAD);
        assert_eq!(phone[0].fire_at_ms, now + 62 * MINUTE);
    }

    #[test]
    fn an_overdue_step_fires_now_and_only_the_latest_one() {
        let now = 9_000_000;
        let late = pending(100 * MINUTE, now, None, 0, LOOKAHEAD);
        assert_eq!(late[0], Due { step: 1, due_ms: now - 10 * MINUTE, fire_at_ms: now });
        assert_eq!(steps(&late), [1, 2, 3, 4, 5]);
        let later = pending(200 * MINUTE, now, None, 0, LOOKAHEAD);
        assert_eq!(steps(&later), [2, 3, 4, 5, 6]);
        assert_eq!(later[0].fire_at_ms, now);
        let exact = pending(INTERVAL_MS, now, None, 0, LOOKAHEAD);
        assert_eq!(exact[0], Due { step: 1, due_ms: now, fire_at_ms: now });
    }

    #[test]
    fn keep_going_settles_the_step_that_was_due() {
        let now = 9_000_000;
        let acked = pending(95 * MINUTE, now, Some(now - 3 * MINUTE), 0, LOOKAHEAD);
        assert_eq!(steps(&acked), [2, 3, 4, 5]);
        let stale = pending(95 * MINUTE, now, Some(now - 10 * MINUTE), 0, LOOKAHEAD);
        assert_eq!(stale[0].step, 1);
        let both = pending(185 * MINUTE, now, Some(now - MINUTE), 0, LOOKAHEAD);
        assert_eq!(steps(&both), [3, 4, 5, 6]);
    }

    #[test]
    fn lookahead_bounds() {
        assert_eq!(pending(0, 0, None, 0, 1).len(), 1);
        assert!(pending(10 * MINUTE, 0, None, 0, 0).is_empty(), "nothing reached and nothing ahead");
    }

    fn input(name: &str) -> ActivityInput {
        ActivityInput { id: None, name: name.into(), color: ActivityColor::Blue, symbol: None, sort: None, parent_id: None, kind: None }
    }

    #[test]
    fn exercise_and_timetable_are_exempt_children_included() {
        let conn = test_conn();
        let study = activity::upsert(&conn, "d", 1, input("Study")).unwrap();
        let run = activity::upsert(&conn, "d", 2, ActivityInput { kind: Some(KIND_EXERCISE.into()), ..input("Run") }).unwrap();
        let sprint = activity::upsert(&conn, "d", 3, ActivityInput { parent_id: Some(run.id.clone()), ..input("Sprints") }).unwrap();
        let (courses, _) = activity::schedule_ensure(&conn, "d", 4, "Courses").unwrap();
        assert!(!exempt(&conn, &study.id).unwrap());
        assert!(exempt(&conn, &run.id).unwrap());
        assert!(exempt(&conn, &sprint.id).unwrap(), "children follow the parent");
        assert!(exempt(&conn, &courses.id).unwrap());
        assert!(!exempt(&conn, "missing").unwrap());
    }

    #[test]
    fn desktop_due_follows_the_running_chain() {
        let mut conn = test_conn();
        let study = activity::upsert(&conn, "d", 1, input("Study")).unwrap();
        let run = activity::upsert(&conn, "d", 2, ActivityInput { kind: Some(KIND_EXERCISE.into()), ..input("Run") }).unwrap();
        assert!(desktop_due(&conn, 0).unwrap().is_none(), "nothing running");

        let first = session::start(&mut conn, "d", 0, &study.id).unwrap();
        assert!(desktop_due(&conn, 90 * MINUTE).unwrap().is_none(), "due, but the desktop waits a minute");
        let (s, chain, due) = desktop_due(&conn, 91 * MINUTE).unwrap().unwrap();
        assert_eq!((s.id.as_str(), chain.as_str(), due.step), (first.id.as_str(), first.id.as_str(), 1));

        // A pause does not reset the count; the chain id is the first segment's.
        session::pause(&mut conn, "d", 95 * MINUTE).unwrap();
        assert!(desktop_due(&conn, 100 * MINUTE).unwrap().is_none(), "paused: nothing to remind");
        session::resume(&mut conn, "d", 120 * MINUTE).unwrap();
        let (_, chain, due) = desktop_due(&conn, 121 * MINUTE).unwrap().unwrap();
        assert_eq!((chain.as_str(), due.step), (first.id.as_str(), 1), "still step 1: 96 minutes of running time");

        // Keep Going on another device settles step 1 once it syncs here; step 2 is at 180 running minutes.
        session::break_ack(&conn, "w", 122 * MINUTE).unwrap();
        assert!(desktop_due(&conn, 125 * MINUTE).unwrap().is_none());
        // 180 minutes of running time = 25 minutes of pause later, at 205; the desktop fires at 206.
        assert!(desktop_due(&conn, 205 * MINUTE).unwrap().is_none());
        assert_eq!(desktop_due(&conn, 206 * MINUTE).unwrap().unwrap().2.step, 2);

        // Exercise never reminds.
        session::start(&mut conn, "d", 300 * MINUTE, &run.id).unwrap();
        assert!(desktop_due(&conn, 500 * MINUTE).unwrap().is_none());
    }
}

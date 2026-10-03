//! Engine tests against the in-memory server (rebuild-plan 12.6).

use std::rc::Rc;

use rusqlite::Connection;

use super::engine::{self, cursor_key, Remote};
use super::error::SyncErrorCode;
use super::fake::FakeServer;
use super::tables::{dirty_count, Row, TABLES};
use crate::db::activity::{self, ActivityColor, ActivityInput};
use crate::db::day::{self, DayInput};
use crate::db::plan::{self, PlanInput};
use crate::db::session::{self, SessionInput};
use crate::db::{autolog, journal, setting, transfer, Db};

const SERVER_NOW: i64 = 1_000_000;

fn device(name: &str) -> Db {
    Db::in_memory(name)
}

fn add_activity(db: &Db, now: i64, name: &str) -> String {
    activity::upsert(
        &db.conn(),
        db.device_id(),
        now,
        ActivityInput { id: None, name: name.into(), color: ActivityColor::Blue, symbol: None, sort: None, parent_id: None },
    )
    .unwrap()
    .id
}

fn rename(db: &Db, now: i64, id: &str, name: &str) {
    activity::upsert(
        &db.conn(),
        db.device_id(),
        now,
        ActivityInput { id: Some(id.into()), name: name.into(), color: ActivityColor::Blue, symbol: None, sort: None, parent_id: None },
    )
    .unwrap();
}

fn add_session(db: &Db, now: i64, activity_id: &str, start: i64, end: i64) -> String {
    session::upsert(
        &db.conn(),
        db.device_id(),
        now,
        SessionInput { id: None, activity_id: activity_id.into(), start_ms: start, end_ms: Some(end), note: None },
    )
    .unwrap()
    .id
}

fn sync(db: &Db, server: &impl Remote) -> bool {
    engine::sync(db, server).unwrap()
}

/// Every synced row with every synced column, for comparing devices.
fn dump(db: &Db) -> Vec<Row> {
    let conn = db.conn();
    let mut out = Vec::new();
    for t in &TABLES {
        let sql = format!("SELECT {} FROM {} ORDER BY {}", t.columns.join(", "), t.name, t.key);
        let mut stmt = conn.prepare(&sql).unwrap();
        let mut rows = stmt.query([]).unwrap();
        while let Some(r) = rows.next().unwrap() {
            let mut row = Row::new();
            row.insert("_table".into(), t.name.into());
            for (i, c) in t.columns.iter().enumerate() {
                let v: rusqlite::types::Value = r.get(i).unwrap();
                let j = match v {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(n) => n.into(),
                    rusqlite::types::Value::Text(s) => s.into(),
                    other => panic!("unexpected {other:?}"),
                };
                row.insert((*c).into(), j);
            }
            out.push(row);
        }
    }
    out
}

fn dirty(db: &Db) -> u32 {
    dirty_count(&db.conn()).unwrap()
}

fn is_dirty(conn: &Connection, table: &str, key_col: &str, key: &str) -> bool {
    conn.query_row(&format!("SELECT dirty FROM {table} WHERE {key_col} = ?1"), [key], |r| r.get(0)).unwrap()
}

fn mark_clean(conn: &Connection) {
    for t in &TABLES {
        conn.execute(&format!("UPDATE {} SET dirty = 0", t.name), []).unwrap();
    }
}

fn name_of(db: &Db, id: &str) -> String {
    activity::get(&db.conn(), id).unwrap().unwrap().name
}

fn assert_converged(a: &Db, b: &Db) {
    assert_eq!(dump(a), dump(b), "devices hold the same rows");
    assert_eq!((dirty(a), dirty(b)), (0, 0), "nothing left to push");
}

#[test]
fn two_devices_converge() {
    let server = FakeServer::new(SERVER_NOW);
    let a = device("device-a");
    let b = device("device-b");

    let study = add_activity(&a, 100, "Study");
    session::start(&mut a.conn(), a.device_id(), 200, &study).unwrap();
    session::stop(&mut a.conn(), a.device_id(), 300).unwrap();
    plan::upsert(
        &a.conn(),
        a.device_id(),
        310,
        PlanInput {
            id: None,
            activity_id: study.clone(),
            date: "2026-10-01".into(),
            start_hm: "09:00".into(),
            end_hm: "10:00".into(),
            rule: Some("weekly:1".into()),
            auto_log: true,
            until: None,
        },
    )
    .unwrap();
    journal::upsert(&a.conn(), a.device_id(), 320, "2026-10-03", "from a").unwrap();
    day::set(&a.conn(), a.device_id(), 330, DayInput { date: "2026-10-03".into(), wake_ms: Some(7), sleep_ms: None, utc_offset_min: 480 })
        .unwrap();
    let read = add_activity(&b, 150, "Read");
    journal::upsert(&b.conn(), b.device_id(), 340, "2026-10-02", "from b").unwrap();

    sync(&a, &server);
    assert!(sync(&b, &server), "b received a's rows");
    assert!(sync(&a, &server), "a received b's rows");

    assert_converged(&a, &b);
    assert_eq!(activity::list(&a.conn(), false).unwrap().len(), 2);
    assert_eq!(name_of(&a, &read), "Read");
    assert_eq!(server.len("session"), 1);
    assert_eq!(server.len("day"), 1);
}

#[test]
fn offline_edits_merge_last_write_wins() {
    let server = FakeServer::new(SERVER_NOW);
    let a = device("device-a");
    let b = device("device-b");
    let x = add_activity(&a, 100, "Work");
    let s = add_session(&a, 100, &x, 1_000, 2_000);
    sync(&a, &server);
    sync(&b, &server);

    server.set_offline(true);
    rename(&a, 1_000, &x, "Deep work");
    rename(&b, 900, &x, "Focus"); // older than a's rename
    session::upsert(
        &b.conn(),
        b.device_id(),
        950,
        SessionInput { id: Some(s.clone()), activity_id: x.clone(), start_ms: 1_000, end_ms: Some(2_000), note: Some("edited".into()) },
    )
    .unwrap();
    let err = engine::sync(&a, &server).unwrap_err();
    assert_eq!(err.code, SyncErrorCode::Network);
    assert_eq!(dirty(&a), 1, "still waiting to push");

    server.set_offline(false);
    sync(&b, &server);
    sync(&a, &server);
    sync(&b, &server);

    assert_converged(&a, &b);
    assert_eq!(name_of(&b, &x), "Deep work", "newer rename wins on both");
    assert_eq!(session::get(&a.conn(), &s).unwrap().unwrap().note.as_deref(), Some("edited"), "independent edit survives");
}

#[test]
fn equal_timestamps_break_ties_by_device_id() {
    let server = FakeServer::new(SERVER_NOW);
    let a = device("device-a");
    let b = device("device-b");
    let x = add_activity(&a, 100, "Work");
    sync(&a, &server);
    sync(&b, &server);

    rename(&a, 500, &x, "From A");
    rename(&b, 500, &x, "From B");
    sync(&a, &server);
    sync(&b, &server);
    sync(&a, &server);

    assert_converged(&a, &b);
    assert_eq!(name_of(&a, &x), "From B", "device-b > device-a");
}

#[test]
fn delete_versus_edit_newer_wins() {
    // Delete is newer: the edit loses, the record is gone everywhere.
    let server = FakeServer::new(SERVER_NOW);
    let a = device("device-a");
    let b = device("device-b");
    let x = add_activity(&a, 100, "Work");
    let s = add_session(&a, 100, &x, 1_000, 2_000);
    sync(&a, &server);
    sync(&b, &server);

    session::delete(&a.conn(), a.device_id(), 2_000, &s).unwrap();
    session::upsert(
        &b.conn(),
        b.device_id(),
        1_500,
        SessionInput { id: Some(s.clone()), activity_id: x.clone(), start_ms: 1_000, end_ms: Some(1_800), note: None },
    )
    .unwrap();
    sync(&b, &server);
    sync(&a, &server);
    sync(&b, &server);
    assert_converged(&a, &b);
    assert!(session::get(&b.conn(), &s).unwrap().is_none(), "deleted on b too");

    // Edit is newer: rows are whole-row last-write-wins, so the edit brings the record back.
    let t = add_session(&a, 3_000, &x, 5_000, 6_000);
    sync(&a, &server);
    sync(&b, &server);
    session::delete(&a.conn(), a.device_id(), 3_500, &t).unwrap();
    session::upsert(
        &b.conn(),
        b.device_id(),
        4_000,
        SessionInput { id: Some(t.clone()), activity_id: x.clone(), start_ms: 5_000, end_ms: Some(5_500), note: None },
    )
    .unwrap();
    sync(&a, &server);
    sync(&b, &server);
    sync(&a, &server);
    assert_converged(&a, &b);
    assert_eq!(session::get(&a.conn(), &t).unwrap().unwrap().end_ms, Some(5_500));
}

#[test]
fn only_one_session_runs_across_devices() {
    let server = FakeServer::new(SERVER_NOW);
    let a = device("device-a");
    let b = device("device-b");
    let x = add_activity(&a, 100, "Work");
    sync(&a, &server);
    sync(&b, &server);

    // Both start a timer without knowing about the other. b's starts later.
    let first = session::start(&mut a.conn(), a.device_id(), 1_000, &x).unwrap();
    let second = session::start(&mut b.conn(), b.device_id(), 2_000, &x).unwrap();
    sync(&b, &server); // the later one reaches the server first
    sync(&a, &server);
    sync(&b, &server);

    assert_converged(&a, &b);
    for db in [&a, &b] {
        let state = session::current(&db.conn()).unwrap();
        assert_eq!(state.running.unwrap().id, second.id, "the later start keeps running");
        let ended = session::get(&db.conn(), &first.id).unwrap().unwrap();
        assert_eq!(ended.end_ms, Some(2_000), "the earlier one ends where the later one starts");
        let running: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM session WHERE end_ms IS NULL AND deleted_ms IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(running, 1);
    }
}

#[test]
fn repeated_pull_is_idempotent() {
    let server = FakeServer::new(SERVER_NOW);
    let a = device("device-a");
    let b = device("device-b");
    let x = add_activity(&a, 100, "Work");
    add_session(&a, 100, &x, 1_000, 2_000);
    sync(&a, &server);
    assert!(sync(&b, &server));
    let before = dump(&b);

    assert!(!engine::pull(&b, &server).unwrap(), "nothing new");
    // Even from scratch: every row is already there with the same version.
    for t in &TABLES {
        setting::remove(&b.conn(), &cursor_key(t)).unwrap();
    }
    assert!(!engine::pull(&b, &server).unwrap(), "re-reading everything changes nothing");
    assert_eq!(dump(&b), before);
    assert_eq!(dirty(&b), 0);
}

#[test]
fn pull_pages_past_the_row_limit() {
    let server = FakeServer::new(SERVER_NOW);
    let a = device("device-a");
    let b = device("device-b");
    {
        let conn = a.conn();
        for i in 0..2_500 {
            conn.execute(
                "INSERT INTO session (id, activity_id, start_ms, end_ms, updated_ms, device_id) VALUES (?1, 'x', ?2, ?3, 1, 'device-a')",
                rusqlite::params![format!("s{i:05}"), i * 10, i * 10 + 5],
            )
            .unwrap();
        }
    }
    engine::push(&a, &server).unwrap();
    assert_eq!(server.upserts(), 5, "500 rows per request");
    assert_eq!(dirty(&a), 0);

    let fetches = server.fetches();
    assert!(engine::pull(&b, &server).unwrap());
    assert_eq!(server.fetches() - fetches, 3 + 4, "three session pages, one page for each other table");
    let n: i64 = b.conn().query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 2_500);
    let cursor: i64 = setting::get(&b.conn(), &cursor_key(&TABLES[2])).unwrap().unwrap().parse().unwrap();
    assert_eq!(cursor, 2_500);
}

#[test]
fn overlap_catches_rows_committed_out_of_order() {
    let server = FakeServer::new(SERVER_NOW);
    let a = device("device-a");
    let b = device("device-b");
    let c = device("device-c");

    // a's transaction takes sequence 1 but commits late; b's takes 2 and commits at once.
    server.hold_commits();
    let slow = add_activity(&a, 100, "Slow");
    engine::push(&a, &server).unwrap();
    server.stop_holding();
    let fast = add_activity(&b, 100, "Fast");
    engine::push(&b, &server).unwrap();

    engine::pull(&c, &server).unwrap();
    assert!(activity::get(&c.conn(), &fast).unwrap().is_some());
    assert!(activity::get(&c.conn(), &slow).unwrap().is_none(), "not visible yet");
    let cursor = setting::get(&c.conn(), "sync.cursor.activity").unwrap();
    assert_eq!(cursor.as_deref(), Some("2"), "the cursor is already past a's row");

    server.commit_held();
    assert!(engine::pull(&c, &server).unwrap());
    assert_eq!(name_of(&c, &slow), "Slow", "re-reading the last 50 sequence numbers found it");
}

#[test]
fn push_rejected_by_newer_server_copy_takes_it() {
    let server = FakeServer::new(SERVER_NOW);
    let a = device("device-a");
    let b = device("device-b");
    let x = add_activity(&a, 100, "Work");
    sync(&a, &server);
    sync(&b, &server);

    rename(&b, 3_000, &x, "Newer");
    sync(&b, &server);
    rename(&a, 2_500, &x, "Older");
    assert!(engine::push(&a, &server).unwrap(), "the server's answer changed a");
    assert_eq!(name_of(&a, &x), "Newer");
    assert_eq!(dirty(&a), 0);
}

#[test]
fn edit_during_push_stays_dirty() {
    let server = FakeServer::new(SERVER_NOW);
    let a = Rc::new(device("device-a"));
    let x = add_activity(&a, 100, "Work");
    rename(&a, 200, &x, "Pushed");

    let a2 = Rc::clone(&a);
    let x2 = x.clone();
    // Same millisecond as the version being pushed: the write still has to win.
    server.on_next_upsert(move || rename(&a2, 200, &x2, "Edited meanwhile"));
    engine::push(&*a, &server).unwrap();
    assert_eq!(name_of(&a, &x), "Edited meanwhile");
    assert_eq!(dirty(&a), 1, "the newer local edit is still waiting");

    engine::push(&*a, &server).unwrap();
    assert_eq!(dirty(&a), 0);
    assert_eq!(server.row("activity", &x).unwrap()["name"], "Edited meanwhile");
}

#[test]
fn switching_account_reoffers_everything() {
    let server = FakeServer::new(SERVER_NOW);
    let a = device("device-a");
    add_activity(&a, 100, "Work");
    sync(&a, &server);
    assert_eq!(dirty(&a), 0);

    super::tables::reset_for_new_account(&a.conn()).unwrap();
    assert_eq!(dirty(&a), 1);
    assert!(setting::get(&a.conn(), "sync.cursor.activity").unwrap().is_none());

    let other = FakeServer::new(SERVER_NOW);
    sync(&a, &other);
    assert_eq!(other.len("activity"), 1);
}

#[test]
fn every_local_write_marks_the_row_dirty() {
    let db = device("d");
    let dev = db.device_id().to_owned();
    let mut conn = db.conn();
    let a = activity::upsert(
        &conn,
        &dev,
        1,
        ActivityInput { id: None, name: "A".into(), color: ActivityColor::Blue, symbol: None, sort: None, parent_id: None },
    )
    .unwrap()
    .id;
    let spare = activity::upsert(
        &conn,
        &dev,
        1,
        ActivityInput { id: None, name: "B".into(), color: ActivityColor::Gray, symbol: None, sort: None, parent_id: None },
    )
    .unwrap()
    .id;
    let p = plan::upsert(
        &conn,
        &dev,
        1,
        PlanInput {
            id: None,
            activity_id: a.clone(),
            date: "2026-09-01".into(),
            start_hm: "09:00".into(),
            end_hm: "10:00".into(),
            rule: Some("weekly:1".into()),
            auto_log: true,
            until: None,
        },
    )
    .unwrap()
    .id;
    let j = journal::upsert(&conn, &dev, 1, "2026-10-03", "x").unwrap().unwrap().id;
    let s = session::start(&mut conn, &dev, 10, &a).unwrap().id;

    macro_rules! check {
        ($what:literal, $table:literal, $key_col:literal, $key:expr, $op:expr) => {{
            mark_clean(&conn);
            $op;
            assert!(is_dirty(&conn, $table, $key_col, &$key), "{} must mark {} dirty", $what, $table);
        }};
    }
    let input = |name: &str| ActivityInput { id: Some(a.clone()), name: name.into(), color: ActivityColor::Green, symbol: None, sort: None, parent_id: None };

    check!("activity edit", "activity", "id", a, activity::upsert(&conn, &dev, 20, input("A2")).unwrap());
    check!("archive", "activity", "id", a, activity::set_archived(&conn, &dev, 21, &a, true).unwrap());
    check!("unarchive", "activity", "id", a, activity::set_archived(&conn, &dev, 22, &a, false).unwrap());
    check!("reorder", "activity", "id", spare, activity::reorder(&mut conn, &dev, 23, &[spare.clone(), a.clone()]).unwrap());
    check!("pause", "session", "id", s, session::pause(&mut conn, &dev, 30).unwrap());
    let resumed = session::resume(&mut conn, &dev, 40).unwrap().id;
    check!("start ends the running one", "session", "id", resumed, session::start(&mut conn, &dev, 50, &a).unwrap());
    let running = session::current(&conn).unwrap().running.unwrap().id;
    check!("stop", "session", "id", running, session::stop(&mut conn, &dev, 60).unwrap());
    check!("session edit", "session", "id", s, {
        session::upsert(&conn, &dev, 70, SessionInput { id: Some(s.clone()), activity_id: a.clone(), start_ms: 10, end_ms: Some(25), note: Some("n".into()) })
            .unwrap()
    });
    check!("session delete", "session", "id", s, session::delete(&conn, &dev, 80, &s).unwrap());
    check!("plan edit", "plan", "id", p, {
        let input = PlanInput {
            id: Some(p.clone()),
            activity_id: a.clone(),
            date: "2026-09-01".into(),
            start_hm: "09:00".into(),
            end_hm: "11:00".into(),
            rule: Some("weekly:1".into()),
            auto_log: true,
            until: None,
        };
        plan::upsert(&conn, &dev, 90, input).unwrap()
    });
    check!("autolog", "session", "id", autolog::session_id(&p, "2026-09-07", 0), {
        let occ = autolog::Occurrence { plan_id: p.clone(), date: "2026-09-07".into(), start_ms: 100, end_ms: 200_000 };
        assert_eq!(autolog::log(&mut conn, &dev, 300_000, &[occ]).unwrap(), 1);
    });
    check!("plan delete", "plan", "id", p, plan::delete(&conn, &dev, 100, &p).unwrap());
    check!("journal edit", "journal", "id", j, journal::upsert(&conn, &dev, 110, "2026-10-03", "y").unwrap());
    check!("journal clear", "journal", "id", j, journal::upsert(&conn, &dev, 120, "2026-10-03", " ").unwrap());
    check!("day set", "day", "date", "2026-10-03".to_string(), {
        day::set(&conn, &dev, 130, DayInput { date: "2026-10-03".into(), wake_ms: Some(1), sleep_ms: None, utc_offset_min: 0 }).unwrap()
    });
    check!("wake", "day", "date", "2026-10-03".to_string(), day::wake_now(&conn, &dev, 140, "2026-10-03", 0).unwrap());
    check!("sleep", "day", "date", "2026-10-03".to_string(), day::sleep_now(&mut conn, &dev, 150, "2026-10-03", 0).unwrap());
    check!("activity delete", "activity", "id", spare, activity::delete(&mut conn, &dev, 160, &spare).unwrap());
    check!("import", "activity", "id", "imported".to_string(), {
        let file = transfer::parse(r#"{"format":"hope/1","activity":[{"id":"imported","name":"I","color":"pink","updated_ms":5}]}"#).unwrap();
        transfer::import(&mut conn, &dev, 170, file).unwrap()
    });
    check!("wipe", "activity", "id", a, transfer::wipe(&mut conn, &dev, 180).unwrap());
}

#[test]
fn local_writes_always_move_the_version_forward() {
    // A clock that went backwards must not produce a version the server would ignore.
    let db = device("d");
    let x = add_activity(&db, 1_000, "Work");
    rename(&db, 500, &x, "Later edit, earlier clock");
    let ms: i64 = db.conn().query_row("SELECT updated_ms FROM activity WHERE id = ?1", [&x], |r| r.get(0)).unwrap();
    assert_eq!(ms, 1_001);
}

#[test]
fn export_does_not_include_dirty() {
    let db = device("d");
    add_activity(&db, 1, "Work");
    let json = serde_json::to_string(&transfer::export(&db.conn(), 2).unwrap()).unwrap();
    assert!(!json.contains("dirty"));
}

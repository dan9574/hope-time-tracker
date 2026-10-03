//! In-memory stand-in for the Supabase tables of `supabase/schema.sql`, for engine tests (rebuild-plan 12.6).
//! It implements the same rules as the SQL triggers: last write wins on `(updated_ms, device_id)`, a
//! global `server_seq`, and "only one running session".

use std::cell::RefCell;
use std::collections::{BTreeMap, HashSet};

use serde_json::Value as Json;

use super::engine::Remote;
use super::error::{SyncError, SyncErrorCode};
use super::tables::{key_of, Row, Table, Version};

#[derive(Default)]
struct State {
    seq: i64,
    /// table → key → row (with `server_seq`).
    rows: BTreeMap<&'static str, BTreeMap<String, Row>>,
    /// Rows written by a transaction that has taken its sequence numbers but not committed yet.
    uncommitted: HashSet<(&'static str, String)>,
    holding: bool,
    offline: bool,
    /// Server clock, used when the running-session rule ends a session.
    now_ms: i64,
    upserts: usize,
    fetches: usize,
}

#[derive(Default)]
pub struct FakeServer {
    state: RefCell<State>,
    /// Runs in the middle of an upsert, after the rows reached the "server" — to simulate a local
    /// edit landing while a push is in flight.
    during_upsert: RefCell<Option<Box<dyn FnMut()>>>,
}

impl FakeServer {
    pub fn new(now_ms: i64) -> Self {
        let s = Self::default();
        s.state.borrow_mut().now_ms = now_ms;
        s
    }

    pub fn set_offline(&self, offline: bool) {
        self.state.borrow_mut().offline = offline;
    }

    /// Subsequent upserts take sequence numbers but stay invisible until `commit_held`.
    pub fn hold_commits(&self) {
        self.state.borrow_mut().holding = true;
    }

    /// New upserts commit normally again; rows already held stay invisible.
    pub fn stop_holding(&self) {
        self.state.borrow_mut().holding = false;
    }

    /// The slow transaction finally commits.
    pub fn commit_held(&self) {
        let mut st = self.state.borrow_mut();
        st.holding = false;
        st.uncommitted.clear();
    }

    pub fn on_next_upsert(&self, f: impl FnMut() + 'static) {
        *self.during_upsert.borrow_mut() = Some(Box::new(f));
    }

    pub fn upserts(&self) -> usize {
        self.state.borrow().upserts
    }

    pub fn fetches(&self) -> usize {
        self.state.borrow().fetches
    }

    pub fn row(&self, table: &str, key: &str) -> Option<Row> {
        self.state.borrow().rows.get(table).and_then(|t| t.get(key)).cloned()
    }

    pub fn len(&self, table: &str) -> usize {
        self.state.borrow().rows.get(table).map_or(0, BTreeMap::len)
    }

    /// Ends every running session of the user except the one that started last (AFTER trigger).
    fn single_running(st: &mut State) {
        let now = st.now_ms;
        let Some(sessions) = st.rows.get("session") else { return };
        let mut running: Vec<(i64, String)> = sessions
            .values()
            .filter(|r| r["end_ms"].is_null() && r["deleted_ms"].is_null())
            .map(|r| (r["start_ms"].as_i64().unwrap(), r["id"].as_str().unwrap().to_owned()))
            .collect();
        running.sort();
        let ends: Vec<(String, i64)> = running.windows(2).map(|w| (w[0].1.clone(), w[1].0)).collect();
        for (id, end) in ends {
            st.seq += 1;
            let seq = st.seq;
            let row = st.rows.get_mut("session").unwrap().get_mut(&id).unwrap();
            let bumped = (row["updated_ms"].as_i64().unwrap() + 1).max(now);
            row.insert("end_ms".into(), end.into());
            row.insert("updated_ms".into(), bumped.into());
            row.insert("server_seq".into(), seq.into());
        }
    }
}

impl Remote for FakeServer {
    fn upsert(&self, table: &Table, rows: &[Row]) -> Result<Vec<Row>, SyncError> {
        let mut returned = Vec::with_capacity(rows.len());
        {
            let mut st = self.state.borrow_mut();
            if st.offline {
                return Err(SyncError::new(SyncErrorCode::Network, "offline"));
            }
            st.upserts += 1;
            for incoming in rows {
                let key = key_of(table, incoming)?.to_owned();
                let existing = st.rows.get(table.name).and_then(|t| t.get(&key)).cloned();
                // BEFORE INSERT OR UPDATE: an update that is not newer keeps the old row.
                let result = match existing {
                    Some(old) if Version::of(incoming)? <= Version::of(&old)? => old,
                    _ => {
                        st.seq += 1;
                        let mut row: Row =
                            table.columns.iter().map(|c| ((*c).to_owned(), incoming.get(*c).cloned().unwrap_or(Json::Null))).collect();
                        row.insert("user_id".into(), "user".into());
                        row.insert("server_seq".into(), st.seq.into());
                        st.rows.entry(table.name).or_default().insert(key.clone(), row.clone());
                        if st.holding {
                            st.uncommitted.insert((table.name, key));
                        }
                        row
                    }
                };
                returned.push(result);
            }
            // RETURNING shows rows before the AFTER trigger runs; its changes are picked up by the next pull.
            if table.name == "session" {
                Self::single_running(&mut st);
            }
        }
        if let Some(mut f) = self.during_upsert.borrow_mut().take() {
            f();
        }
        Ok(returned)
    }

    fn fetch(&self, table: &Table, after: i64, limit: usize) -> Result<Vec<Row>, SyncError> {
        let mut st = self.state.borrow_mut();
        if st.offline {
            return Err(SyncError::new(SyncErrorCode::Network, "offline"));
        }
        st.fetches += 1;
        let mut rows: Vec<Row> = st
            .rows
            .get(table.name)
            .map(|t| {
                t.iter()
                    .filter(|(k, _)| !st.uncommitted.contains(&(table.name, (*k).clone())))
                    .map(|(_, r)| r.clone())
                    .filter(|r| r["server_seq"].as_i64().unwrap() > after)
                    .collect()
            })
            .unwrap_or_default();
        rows.sort_by_key(|r| r["server_seq"].as_i64().unwrap());
        rows.truncate(limit);
        Ok(rows)
    }
}

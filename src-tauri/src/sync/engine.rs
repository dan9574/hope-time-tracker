//! Push and pull (rebuild-plan 12.3), independent of HTTP so it can run against a fake server in tests.
//!
//! The database lock is never held across a network call: rows are read, the lock is released, the
//! request is made, and the answer is merged in a fresh transaction. Local writes that land in between
//! are safe because every local write bumps `updated_ms`, so the merge sees ours as newer and keeps it dirty.

use serde_json::Value as Json;

use super::error::SyncError;
use super::tables::{merge, read_dirty, Merge, Row, Table, TABLES};
use crate::db::{setting, Db};

/// PostgREST upsert batch size.
pub const PUSH_BATCH: usize = 500;
/// Supabase's default `max-rows`; a shorter page means we have everything.
pub const PULL_PAGE: usize = 1000;
/// Pull re-reads this many sequence numbers below the cursor, covering transactions that took their
/// `server_seq` earlier but committed later than rows we have already seen.
pub const PULL_OVERLAP: i64 = 50;

/// The server, as the engine sees it. Implemented over HTTP (`http::HttpRemote`) and in memory for tests.
pub trait Remote {
    /// Upserts `rows` (last write wins on the server) and returns the server's copy of each one afterwards.
    fn upsert(&self, table: &Table, rows: &[Row]) -> Result<Vec<Row>, SyncError>;
    /// Rows with `server_seq > after`, ascending, at most `limit`. Each row carries `server_seq`.
    fn fetch(&self, table: &Table, after: i64, limit: usize) -> Result<Vec<Row>, SyncError>;
}

pub fn cursor_key(table: &Table) -> String {
    format!("sync.cursor.{}", table.name)
}

/// Merges server rows in one transaction. A row that cannot be applied (malformed, or rejected by a
/// local constraint) is logged and skipped so it cannot wedge sync forever. Returns whether any row
/// changed local data, and the highest `server_seq` seen.
fn merge_all(db: &Db, table: &Table, rows: &[Row], cursor: Option<i64>) -> Result<(bool, i64), SyncError> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let mut changed = false;
    let mut max_seq = cursor.unwrap_or(0);
    for row in rows {
        if let Some(seq) = row.get("server_seq").and_then(Json::as_i64) {
            max_seq = max_seq.max(seq);
        }
        match merge(&tx, table, row) {
            Ok(Merge::Applied) => changed = true,
            Ok(Merge::Acknowledged | Merge::Kept) => {}
            Err(e) => eprintln!("sync: skipped a {} row: {e}", table.name),
        }
    }
    if let Some(old) = cursor {
        if max_seq > old {
            setting::set(&tx, &cursor_key(table), &max_seq.to_string())?;
        }
    }
    tx.commit()?;
    Ok((changed, max_seq))
}

/// Uploads every dirty row. Returns whether the server's answers changed local data
/// (a row it rejected because it already had a newer copy).
pub fn push(db: &Db, remote: &impl Remote) -> Result<bool, SyncError> {
    let mut changed = false;
    for table in &TABLES {
        let mut after = 0;
        loop {
            let batch = read_dirty(&db.conn(), table, after, PUSH_BATCH)?;
            let Some((last, _)) = batch.last() else { break };
            after = *last;
            let full = batch.len() == PUSH_BATCH;
            let rows: Vec<Row> = batch.into_iter().map(|(_, r)| r).collect();
            let returned = remote.upsert(table, &rows)?;
            changed |= merge_all(db, table, &returned, None)?.0;
            if !full {
                break;
            }
        }
    }
    Ok(changed)
}

/// Downloads everything newer than each table's cursor. Returns whether local data changed.
pub fn pull(db: &Db, remote: &impl Remote) -> Result<bool, SyncError> {
    let mut changed = false;
    for table in &TABLES {
        let mut cursor: i64 = setting::get(&db.conn(), &cursor_key(table))?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let mut after = (cursor - PULL_OVERLAP).max(0);
        loop {
            let rows = remote.fetch(table, after, PULL_PAGE)?;
            let (c, max_seq) = merge_all(db, table, &rows, Some(cursor))?;
            changed |= c;
            cursor = cursor.max(max_seq);
            if rows.len() < PULL_PAGE {
                break;
            }
            // Next page starts after the last row of this one (not at cursor − overlap again).
            after = rows.last().and_then(|r| r.get("server_seq")).and_then(Json::as_i64).unwrap_or(max_seq);
        }
    }
    Ok(changed)
}

/// A full round: push first so the pull already reflects what the server decided about our rows.
pub fn sync(db: &Db, remote: &impl Remote) -> Result<bool, SyncError> {
    let pushed = push(db, remote)?;
    let pulled = pull(db, remote)?;
    Ok(pushed || pulled)
}

import Foundation
import SwiftData

/// The server, as the engine sees it (rebuild-plan 12.6). Implemented over HTTP by `SupabaseRemote` and in
/// memory by the tests' fake server. Same contract as the Rust `Remote` trait.
@MainActor
public protocol SyncRemote: AnyObject {
    /// Upserts `rows` (last write wins on the server) and returns the server's copy of each one afterwards.
    func upsert(_ table: SyncTable, rows: [Row]) async throws -> [Row]
    /// Rows with `server_seq > after`, ascending, at most `limit`. Each row carries `server_seq`.
    func fetch(_ table: SyncTable, after: Int64, limit: Int) async throws -> [Row]
}

/// What merging one server row did locally.
public enum MergeResult: Equatable, Sendable {
    /// New row, or the server's copy is newer and replaced ours. Views must refresh.
    case applied
    /// The server has exactly our version: the row is no longer dirty.
    case acknowledged
    /// Ours is newer (or the same and already clean); kept, and left / marked dirty so it gets pushed.
    case kept
}

/// Push and pull (rebuild-plan 12.3), a port of `src-tauri/src/sync/engine.rs`.
///
/// Nothing is held across a network call: rows are read, the request is awaited, and the answer is merged
/// and saved afterwards. Local writes that land in between are safe because every local write moves
/// `updated_ms` forward, so the merge sees ours as newer and keeps it dirty.
@MainActor
public enum SyncEngine {
    /// PostgREST upsert batch size.
    public static let pushBatch = 500
    /// Supabase's default `max-rows`; a shorter page means we have everything.
    public static let pullPage = 1000
    /// Pull re-reads this many sequence numbers below the cursor, covering transactions that took their
    /// `server_seq` earlier but committed later than rows we have already seen.
    public static let pullOverlap: Int64 = 50

    // MARK: Merge

    /// Applies a row from the server with the server's own rule. Used for pulled rows and for the rows a
    /// push returns. Does not save.
    static func merge(_ table: SyncTable, _ row: Row, in context: ModelContext) throws -> MergeResult {
        switch table {
        case .activity: try merge(ActivityRecord.self, row, in: context)
        case .plan: try merge(PlanRecord.self, row, in: context)
        case .session: try merge(SessionRecord.self, row, in: context)
        case .journal: try merge(JournalRecord.self, row, in: context)
        case .day: try merge(DayRecord.self, row, in: context)
        }
    }

    private static func merge<R: SyncedRecord>(_ type: R.Type, _ row: Row, in context: ModelContext) throws -> MergeResult {
        let theirs = try RowVersion(of: row)
        // Decode fully before touching the stored row, so a malformed row changes nothing.
        let incoming = try R.decode(row)
        guard let local = try R.find(incoming.key, in: context) else {
            incoming.dirty = false
            context.insert(incoming)
            return .applied
        }
        let ours = RowVersion(updatedMs: local.updatedMs, deviceId: local.deviceId)
        if theirs > ours {
            local.assign(from: incoming)
            local.dirty = false
            return .applied
        } else if theirs == ours {
            if local.dirty {
                local.dirty = false
                return .acknowledged
            }
            return .kept
        } else {
            // Normally ours is still dirty. If not (e.g. it was synced to another account), make sure it
            // gets pushed rather than silently diverging from the server.
            if !local.dirty { local.dirty = true }
            return .kept
        }
    }

    /// Merges server rows and saves once. A row that cannot be applied is logged and skipped so it cannot
    /// wedge sync forever. Returns whether any row changed local data, and the highest `server_seq` seen.
    private static func mergeAll(
        _ store: LocalStore, _ table: SyncTable, _ rows: [Row], cursor: Int64?
    ) throws -> (changed: Bool, maxSeq: Int64) {
        try store.applyRemote(changed: { $0.changed }) {
            var changed = false
            var maxSeq = cursor ?? 0
            for row in rows {
                if let seq = row["server_seq"]?.int { maxSeq = max(maxSeq, seq) }
                do {
                    if try merge(table, row, in: store.context) == .applied { changed = true }
                } catch {
                    print("sync: skipped a \(table.rawValue) row: \(error)")
                }
            }
            if let old = cursor, maxSeq > old {
                try store.setSetting(table.cursorKey, String(maxSeq))
            }
            return (changed, maxSeq)
        }
    }

    private static func dirtyRows(_ table: SyncTable, in context: ModelContext) throws -> [Row] {
        switch table {
        case .activity: try ActivityRecord.dirtyRecords(in: context).map { $0.row() }
        case .plan: try PlanRecord.dirtyRecords(in: context).map { $0.row() }
        case .session: try SessionRecord.dirtyRecords(in: context).map { $0.row() }
        case .journal: try JournalRecord.dirtyRecords(in: context).map { $0.row() }
        case .day: try DayRecord.dirtyRecords(in: context).map { $0.row() }
        }
    }

    // MARK: Push / pull

    /// Uploads every dirty row, in batches. Returns whether the server's answers changed local data (a row
    /// it rejected because it already had a newer copy).
    @discardableResult
    public static func push(_ store: LocalStore, _ remote: any SyncRemote) async throws -> Bool {
        var changed = false
        for table in SyncTable.allCases {
            // A snapshot: a row edited again while a batch is in flight is still sent once per push, and
            // its newer version stays dirty for the next one.
            let rows = try dirtyRows(table, in: store.context)
            var start = 0
            while start < rows.count {
                let batch = Array(rows[start..<min(start + pushBatch, rows.count)])
                start += batch.count
                let returned = try await remote.upsert(table, rows: batch)
                changed = try mergeAll(store, table, returned, cursor: nil).changed || changed
            }
        }
        return changed
    }

    /// Downloads everything newer than each table's cursor. Returns whether local data changed.
    @discardableResult
    public static func pull(_ store: LocalStore, _ remote: any SyncRemote) async throws -> Bool {
        var changed = false
        for table in SyncTable.allCases {
            var cursor = store.setting(table.cursorKey).flatMap { Int64($0) } ?? 0
            var after = max(cursor - pullOverlap, 0)
            while true {
                let rows = try await remote.fetch(table, after: after, limit: pullPage)
                let result = try mergeAll(store, table, rows, cursor: cursor)
                changed = result.changed || changed
                cursor = max(cursor, result.maxSeq)
                if rows.count < pullPage { break }
                // Next page starts after the last row of this one (not at cursor − overlap again).
                after = rows.last?["server_seq"]?.int ?? result.maxSeq
            }
        }
        return changed
    }

    /// A full round: push first so the pull already reflects what the server decided about our rows.
    @discardableResult
    public static func sync(_ store: LocalStore, _ remote: any SyncRemote) async throws -> Bool {
        let pushed = try await push(store, remote)
        let pulled = try await pull(store, remote)
        return pushed || pulled
    }

    /// After switching accounts every row must be offered to the new account, and its cursors restart.
    static func resetForNewAccount(_ store: LocalStore) throws {
        for r in try store.all(ActivityRecord.self) where !r.dirty { r.dirty = true }
        for r in try store.all(PlanRecord.self) where !r.dirty { r.dirty = true }
        for r in try store.all(SessionRecord.self) where !r.dirty { r.dirty = true }
        for r in try store.all(JournalRecord.self) where !r.dirty { r.dirty = true }
        for r in try store.all(DayRecord.self) where !r.dirty { r.dirty = true }
        for t in SyncTable.allCases { try store.setSetting(t.cursorKey, nil) }
    }
}

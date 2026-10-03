@testable import HopeCore

/// In-memory stand-in for the Supabase tables of supabase/schema.sql (rebuild-plan 12.6), a port of
/// src-tauri/src/sync/fake.rs. Same rules as the SQL triggers: last write wins on `(updated_ms, device_id)`,
/// a global `server_seq`, and "only one running session".
@MainActor
final class FakeServer: SyncRemote {
    private var seq: Int64 = 0
    /// table → key → row (with `server_seq`).
    private var rows: [SyncTable: [String: Row]] = [:]
    /// Rows written by a transaction that has taken its sequence numbers but not committed yet.
    private var uncommitted: Set<String> = []
    private var holding = false
    var offline = false
    /// Server clock, used when the running-session rule ends a session.
    var nowMs: Int64
    private(set) var upserts = 0
    private(set) var fetches = 0
    /// Runs in the middle of an upsert, after the rows reached the "server".
    var duringUpsert: (@MainActor () -> Void)?

    init(nowMs: Int64) { self.nowMs = nowMs }

    /// Subsequent upserts take sequence numbers but stay invisible until `commitHeld`.
    func holdCommits() { holding = true }
    /// New upserts commit normally again; rows already held stay invisible.
    func stopHolding() { holding = false }
    /// The slow transaction finally commits.
    func commitHeld() {
        holding = false
        uncommitted.removeAll()
    }

    func row(_ table: SyncTable, _ key: String) -> Row? { rows[table]?[key] }
    func count(_ table: SyncTable) -> Int { rows[table]?.count ?? 0 }

    private func heldKey(_ table: SyncTable, _ key: String) -> String { "\(table.rawValue)/\(key)" }

    /// Ends every running session except the one that started last (AFTER trigger).
    private func singleRunning() {
        guard let sessions = rows[.session] else { return }
        let running = sessions.values
            .filter { $0["end_ms"] == .null && $0["deleted_ms"] == .null }
            .map { (start: $0["start_ms"]!.int!, id: $0["id"]!.string!) }
            .sorted { $0.start != $1.start ? $0.start < $1.start : $0.id.utf8.lexicographicallyPrecedes($1.id.utf8) }
        guard running.count > 1 else { return }
        for i in 0..<(running.count - 1) {
            seq += 1
            var row = rows[.session]![running[i].id]!
            let bumped = max(row["updated_ms"]!.int! + 1, nowMs)
            row["end_ms"] = .int(running[i + 1].start)
            row["updated_ms"] = .int(bumped)
            row["server_seq"] = .int(seq)
            rows[.session]![running[i].id] = row
        }
    }

    func upsert(_ table: SyncTable, rows incoming: [Row]) async throws -> [Row] {
        if offline { throw SyncError(.network, "offline") }
        upserts += 1
        var returned: [Row] = []
        for row in incoming {
            guard let key = row[table.key]?.string else { throw SyncError.decode("row without key") }
            // BEFORE INSERT OR UPDATE: an update that is not newer keeps the old row.
            if let old = rows[table]?[key], try RowVersion(of: row) <= RowVersion(of: old) {
                returned.append(old)
                continue
            }
            seq += 1
            var stored = Row()
            for c in table.columns { stored[c] = row[c] ?? .null }
            stored["user_id"] = "user"
            stored["server_seq"] = .int(seq)
            rows[table, default: [:]][key] = stored
            if holding { uncommitted.insert(heldKey(table, key)) }
            returned.append(stored)
        }
        // RETURNING shows rows before the AFTER trigger runs; its changes are picked up by the next pull.
        if table == .session { singleRunning() }
        if let hook = duringUpsert {
            duringUpsert = nil
            hook()
        }
        return returned
    }

    func fetch(_ table: SyncTable, after: Int64, limit: Int) async throws -> [Row] {
        if offline { throw SyncError(.network, "offline") }
        fetches += 1
        let visible = (rows[table] ?? [:])
            .filter { !uncommitted.contains(heldKey(table, $0.key)) }
            .map(\.value)
            .filter { $0["server_seq"]!.int! > after }
            .sorted { $0["server_seq"]!.int! < $1["server_seq"]!.int! }
        return Array(visible.prefix(limit))
    }
}

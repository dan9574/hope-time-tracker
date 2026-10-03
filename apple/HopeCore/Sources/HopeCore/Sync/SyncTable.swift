/// The five synced tables (rebuild-plan 12.1). Columns mirror `src-tauri/src/sync/tables.rs` exactly:
/// `dirty` is local-only, `user_id` and `server_seq` exist only on the server.
public enum SyncTable: String, CaseIterable, Sendable {
    // Order does not matter (no foreign keys); it matches the Rust TABLES array.
    case activity, plan, session, journal, day

    /// Local primary key. On the server the key is `(user_id, <key>)`.
    public var key: String { self == .day ? "date" : "id" }

    /// Every synced column, key first.
    public var columns: [String] {
        switch self {
        case .activity:
            ["id", "name", "color", "symbol", "sort", "archived_at", "parent_id", "updated_ms", "deleted_ms", "device_id"]
        case .plan:
            ["id", "activity_id", "date", "start_hm", "end_hm", "rule", "auto_log", "until", "updated_ms", "deleted_ms", "device_id"]
        case .session:
            ["id", "activity_id", "start_ms", "end_ms", "note", "continues_id", "plan_id", "updated_ms", "deleted_ms", "device_id"]
        case .journal:
            ["id", "date", "text", "updated_ms", "deleted_ms", "device_id"]
        case .day:
            ["date", "wake_ms", "sleep_ms", "utc_offset_min", "updated_ms", "deleted_ms", "device_id"]
        }
    }

    var cursorKey: String { "sync.cursor.\(rawValue)" }
}

/// The pair that decides which copy of a row wins: later `updated_ms`, then the larger `device_id`
/// compared bytewise (like `COLLATE "C"` on the server), so every device reaches the same answer.
public struct RowVersion: Comparable, Sendable {
    public var updatedMs: Int64
    public var deviceId: String

    public init(updatedMs: Int64, deviceId: String) {
        self.updatedMs = updatedMs
        self.deviceId = deviceId
    }

    public init(of row: Row) throws {
        guard let ms = row["updated_ms"]?.int else { throw SyncError.decode("row without updated_ms") }
        guard let device = row["device_id"]?.string else { throw SyncError.decode("row without device_id") }
        self.init(updatedMs: ms, deviceId: device)
    }

    public static func < (a: RowVersion, b: RowVersion) -> Bool {
        if a.updatedMs != b.updatedMs { return a.updatedMs < b.updatedMs }
        // Swift's String `<` is Unicode-aware; the server compares raw bytes.
        return a.deviceId.utf8.lexicographicallyPrecedes(b.deviceId.utf8)
    }

    public static func == (a: RowVersion, b: RowVersion) -> Bool {
        a.updatedMs == b.updatedMs && a.deviceId.utf8.elementsEqual(b.deviceId.utf8)
    }
}

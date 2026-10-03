import Foundation

// Edits the apps do not offer yet (rename, record editing, soft delete). Every one follows the same rule as
// the desktop: the version moves forward, the device id is ours, the row becomes dirty.

extension LocalStore {
    func touch<R: SyncedRecord>(_ record: R) {
        record.updatedMs = Self.bump(record.updatedMs, now: now)
        record.deviceId = deviceId
        record.dirty = true
    }

    func renameActivity(_ id: String, to name: String) throws {
        guard let a = activity(id) else { throw StoreError.notFound("activity") }
        try write {
            a.name = name
            touch(a)
        }
    }

    /// Edits a finished session (times and note).
    func editSession(_ id: String, startMs: Int64, endMs: Int64, note: String?) throws {
        guard let s = session(id) else { throw StoreError.notFound("session") }
        guard endMs >= startMs else { throw StoreError.invalid("session ends before it starts") }
        try write {
            s.startMs = startMs
            s.endMs = endMs
            s.note = note
            touch(s)
        }
    }

    /// Adds a finished session by hand.
    @discardableResult
    func addSession(activityId: String, startMs: Int64, endMs: Int64) throws -> SessionRecord {
        let s = SessionRecord(
            id: UUID().uuidString.lowercased(), activityId: activityId, startMs: startMs, endMs: endMs, updatedMs: now,
            deviceId: deviceId)
        try write { context.insert(s) }
        return s
    }

    /// Soft delete.
    func deleteSession(_ id: String) throws {
        guard let s = session(id) else { throw StoreError.notFound("session") }
        let now = self.now
        try write {
            s.deletedMs = now
            touch(s)
        }
    }
}

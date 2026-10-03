import Foundation
import Observation
import SwiftData

/// The device's local database (rebuild-plan 9.2: local first). One SwiftData context on the main actor;
/// every write goes through `write`, which saves (all or nothing), marks the change for observers and
/// asks sync to push.
@MainActor
@Observable
public final class LocalStore {
    public let container: ModelContainer
    let context: ModelContext
    /// This install's id, written into `device_id` of every local write.
    public let deviceId: String
    /// Bumped after every committed change (local or pulled), so views can recompute.
    public private(set) var revision = 0
    /// Wall clock in epoch milliseconds. Replaceable in tests.
    @ObservationIgnored public var clock: @MainActor () -> Int64 = { Int64((Date().timeIntervalSince1970 * 1000).rounded(.down)) }
    /// Called after every committed local write (not after pulls). Sync uses it to push soon.
    @ObservationIgnored public var onLocalWrite: (@MainActor () -> Void)?

    static let schema = Schema([
        ActivityRecord.self, SessionRecord.self, PlanRecord.self, JournalRecord.self, DayRecord.self, SettingRecord.self,
    ])

    /// - Parameters:
    ///   - inMemory: for tests and previews.
    ///   - deviceId: fixed id for tests; otherwise read from (or created in) the local settings.
    public init(inMemory: Bool = false, deviceId: String? = nil) throws {
        let config = ModelConfiguration("Hope", schema: Self.schema, isStoredInMemoryOnly: inMemory)
        container = try ModelContainer(for: Self.schema, configurations: config)
        context = ModelContext(container)
        context.autosaveEnabled = false
        if let deviceId {
            self.deviceId = deviceId
        } else if let saved = try Self.setting(Setting.deviceId, in: context) {
            self.deviceId = saved
        } else {
            let id = UUID().uuidString.lowercased()
            context.insert(SettingRecord(key: Setting.deviceId, value: id))
            try context.save()
            self.deviceId = id
        }
    }

    public var now: Int64 { clock() }

    /// Runs `body` as one transaction of local writes: saved together, or rolled back on error.
    @discardableResult
    func write<T>(_ body: () throws -> T) throws -> T {
        do {
            let result = try body()
            if context.hasChanges { try context.save() }
            revision += 1
            onLocalWrite?()
            return result
        } catch {
            context.rollback()
            throw error
        }
    }

    /// Like `write`, for rows coming from the server: no push is triggered.
    func applyRemote<T>(changed: (T) -> Bool, _ body: () throws -> T) throws -> T {
        do {
            let result = try body()
            if context.hasChanges { try context.save() }
            if changed(result) { revision += 1 }
            return result
        } catch {
            context.rollback()
            throw error
        }
    }

    /// A version for a local write that always moves forward, even if the clock went backwards.
    static func bump(_ previous: Int64, now: Int64) -> Int64 { max(now, previous + 1) }

    // MARK: - Settings (device-local)

    enum Setting {
        static let deviceId = "device_id"
        /// Session most recently ended by "pause"; cleared by start / resume / stop.
        static let pausedSessionId = "paused_session_id"
        static let userId = "sync.user_id"
        static let email = "sync.email"
        static let lastOk = "sync.last_ok_ms"
        static let lastError = "sync.last_error"
        /// The id of the last sign-in handed over from the iPhone (watch only).
        static let handoffId = "sync.handoff_id"
    }

    static func setting(_ key: String, in context: ModelContext) throws -> String? {
        var d = FetchDescriptor<SettingRecord>(predicate: #Predicate { $0.key == key })
        d.fetchLimit = 1
        return try context.fetch(d).first?.value
    }

    func setting(_ key: String) -> String? {
        (try? Self.setting(key, in: context)) ?? nil
    }

    /// Stages a setting change; it is saved with the surrounding `write` / `applyRemote`, or by `saveSettings`.
    func setSetting(_ key: String, _ value: String?) throws {
        var d = FetchDescriptor<SettingRecord>(predicate: #Predicate { $0.key == key })
        d.fetchLimit = 1
        let existing = try context.fetch(d).first
        switch (existing, value) {
        case (let e?, let v?): e.value = v
        case (let e?, nil): context.delete(e)
        case (nil, let v?): context.insert(SettingRecord(key: key, value: v))
        case (nil, nil): break
        }
    }

    /// Saves staged setting changes on their own (they never trigger a push).
    func saveSettings(_ changes: [String: String?]) throws {
        do {
            for (k, v) in changes { try setSetting(k, v) }
            if context.hasChanges { try context.save() }
        } catch {
            context.rollback()
            throw error
        }
    }

    // MARK: - Generic access used by sync and tests

    func all<T: PersistentModel>(_ type: T.Type) throws -> [T] {
        try context.fetch(FetchDescriptor<T>())
    }

    /// Number of rows waiting to be pushed.
    public func dirtyCount() throws -> Int {
        try ActivityRecord.dirtyRecords(in: context).count + SessionRecord.dirtyRecords(in: context).count
            + PlanRecord.dirtyRecords(in: context).count + JournalRecord.dirtyRecords(in: context).count
            + DayRecord.dirtyRecords(in: context).count
    }
}

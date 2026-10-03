import Foundation
import SwiftData
import Testing

@testable import HopeCore

// Engine tests against the in-memory server (rebuild-plan 12.6), mirroring src-tauri/src/sync/tests.rs.

let serverNow: Int64 = 1_000_000

@MainActor
func device(_ name: String) throws -> LocalStore {
    try LocalStore(inMemory: true, deviceId: name)
}

extension LocalStore {
    /// Runs `body` with the clock fixed at `ms`.
    @discardableResult
    func at<T>(_ ms: Int64, _ body: () throws -> T) rethrows -> T {
        clock = { ms }
        return try body()
    }

    func addActivity(_ ms: Int64, _ name: String, color: ActivityColor = .blue) throws -> String {
        try at(ms) { try createActivity(name: name, color: color).id }
    }

    /// Every synced row with every synced column, for comparing devices.
    func dump() throws -> [Row] {
        func tagged(_ table: SyncTable, _ rows: [Row]) -> [Row] {
            rows.map { var r = $0; r["_table"] = .string(table.rawValue); return r }
                .sorted { $0[table.key]!.string! < $1[table.key]!.string! }
        }
        return tagged(.activity, try all(ActivityRecord.self).map { $0.row() })
            + tagged(.plan, try all(PlanRecord.self).map { $0.row() })
            + tagged(.session, try all(SessionRecord.self).map { $0.row() })
            + tagged(.journal, try all(JournalRecord.self).map { $0.row() })
            + tagged(.day, try all(DayRecord.self).map { $0.row() })
    }

    func name(of id: String) -> String? { activity(id)?.name }

    /// Inserts a row directly (as the Rust tests do with raw SQL); still a local write.
    func insertRaw(_ model: some PersistentModel) throws {
        try write { context.insert(model) }
    }
}

@MainActor
func sync(_ db: LocalStore, _ server: FakeServer) async throws -> Bool {
    try await SyncEngine.sync(db, server)
}

@MainActor
func expectConverged(_ a: LocalStore, _ b: LocalStore, sourceLocation: SourceLocation = #_sourceLocation) throws {
    #expect(try a.dump() == b.dump(), "devices hold the same rows", sourceLocation: sourceLocation)
    #expect(try a.dirtyCount() == 0 && b.dirtyCount() == 0, "nothing left to push", sourceLocation: sourceLocation)
}

@MainActor
@Suite("Sync engine")
struct SyncEngineTests {
    @Test func twoDevicesConverge() async throws {
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        let b = try device("device-b")

        let study = try a.addActivity(100, "Study")
        try a.at(200) { try a.start(activityId: study) }
        try a.at(300) { try a.stop() }
        try a.at(310) {
            try a.insertRaw(
                PlanRecord(
                    id: "plan-1", activityId: study, date: "2026-10-01", startHm: "09:00", endHm: "10:00",
                    rule: "weekly:1", updatedMs: 310, deviceId: a.deviceId))
        }
        try a.insertRaw(JournalRecord(id: "j-a", date: "2026-10-03", text: "from a", updatedMs: 320, deviceId: a.deviceId))
        try a.insertRaw(DayRecord(date: "2026-10-03", wakeMs: 7, utcOffsetMin: 480, updatedMs: 330, deviceId: a.deviceId))
        let read = try b.addActivity(150, "Read")
        try b.insertRaw(JournalRecord(id: "j-b", date: "2026-10-02", text: "from b", updatedMs: 340, deviceId: b.deviceId))

        _ = try await sync(a, server)
        #expect(try await sync(b, server), "b received a's rows")
        #expect(try await sync(a, server), "a received b's rows")

        try expectConverged(a, b)
        #expect(a.activities().count == 2)
        #expect(a.name(of: read) == "Read")
        #expect(server.count(.session) == 1)
        #expect(server.count(.day) == 1)
        #expect(server.count(.plan) == 1)
        #expect(server.count(.journal) == 2)
    }

    @Test func offlineEditsMergeLastWriteWins() async throws {
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        let b = try device("device-b")
        let x = try a.addActivity(100, "Work")
        let s = try a.at(100) { try a.addSession(activityId: x, startMs: 1_000, endMs: 2_000).id }
        _ = try await sync(a, server)
        _ = try await sync(b, server)

        server.offline = true
        try a.at(1_000) { try a.renameActivity(x, to: "Deep work") }
        try b.at(900) { try b.renameActivity(x, to: "Focus") }  // older than a's rename
        try b.at(950) { try b.editSession(s, startMs: 1_000, endMs: 2_000, note: "edited") }
        await #expect(throws: SyncError(.network, "offline")) { try await SyncEngine.sync(a, server) }
        #expect(try a.dirtyCount() == 1, "still waiting to push")

        server.offline = false
        _ = try await sync(b, server)
        _ = try await sync(a, server)
        _ = try await sync(b, server)

        try expectConverged(a, b)
        #expect(b.name(of: x) == "Deep work", "newer rename wins on both")
        #expect(a.session(s)?.note == "edited", "independent edit survives")
    }

    @Test func equalTimestampsBreakTiesByDeviceId() async throws {
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        let b = try device("device-b")
        let x = try a.addActivity(100, "Work")
        _ = try await sync(a, server)
        _ = try await sync(b, server)

        try a.at(500) { try a.renameActivity(x, to: "From A") }
        try b.at(500) { try b.renameActivity(x, to: "From B") }
        _ = try await sync(a, server)
        _ = try await sync(b, server)
        _ = try await sync(a, server)

        try expectConverged(a, b)
        #expect(a.name(of: x) == "From B", "device-b > device-a")
    }

    @Test func deviceIdsCompareBytewise() async throws {
        // "Z" (0x5A) < "a" (0x61) bytewise; "é" sorts after "f" bytewise but before it in Unicode-aware order.
        #expect(RowVersion(updatedMs: 1, deviceId: "Z") < RowVersion(updatedMs: 1, deviceId: "a"))
        #expect(RowVersion(updatedMs: 1, deviceId: "f") < RowVersion(updatedMs: 1, deviceId: "é"))
        #expect(RowVersion(updatedMs: 1, deviceId: "zzz") < RowVersion(updatedMs: 2, deviceId: "a"))
        // Precomposed and decomposed é are different bytes, so different devices.
        #expect(RowVersion(updatedMs: 1, deviceId: "\u{E9}") != RowVersion(updatedMs: 1, deviceId: "e\u{301}"))
    }

    @Test func deleteVersusEditNewerWins() async throws {
        // Delete is newer: the edit loses, the record is gone everywhere.
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        let b = try device("device-b")
        let x = try a.addActivity(100, "Work")
        let s = try a.at(100) { try a.addSession(activityId: x, startMs: 1_000, endMs: 2_000).id }
        _ = try await sync(a, server)
        _ = try await sync(b, server)

        try a.at(2_000) { try a.deleteSession(s) }
        try b.at(1_500) { try b.editSession(s, startMs: 1_000, endMs: 1_800, note: nil) }
        _ = try await sync(b, server)
        _ = try await sync(a, server)
        _ = try await sync(b, server)
        try expectConverged(a, b)
        #expect(b.session(s) == nil, "deleted on b too")

        // Edit is newer: rows are whole-row last-write-wins, so the edit brings the record back.
        let t = try a.at(3_000) { try a.addSession(activityId: x, startMs: 5_000, endMs: 6_000).id }
        _ = try await sync(a, server)
        _ = try await sync(b, server)
        try a.at(3_500) { try a.deleteSession(t) }
        try b.at(4_000) { try b.editSession(t, startMs: 5_000, endMs: 5_500, note: nil) }
        _ = try await sync(a, server)
        _ = try await sync(b, server)
        _ = try await sync(a, server)
        try expectConverged(a, b)
        #expect(a.session(t)?.endMs == 5_500)
    }

    @Test func onlyOneSessionRunsAcrossDevices() async throws {
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        let b = try device("device-b")
        let x = try a.addActivity(100, "Work")
        _ = try await sync(a, server)
        _ = try await sync(b, server)

        // Both start a timer without knowing about the other. b's starts later.
        let first = try a.at(1_000) { try a.start(activityId: x) }.id
        let second = try b.at(2_000) { try b.start(activityId: x) }.id
        _ = try await sync(b, server)  // the later one reaches the server first
        _ = try await sync(a, server)
        _ = try await sync(b, server)

        try expectConverged(a, b)
        for db in [a, b] {
            #expect(db.timerState().running?.id == second, "the later start keeps running")
            #expect(db.session(first)?.endMs == 2_000, "the earlier one ends where the later one starts")
            #expect(try db.all(SessionRecord.self).filter { $0.endMs == nil && $0.deletedMs == nil }.count == 1)
        }
    }

    @Test func repeatedPullIsIdempotent() async throws {
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        let b = try device("device-b")
        let x = try a.addActivity(100, "Work")
        try a.at(100) { _ = try a.addSession(activityId: x, startMs: 1_000, endMs: 2_000) }
        _ = try await sync(a, server)
        #expect(try await sync(b, server))
        let before = try b.dump()

        #expect(try await SyncEngine.pull(b, server) == false, "nothing new")
        // Even from scratch: every row is already there with the same version.
        try b.saveSettings(Dictionary(uniqueKeysWithValues: SyncTable.allCases.map { ($0.cursorKey, String?.none) }))
        #expect(try await SyncEngine.pull(b, server) == false, "re-reading everything changes nothing")
        #expect(try b.dump() == before)
        #expect(try b.dirtyCount() == 0)
    }

    @Test func pullPagesPastTheRowLimit() async throws {
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        let b = try device("device-b")
        try a.write {
            for i in 0..<2_500 {
                a.context.insert(
                    SessionRecord(
                        id: String(format: "s%05d", i), activityId: "x", startMs: Int64(i) * 10, endMs: Int64(i) * 10 + 5,
                        updatedMs: 1, deviceId: "device-a"))
            }
        }
        try await SyncEngine.push(a, server)
        #expect(server.upserts == 5, "500 rows per request")
        #expect(try a.dirtyCount() == 0)

        let fetches = server.fetches
        #expect(try await SyncEngine.pull(b, server))
        #expect(server.fetches - fetches == 3 + 4, "three session pages, one page for each other table")
        #expect(try b.all(SessionRecord.self).count == 2_500)
        #expect(b.setting(SyncTable.session.cursorKey) == "2500")
    }

    @Test func overlapCatchesRowsCommittedOutOfOrder() async throws {
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        let b = try device("device-b")
        let c = try device("device-c")

        // a's transaction takes sequence 1 but commits late; b's takes 2 and commits at once.
        server.holdCommits()
        let slow = try a.addActivity(100, "Slow")
        try await SyncEngine.push(a, server)
        server.stopHolding()
        let fast = try b.addActivity(100, "Fast")
        try await SyncEngine.push(b, server)

        try await SyncEngine.pull(c, server)
        #expect(c.activity(fast) != nil)
        #expect(c.activity(slow) == nil, "not visible yet")
        #expect(c.setting("sync.cursor.activity") == "2", "the cursor is already past a's row")

        server.commitHeld()
        #expect(try await SyncEngine.pull(c, server))
        #expect(c.name(of: slow) == "Slow", "re-reading the last 50 sequence numbers found it")
    }

    @Test func pushRejectedByNewerServerCopyTakesIt() async throws {
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        let b = try device("device-b")
        let x = try a.addActivity(100, "Work")
        _ = try await sync(a, server)
        _ = try await sync(b, server)

        try b.at(3_000) { try b.renameActivity(x, to: "Newer") }
        _ = try await sync(b, server)
        try a.at(2_500) { try a.renameActivity(x, to: "Older") }
        #expect(try await SyncEngine.push(a, server), "the server's answer changed a")
        #expect(a.name(of: x) == "Newer")
        #expect(try a.dirtyCount() == 0)
    }

    @Test func editDuringPushStaysDirty() async throws {
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        let x = try a.addActivity(100, "Work")
        try a.at(200) { try a.renameActivity(x, to: "Pushed") }

        // Same millisecond as the version being pushed: the write still has to win.
        server.duringUpsert = { try? a.at(200) { try a.renameActivity(x, to: "Edited meanwhile") } }
        try await SyncEngine.push(a, server)
        #expect(a.name(of: x) == "Edited meanwhile")
        #expect(try a.dirtyCount() == 1, "the newer local edit is still waiting")

        try await SyncEngine.push(a, server)
        #expect(try a.dirtyCount() == 0)
        #expect(server.row(.activity, x)?["name"] == "Edited meanwhile")
    }

    @Test func switchingAccountReoffersEverything() async throws {
        let server = FakeServer(nowMs: serverNow)
        let a = try device("device-a")
        _ = try a.addActivity(100, "Work")
        _ = try await sync(a, server)
        #expect(try a.dirtyCount() == 0)

        try a.write { try SyncEngine.resetForNewAccount(a) }
        #expect(try a.dirtyCount() == 1)
        #expect(a.setting("sync.cursor.activity") == nil)

        let other = FakeServer(nowMs: serverNow)
        _ = try await sync(a, other)
        #expect(other.count(.activity) == 1)
    }

    @Test func malformedRowsAreSkippedNotFatal() async throws {
        let a = try device("device-a")
        let good: Row = [
            "id": "ok", "name": "Fine", "color": "teal", "sort": 0, "updated_ms": 5, "device_id": "x", "server_seq": 3,
        ]
        let badColor: Row = ["id": "bad", "name": "Neon", "color": "neon", "updated_ms": 5, "device_id": "x", "server_seq": 4]
        let noName: Row = ["id": "bad2", "color": "blue", "updated_ms": 5, "device_id": "x", "server_seq": 5]
        let remote = StaticRemote(activity: [good, badColor, noName])
        #expect(try await SyncEngine.pull(a, remote))
        #expect(a.activity("ok") != nil)
        #expect(a.activity("bad") == nil && a.activity("bad2") == nil)
        #expect(a.setting("sync.cursor.activity") == "5", "the cursor still moves past skipped rows")
    }

    @Test func localWritesAlwaysMoveTheVersionForward() throws {
        // A clock that went backwards must not produce a version the server would ignore.
        let db = try device("d")
        let x = try db.addActivity(1_000, "Work")
        try db.at(500) { try db.renameActivity(x, to: "Later edit, earlier clock") }
        #expect(db.activity(x)?.updatedMs == 1_001)
    }
}

/// Serves fixed rows once, for decode tests.
@MainActor
final class StaticRemote: SyncRemote {
    var pending: [SyncTable: [Row]]
    init(activity: [Row]) { pending = [.activity: activity] }
    func upsert(_ table: SyncTable, rows: [Row]) async throws -> [Row] { rows }
    func fetch(_ table: SyncTable, after: Int64, limit: Int) async throws -> [Row] {
        defer { pending[table] = nil }
        return (pending[table] ?? []).filter { ($0["server_seq"]?.int ?? 0) > after }
    }
}

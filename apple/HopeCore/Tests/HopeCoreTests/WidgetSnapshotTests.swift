import Foundation
import Testing

@testable import HopeCore

@MainActor
@Suite("Complication snapshot")
struct WidgetSnapshotTests {
    let h: Int64 = 3_600_000

    var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return cal
    }

    var day: (from: Int64, to: Int64) {
        LocalStore.dayRange(of: Date(timeIntervalSince1970: 1_790_000_000), calendar: calendar)
    }

    @Test func idleShowsTodaysTotal() throws {
        let db = try device("d")
        let a = try db.addActivity(0, "Read")
        try db.at(day.from + 9 * h) { _ = try db.start(activityId: a) }
        try db.at(day.from + 11 * h + h / 4) { _ = try db.stop() }

        let now = day.from + 12 * h
        let s = db.widgetSnapshot(now: now, calendar: calendar)
        #expect(s.state == .idle)
        #expect(s.title == nil && s.color == nil && s.effectiveStartMs == nil && s.elapsedMs == nil)
        #expect(s.todayTotalMs == 2 * h + h / 4)
        #expect(s.dayStartMs == day.from && s.dayEndMs == day.to && s.writtenAtMs == now)
        #expect(s.todayTotalMs(at: now + h) == 2 * h + h / 4)
        #expect(s.todayTotalMs(at: day.to) == 0, "a new day starts at zero")
        #expect(s.todayTotalMs(at: day.from - 1) == 0)
    }

    @Test func runningCountsTheWholeChainWithoutPauses() throws {
        let db = try device("d")
        let study = try db.addActivity(0, "Study", color: .purple)
        let linalg = try db.at(0) { try db.createActivity(name: "Linear algebra", color: .blue, parentId: study) }
        try db.at(day.from + 9 * h) { _ = try db.start(activityId: linalg.id) }
        try db.at(day.from + 10 * h) { _ = try db.pause() }
        try db.at(day.from + 10 * h + h / 2) { _ = try db.resume() }

        let now = day.from + 11 * h
        let s = db.widgetSnapshot(now: now, calendar: calendar)
        #expect(s.state == .running)
        #expect(s.parentName == "Study" && s.childName == "Linear algebra")
        #expect(s.title == "Study · Linear algebra" && s.shortTitle == "Linear algebra")
        #expect(s.color == .purple, "children show their parent's colour")
        // 1 h + 30 min so far; a timer counting from here shows exactly that.
        #expect(now - s.effectiveStartMs! == h + h / 2)
        #expect(s.effectiveStartMs! == day.from + 9 * h + h / 2)
        #expect(s.elapsedMs == nil)
    }

    @Test func pausedFreezesTheTime() throws {
        let db = try device("d")
        let a = try db.addActivity(0, "Write", color: .orange)
        try db.at(day.from + 9 * h) { _ = try db.start(activityId: a) }
        try db.at(day.from + 9 * h + 20 * 60_000) { _ = try db.pause() }

        let s = db.widgetSnapshot(now: day.from + 15 * h, calendar: calendar)
        #expect(s.state == .paused)
        #expect(s.title == "Write" && s.shortTitle == "Write" && s.childName == nil)
        #expect(s.color == .orange)
        #expect(s.elapsedMs == Int64(20 * 60_000))
        #expect(s.effectiveStartMs == nil)
    }

    @Test func unknownActivityStillShowsTheTimer() throws {
        let db = try device("d")
        let a = try db.addActivity(0, "Gone")
        try db.at(day.from + h) { _ = try db.start(activityId: a) }
        try db.write { db.activity(a)!.deletedMs = 5 }

        let s = db.widgetSnapshot(now: day.from + 2 * h, calendar: calendar)
        #expect(s.state == .running && s.title == nil && s.color == .gray)
        #expect(s.effectiveStartMs == day.from + h)
    }

    @Test func looksSameIgnoresWhatTheFaceDoesNotShow() {
        let base = WidgetSnapshot(
            state: .running, parentName: "A", color: .blue, effectiveStartMs: 10, todayTotalMs: 100, dayStartMs: 0,
            dayEndMs: 1_000, writtenAtMs: 50)
        var later = base
        later.writtenAtMs = 60
        later.todayTotalMs = 110
        #expect(base.looksSame(as: later), "running: the total does not show")

        var other = base
        other.effectiveStartMs = 11
        #expect(!base.looksSame(as: other))

        let idle = WidgetSnapshot(state: .idle, todayTotalMs: 100, dayStartMs: 0, dayEndMs: 1_000, writtenAtMs: 50)
        var idleLater = idle
        idleLater.writtenAtMs = 70
        #expect(idle.looksSame(as: idleLater))
        idleLater.todayTotalMs = 160
        #expect(!idle.looksSame(as: idleLater), "idle: the total shows")
    }

    @Test func fileRoundTripAndBadFiles() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("hope-widget-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = WidgetSnapshotFile(directory: dir)
        #expect(file.url.lastPathComponent == "widget-snapshot.json")
        #expect(file.read() == nil, "no file yet")

        let s = WidgetSnapshot(
            state: .paused, parentName: "Study", childName: "Calculus", color: .purple, elapsedMs: 42_000,
            todayTotalMs: 7, dayStartMs: 1, dayEndMs: 2, writtenAtMs: 3)
        try file.write(s)
        #expect(file.read() == s)

        try Data("not json".utf8).write(to: file.url)
        #expect(file.read() == nil, "corrupt reads as nothing")

        var future = s
        future.version = WidgetSnapshot.currentVersion + 1
        try JSONEncoder().encode(future).write(to: file.url)
        #expect(file.read() == nil, "a newer format is not guessed at")
    }

    @Test func noGroupMeansNoFile() {
        #expect(WidgetSnapshotFile(appGroup: nil) == nil)
        #expect(WidgetSnapshotFile(appGroup: "") == nil)
    }

    @Test func emptyIsIdleToday() {
        let now = day.from + 5 * h
        let s = WidgetSnapshot.empty(now: now, calendar: calendar)
        #expect(s.state == .idle && s.todayTotalMs(at: now) == 0)
        #expect(s.dayStartMs == day.from && s.dayEndMs == day.to)
    }
}

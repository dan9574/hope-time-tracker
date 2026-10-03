import Foundation
import Testing

@testable import HopeCore

@MainActor
@Suite("Timer rules and today")
struct TimerTests {
    @Test func startingEndsThePreviousSession() throws {
        let db = try device("d")
        let a = try db.addActivity(0, "A")
        let b = try db.addActivity(0, "B")
        let first = try db.at(100) { try db.start(activityId: a) }
        let second = try db.at(200) { try db.start(activityId: b) }
        #expect(first.endMs == 200)
        #expect(db.timerState().running?.id == second.id)
        #expect(db.timerState().paused == nil)
    }

    @Test func pauseThenResumeLinksTheChain() throws {
        let db = try device("d")
        let a = try db.addActivity(0, "A")
        let first = try db.at(100) { try db.start(activityId: a) }
        let paused = try db.at(150) { try db.pause() }
        #expect(paused?.id == first.id && paused?.endMs == 150)
        #expect(db.timerState().running == nil)
        #expect(db.timerState().paused?.id == first.id)

        let resumed = try db.at(300) { try db.resume() }
        #expect(resumed.continuesId == first.id)
        #expect(resumed.activityId == a)
        #expect(db.timerState().paused == nil)
        #expect(db.chainDuration(endingWith: resumed, now: 400) == 50 + 100, "pauses don't count")
    }

    @Test func stopClearsPauseAndStartingAnythingEndsIt() throws {
        let db = try device("d")
        let a = try db.addActivity(0, "A")
        try db.at(100) { _ = try db.start(activityId: a) }
        try db.at(150) { _ = try db.pause() }
        try db.at(160) { _ = try db.stop() }
        #expect(db.timerState().running == nil && db.timerState().paused == nil)
        #expect(throws: StoreError.notFound("paused session")) { try db.resume() }

        try db.at(200) { _ = try db.start(activityId: a) }
        try db.at(250) { _ = try db.pause() }
        try db.at(300) { _ = try db.start(activityId: a) }
        #expect(db.timerState().paused == nil, "a new start forgets the pause")
    }

    @Test func startNeedsALiveActivity() throws {
        let db = try device("d")
        #expect(throws: StoreError.notFound("activity")) { try db.start(activityId: "nope") }
    }

    @Test func timerWritesAreDirtyAndVersioned() throws {
        let db = try device("d")
        let a = try db.addActivity(0, "A")
        let s = try db.at(1_000) { try db.start(activityId: a) }
        #expect(s.dirty && s.updatedMs == 1_000 && s.deviceId == "d")
        s.dirty = false
        // The clock went backwards: the stop must still move the version forward.
        try db.at(900) { _ = try db.stop() }
        #expect(s.dirty)
        #expect(s.updatedMs == 1_001)
        #expect(s.endMs == 1_000, "never ends before it started")
    }

    @Test func activityTreeOrderAndArchive() throws {
        let db = try device("d")
        let study = try db.addActivity(1, "Study", color: .purple)
        let read = try db.addActivity(1, "Read", color: .green)
        let linalg = try db.at(1) { try db.createActivity(name: "Linear algebra", color: .pink, parentId: study) }
        _ = try db.at(1) { try db.createActivity(name: "Calculus", color: .pink, parentId: study) }
        #expect(linalg.color == "purple", "children take the parent's colour")
        #expect(throws: StoreError.invalid("sub-activities cannot have sub-activities")) {
            try db.createActivity(name: "Too deep", color: .blue, parentId: linalg.id)
        }

        let tree = db.activityTree()
        #expect(tree.map(\.activity.name) == ["Study", "Read"])
        #expect(tree[0].children.map(\.name) == ["Linear algebra", "Calculus"])
        #expect(db.displayName(activityId: linalg.id) == "Study · Linear algebra")
        #expect(db.color(activityId: linalg.id) == .purple)
        #expect(db.color(activityId: "unknown") == .gray)

        try db.write { db.activity(study)!.archivedAt = 5 }
        #expect(db.activityTree().map(\.activity.id) == [read], "archived parent hides its children too")
    }

    @Test func todaySummaryGroupsChainsAndClipsToTheDay() throws {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let db = try device("d")
        let study = try db.addActivity(0, "Study")
        let day = LocalStore.dayRange(of: Date(timeIntervalSince1970: 1_790_000_000), calendar: cal)
        let h: Int64 = 3_600_000
        // Crosses midnight into the day: only the part inside counts.
        try db.at(1) { _ = try db.addSession(activityId: study, startMs: day.from - h, endMs: day.from + h) }
        // A chain: 9–10, paused, 10:30–11.
        let first = try db.at(day.from + 9 * h) { try db.start(activityId: study) }
        try db.at(day.from + 10 * h) { _ = try db.pause() }
        try db.at(day.from + 10 * h + h / 2) { _ = try db.resume() }
        try db.at(day.from + 11 * h) { _ = try db.stop() }
        // Orphan: its activity has not arrived yet; still counted.
        try db.at(1) { _ = try db.addSession(activityId: "missing", startMs: day.from + 12 * h, endMs: day.from + 13 * h) }
        // Running now.
        try db.at(day.from + 14 * h) { _ = try db.start(activityId: study) }

        let now = day.from + 14 * h + h / 4
        let s = db.summary(from: day.from, to: day.to, now: now)
        #expect(s.entries.count == 4)
        #expect(s.entries[1].id == first.id)
        #expect(s.entries[1].durationMs == h + h / 2, "one row for the chain, pause excluded")
        #expect(s.entries[2].title == nil && s.entries[2].color == .gray)
        #expect(s.entries[3].endMs == nil)
        #expect(s.totalMs == h + (h + h / 2) + h + h / 4)
        #expect(db.todaySummary(now: now, calendar: cal).totalMs == s.totalMs)
    }

    @Test func durationFormat() {
        let unit = { (u: DurationFormat.Unit) in u == .hour ? "h" : "min" }
        let nb = DurationFormat.unitSpace
        #expect(DurationFormat.duration(59_000, unitName: unit) == "0\(nb)min")
        #expect(DurationFormat.duration(45 * 60_000, unitName: unit) == "45\(nb)min")
        #expect(DurationFormat.duration(135 * 60_000 + 59_000, unitName: unit) == "2\(nb)h 15\(nb)min")
        #expect(DurationFormat.duration(180 * 60_000, unitName: unit) == "3\(nb)h")
        #expect(DurationFormat.duration(-5, unitName: unit) == "0\(nb)min")
    }

    @Test func elapsedFormat() {
        #expect(DurationFormat.elapsed(0) == "00:00")
        #expect(DurationFormat.elapsed(59_999) == "00:59")
        #expect(DurationFormat.elapsed(61 * 60_000 + 5_000) == "1:01:05")
        #expect(DurationFormat.elapsed(-5) == "00:00")
    }

    @Test func paletteMatchesTokens() {
        #expect(ActivityColor.allCases.count == 8)
        #expect(ActivityColor.blue.rgb == (0x6A, 0xA9, 0xFF))
        #expect(ActivityColor.gray.rgb == (0xA5, 0xA5, 0xAC))
    }
}

import Foundation
import HopeCore
import Testing

struct AwayReminderTests {
    private let minute: Int64 = 60_000

    private func anchored(at ms: Int64 = 0) -> AwayReminder.State {
        var s = AwayReminder.State()
        s.start(.init(sessionId: "s1", latitude: 32.88, longitude: -117.24, setMs: ms))
        return s
    }

    @Test func promptsOnlyOutsideTheRadiusForTheSameSession() {
        let s = anchored()
        let now = 10 * minute
        #expect(AwayReminder.evaluate(AwayReminder.State(), sessionId: "s1", distanceMeters: 1000, nowMs: now) == .skip(.noAnchor))
        #expect(AwayReminder.evaluate(s, sessionId: "s2", distanceMeters: 1000, nowMs: now) == .skip(.differentSession))
        #expect(AwayReminder.evaluate(s, sessionId: "s1", distanceMeters: 300, nowMs: now) == .skip(.inside))
        #expect(AwayReminder.evaluate(s, sessionId: "s1", distanceMeters: 301, nowMs: now) == .prompt)
    }

    @Test func promptsAreThrottledAndSnoozed() {
        var s = anchored()
        s.prompted(atMs: 10 * minute)
        #expect(AwayReminder.evaluate(s, sessionId: "s1", distanceMeters: 500, nowMs: 14 * minute) == .skip(.tooSoon))
        #expect(AwayReminder.evaluate(s, sessionId: "s1", distanceMeters: 500, nowMs: 15 * minute) == .prompt)
        s.snooze(fromMs: 15 * minute)
        #expect(AwayReminder.evaluate(s, sessionId: "s1", distanceMeters: 500, nowMs: 44 * minute) == .skip(.snoozed))
        #expect(AwayReminder.evaluate(s, sessionId: "s1", distanceMeters: 500, nowMs: 45 * minute) == .prompt)
    }

    @Test func periodicCheckIsDueEveryFiveMinutes() {
        var s = anchored(at: 0)
        #expect(!AwayReminder.checkDue(AwayReminder.State(), nowMs: 60 * minute))
        #expect(!AwayReminder.checkDue(s, nowMs: 4 * minute))
        #expect(AwayReminder.checkDue(s, nowMs: 5 * minute))
        s.checked(atMs: 5 * minute)
        #expect(!AwayReminder.checkDue(s, nowMs: 9 * minute))
        #expect(AwayReminder.checkDue(s, nowMs: 10 * minute))
    }

    @Test func keepGoingMovesTheAnchorButKeepsTheThrottle() {
        var s = anchored()
        s.prompted(atMs: 10 * minute)
        s.reanchor(latitude: 1, longitude: 2, atMs: 11 * minute)
        #expect(s.anchor?.sessionId == "s1")
        #expect(s.anchor?.latitude == 1 && s.anchor?.longitude == 2 && s.anchor?.setMs == 11 * minute)
        #expect(s.lastPromptMs == 10 * minute)
        s.clear()
        #expect(s == AwayReminder.State())
        var empty = AwayReminder.State()
        empty.reanchor(latitude: 1, longitude: 2, atMs: 0)
        #expect(empty.anchor == nil, "nothing to move without an anchor")
    }

    @Test func haversineMatchesAKnownDistance() {
        // Geisel Library to the Scripps pier: about 2.3 km.
        let d = AwayReminder.distanceMeters(
            fromLatitude: 32.8811, longitude: -117.2376, toLatitude: 32.8663, longitude: -117.2546)
        #expect(d > 2_200 && d < 2_400)
        #expect(AwayReminder.distanceMeters(fromLatitude: 0, longitude: 0, toLatitude: 0, longitude: 0) == 0)
    }

    @Test func stateRoundTripsThroughJSON() throws {
        var s = anchored(at: 7)
        s.prompted(atMs: 9)
        s.snooze(fromMs: 9)
        let data = try JSONEncoder().encode(s)
        #expect(try JSONDecoder().decode(AwayReminder.State.self, from: data) == s)
    }
}

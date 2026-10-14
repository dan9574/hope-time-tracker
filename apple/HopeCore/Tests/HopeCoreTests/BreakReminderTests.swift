import Foundation
import HopeCore
import Testing

// Mirrors the cases in src-tauri/src/db/break_reminder.rs; keep both in step.
struct BreakReminderTests {
    private let minute: Int64 = 60_000
    private let interval = BreakReminder.intervalMs

    @Test func freshChainSchedulesTheNextStepsFromNow() {
        let now: Int64 = 1_000_000
        let due = BreakReminder.pending(elapsedMs: 0, nowMs: now, ackMs: nil, offsetMs: 0)
        #expect(due.map(\.step) == [1, 2, 3, 4])
        #expect(due.map(\.dueMs) == [now + interval, now + 2 * interval, now + 3 * interval, now + 4 * interval])
        #expect(due.map(\.fireAtMs) == due.map(\.dueMs))
    }

    @Test func elapsedTimeAndOffsetsShiftTheFireTimes() {
        let now: Int64 = 5_000_000
        // 30 minutes in: the first reminder is an hour away; the phone adds two minutes.
        let phone = BreakReminder.pending(elapsedMs: 30 * minute, nowMs: now, ackMs: nil, offsetMs: BreakReminder.phoneOffsetMs)
        #expect(phone.first == .init(step: 1, dueMs: now + 60 * minute, fireAtMs: now + 62 * minute))
        let desktop = BreakReminder.pending(elapsedMs: 30 * minute, nowMs: now, ackMs: nil, offsetMs: BreakReminder.desktopOffsetMs)
        #expect(desktop.first?.fireAtMs == now + 61 * minute)
    }

    @Test func anOverdueStepFiresNowAndOnlyTheLatestOne() {
        let now: Int64 = 9_000_000
        // Learned about the chain at 100 minutes: step 1 was due 10 minutes ago.
        let late = BreakReminder.pending(elapsedMs: 100 * minute, nowMs: now, ackMs: nil, offsetMs: 0)
        #expect(late.first == .init(step: 1, dueMs: now - 10 * minute, fireAtMs: now))
        #expect(late.map(\.step) == [1, 2, 3, 4, 5])
        // At 200 minutes steps 1 and 2 are both past; only step 2 fires, right away.
        let later = BreakReminder.pending(elapsedMs: 200 * minute, nowMs: now, ackMs: nil, offsetMs: 0)
        #expect(later.map(\.step) == [2, 3, 4, 5, 6])
        #expect(later.first?.fireAtMs == now)
        // Exactly on the boundary the step counts as reached.
        let exact = BreakReminder.pending(elapsedMs: interval, nowMs: now, ackMs: nil, offsetMs: 0)
        #expect(exact.first == .init(step: 1, dueMs: now, fireAtMs: now))
    }

    @Test func keepGoingSettlesTheStepThatWasDue() {
        let now: Int64 = 9_000_000
        // At 95 minutes the user chose Keep Going 3 minutes ago (step 1 was due 5 minutes ago).
        let acked = BreakReminder.pending(elapsedMs: 95 * minute, nowMs: now, ackMs: now - 3 * minute, offsetMs: 0)
        #expect(acked.map(\.step) == [2, 3, 4, 5])
        // An acknowledgement from before the step was due settles nothing.
        let stale = BreakReminder.pending(elapsedMs: 95 * minute, nowMs: now, ackMs: now - 10 * minute, offsetMs: 0)
        #expect(stale.first?.step == 1)
        // Acknowledged after step 2 was also due: both are settled.
        let both = BreakReminder.pending(elapsedMs: 185 * minute, nowMs: now, ackMs: now - minute, offsetMs: 0)
        #expect(both.map(\.step) == [3, 4, 5, 6])
    }

    @Test func lookaheadAndIdentifiers() {
        let one = BreakReminder.pending(elapsedMs: 0, nowMs: 0, ackMs: nil, offsetMs: 0, lookahead: 1)
        #expect(one.count == 1)
        let none = BreakReminder.pending(elapsedMs: 10 * minute, nowMs: 0, ackMs: nil, offsetMs: 0, lookahead: 0)
        #expect(none.isEmpty, "nothing reached and nothing ahead")
        #expect(BreakReminder.identifier(chainId: "abc", step: 2) == "hope.break.abc.2")
        #expect(BreakReminder.identifier(chainId: "abc", step: 2).hasPrefix(BreakReminder.identifierPrefix))
    }
}

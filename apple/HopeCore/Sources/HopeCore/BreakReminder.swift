import Foundation

/// The "take a break" reminder (rebuild-plan 15.2): every decision as pure functions, so the rules are
/// testable and identical on every device (`src-tauri/src/db/break_reminder.rs` is the Rust twin).
///
/// A pause/resume chain that has run `elapsed` (pauses excluded, the number the timer shows) is reminded
/// each time it reaches N × 90 minutes. Each device fires at that moment plus its own offset, so the watch
/// comes first, the desktop second and the iPhone last; a "Keep Going" stamped on the chain
/// (`session.break_ack_ms`) at or after a step's due time settles that step everywhere.
public enum BreakReminder {
    /// Remind every time the chain has run this much more.
    public static let intervalMs: Int64 = 90 * 60_000
    /// Device offsets after the due time (rebuild-plan 15.2).
    public static let watchOffsetMs: Int64 = 0
    public static let desktopOffsetMs: Int64 = 60_000
    public static let phoneOffsetMs: Int64 = 2 * 60_000
    /// How many future steps a device schedules ahead while its app may stay suspended.
    public static let lookahead = 4

    /// One reminder of a chain: the N-th (1-based), when it is due, and when this device fires it.
    public struct Due: Equatable, Sendable {
        public var step: Int
        public var dueMs: Int64
        public var fireAtMs: Int64

        public init(step: Int, dueMs: Int64, fireAtMs: Int64) {
            self.step = step
            self.dueMs = dueMs
            self.fireAtMs = fireAtMs
        }
    }

    /// The reminders a device should have scheduled for a running chain, oldest first.
    ///
    /// - `elapsedMs`: the chain's running time at `nowMs`, pauses excluded.
    /// - `ackMs`: the chain's latest `break_ack_ms`, if any. A step whose due time is at or before it is settled.
    /// - A step that is already overdue (the device learned about the chain late) fires right away — but
    ///   only the most recent one; older overdue steps are dropped rather than delivered in a burst.
    /// - The result has at most `lookahead` future steps after the current one.
    public static func pending(
        elapsedMs: Int64, nowMs: Int64, ackMs: Int64?, offsetMs: Int64, lookahead: Int = lookahead
    ) -> [Due] {
        let elapsed = max(0, elapsedMs)
        // The last step already reached (0 = none yet); only it may fire late.
        let reached = Int(elapsed / intervalMs)
        let first = max(1, reached)
        let last = reached + max(0, lookahead)
        guard first <= last else { return [] }
        var out: [Due] = []
        for step in first...last {
            let due = nowMs + Int64(step) * intervalMs - elapsed
            if let ackMs, ackMs >= due { continue }
            out.append(Due(step: step, dueMs: due, fireAtMs: max(due, nowMs) + offsetMs))
        }
        return out
    }

    /// Notification identifier for one step of one chain; `chainId` is the chain's first session id.
    public static func identifier(chainId: String, step: Int) -> String {
        "\(identifierPrefix)\(chainId).\(step)"
    }

    public static let identifierPrefix = "hope.break."
}

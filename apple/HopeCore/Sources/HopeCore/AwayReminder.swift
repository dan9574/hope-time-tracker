import Foundation

/// The "you walked away from where you started" reminder (rebuild-plan 14.2): every decision, with no
/// CoreLocation or notification code, so the rules are testable. The iPhone app measures distances and
/// times, feeds them in, and persists `State` between launches.
public enum AwayReminder {
    /// Farther than this from the anchor counts as having left.
    public static let radiusMeters: Double = 300
    /// Two checks, and two prompts, for the same session are at least this far apart.
    public static let minIntervalMs: Int64 = 5 * 60_000
    /// "Not for 30 minutes".
    public static let snoozeMs: Int64 = 30 * 60_000

    /// Where the running session started, or where the user chose to keep going.
    public struct Anchor: Codable, Equatable, Sendable {
        public var sessionId: String
        public var latitude: Double
        public var longitude: Double
        public var setMs: Int64

        public init(sessionId: String, latitude: Double, longitude: Double, setMs: Int64) {
            self.sessionId = sessionId
            self.latitude = latitude
            self.longitude = longitude
            self.setMs = setMs
        }
    }

    public struct State: Codable, Equatable, Sendable {
        public var anchor: Anchor?
        public var lastCheckMs: Int64?
        public var lastPromptMs: Int64?
        public var snoozeUntilMs: Int64?

        public init() {}

        /// A session started: nothing from the previous one carries over.
        public mutating func start(_ anchor: Anchor) {
            self = State()
            self.anchor = anchor
        }

        /// "Keep going": the new place becomes the anchor; the prompt throttle and snooze stay.
        public mutating func reanchor(latitude: Double, longitude: Double, atMs: Int64) {
            guard var a = anchor else { return }
            a.latitude = latitude
            a.longitude = longitude
            a.setMs = atMs
            anchor = a
        }

        /// The timer stopped, paused, or the feature was turned off.
        public mutating func clear() {
            self = State()
        }

        public mutating func checked(atMs: Int64) {
            lastCheckMs = atMs
        }

        public mutating func prompted(atMs: Int64) {
            lastCheckMs = atMs
            lastPromptMs = atMs
        }

        public mutating func snooze(fromMs: Int64) {
            snoozeUntilMs = fromMs + AwayReminder.snoozeMs
        }
    }

    public enum Skip: Equatable, Sendable {
        case noAnchor, differentSession, inside, snoozed, tooSoon
    }

    public enum Outcome: Equatable, Sendable {
        case prompt
        case skip(Skip)
    }

    /// Rule 2 of 14.2: when the app wakes for any reason, a check is due if the last one (or the anchor
    /// itself) is at least `minIntervalMs` old.
    public static func checkDue(_ state: State, nowMs: Int64) -> Bool {
        guard let anchor = state.anchor else { return false }
        return nowMs - (state.lastCheckMs ?? anchor.setMs) >= minIntervalMs
    }

    /// What a measured distance from the anchor means right now.
    public static func evaluate(_ state: State, sessionId: String, distanceMeters: Double, nowMs: Int64) -> Outcome {
        guard let anchor = state.anchor else { return .skip(.noAnchor) }
        guard anchor.sessionId == sessionId else { return .skip(.differentSession) }
        guard distanceMeters > radiusMeters else { return .skip(.inside) }
        if let until = state.snoozeUntilMs, nowMs < until { return .skip(.snoozed) }
        if let last = state.lastPromptMs, nowMs - last < minIntervalMs { return .skip(.tooSoon) }
        return .prompt
    }

    /// Great-circle distance (haversine); accurate to well under a metre at these scales.
    public static func distanceMeters(
        fromLatitude lat1: Double, longitude lon1: Double, toLatitude lat2: Double, longitude lon2: Double
    ) -> Double {
        let earthRadius = 6_371_000.0
        let p1 = lat1 * .pi / 180
        let p2 = lat2 * .pi / 180
        let dp = (lat2 - lat1) * .pi / 180
        let dl = (lon2 - lon1) * .pi / 180
        let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * earthRadius * atan2(sqrt(a), sqrt(1 - a))
    }
}

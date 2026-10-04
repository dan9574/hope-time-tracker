import Foundation

/// What the watch-face complication shows. The widget runs in its own process and never opens the
/// SwiftData store; the watch app writes this small value to the App Group container after every change
/// that matters, and the widget only reads it.
///
/// Times are stored so that the widget needs no timeline reloads while a timer runs: a running chain is
/// described by the instant a system timer text should count up from.
public struct WidgetSnapshot: Codable, Equatable, Sendable {
    public enum State: String, Codable, Sendable { case idle, running, paused }

    public static let currentVersion = 1

    public var version: Int
    public var state: State
    /// The top-level activity (or the activity itself when it has no parent). `nil` when idle, or when the
    /// activity is unknown on this device (sync may deliver it later).
    public var parentName: String?
    /// The sub-activity's own name, when the timed activity is one.
    public var childName: String?
    /// The activity's palette colour (children use their parent's).
    public var color: ActivityColor?
    /// Running only: `now − chainDuration`, i.e. when the chain would have started had it never paused.
    /// A timer text counting up from here shows the chain's time with pauses excluded.
    public var effectiveStartMs: Int64?
    /// Paused only: the chain's frozen time.
    public var elapsedMs: Int64?
    /// Today's total at `writtenAtMs`, for the calendar day `[dayStartMs, dayEndMs)`.
    public var todayTotalMs: Int64
    public var dayStartMs: Int64
    public var dayEndMs: Int64
    public var writtenAtMs: Int64

    public init(
        state: State, parentName: String? = nil, childName: String? = nil, color: ActivityColor? = nil,
        effectiveStartMs: Int64? = nil, elapsedMs: Int64? = nil, todayTotalMs: Int64, dayStartMs: Int64,
        dayEndMs: Int64, writtenAtMs: Int64
    ) {
        version = Self.currentVersion
        self.state = state
        self.parentName = parentName
        self.childName = childName
        self.color = color
        self.effectiveStartMs = effectiveStartMs
        self.elapsedMs = elapsedMs
        self.todayTotalMs = todayTotalMs
        self.dayStartMs = dayStartMs
        self.dayEndMs = dayEndMs
        self.writtenAtMs = writtenAtMs
    }

    /// Nothing known yet (no snapshot written): idle, nothing tracked.
    public static func empty(now: Int64, calendar: Calendar = .current) -> WidgetSnapshot {
        let day = LocalStore.dayRange(of: Date(timeIntervalSince1970: Double(now) / 1000), calendar: calendar)
        return WidgetSnapshot(state: .idle, todayTotalMs: 0, dayStartMs: day.from, dayEndMs: day.to, writtenAtMs: now)
    }

    /// `Parent · Child`, or the activity's name.
    public var title: String? {
        guard let parentName else { return childName }
        return childName.map { "\(parentName) · \($0)" } ?? parentName
    }

    /// The most specific name, for small spaces: the sub-activity, else the activity.
    public var shortTitle: String? { childName ?? parentName }

    /// Today's total as of `now`: what was tracked on the snapshot's day, or zero once that day is over
    /// (nothing can have been tracked since, or the app would have written a new snapshot).
    public func todayTotalMs(at now: Int64) -> Int64 {
        now >= dayStartMs && now < dayEndMs ? todayTotalMs : 0
    }

    /// Whether the two snapshots look the same on the watch face, so a rewrite needs no widget reload.
    /// The write time never shows, and today's total only shows while idle.
    public func looksSame(as other: WidgetSnapshot) -> Bool {
        func shown(_ s: WidgetSnapshot) -> WidgetSnapshot {
            var s = s
            s.writtenAtMs = 0
            if s.state != .idle {
                s.todayTotalMs = 0
                s.dayStartMs = 0
                s.dayEndMs = 0
            }
            return s
        }
        return shown(self) == shown(other)
    }
}

extension LocalStore {
    /// The complication's view of the timer and of today, as of `now`.
    public func widgetSnapshot(now: Int64? = nil, calendar: Calendar = .current) -> WidgetSnapshot {
        let now = now ?? self.now
        let day = Self.dayRange(of: Date(timeIntervalSince1970: Double(now) / 1000), calendar: calendar)
        var snapshot = WidgetSnapshot(
            state: .idle, todayTotalMs: summary(from: day.from, to: day.to, now: now).totalMs, dayStartMs: day.from,
            dayEndMs: day.to, writtenAtMs: now)
        let timer = timerState()
        guard let session = timer.running ?? timer.paused else { return snapshot }

        if let a = activity(session.activityId) {
            if let p = parent(of: a) {
                snapshot.parentName = p.name
                snapshot.childName = a.name
            } else {
                snapshot.parentName = a.name
            }
        }
        snapshot.color = color(activityId: session.activityId)
        let chain = chainDuration(endingWith: session, now: now)
        if timer.running != nil {
            snapshot.state = .running
            snapshot.effectiveStartMs = now - chain
        } else {
            snapshot.state = .paused
            snapshot.elapsedMs = chain
        }
        return snapshot
    }
}

/// The snapshot's file in a shared directory (the App Group container on device). Reads never throw: a
/// missing, unreadable or newer-format file reads as `nil`, and the widget falls back to its idle look.
public struct WidgetSnapshotFile: Sendable {
    public static let fileName = "widget-snapshot.json"

    public let url: URL

    public init(directory: URL) {
        url = directory.appendingPathComponent(Self.fileName, isDirectory: false)
    }

    /// The file in the App Group container `group`; `nil` when no group is configured (the launcher-only
    /// build) or the container is not available to this process (the entitlement is missing).
    public init?(appGroup group: String?) {
        guard let group, !group.isEmpty,
            let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
        else { return nil }
        self.init(directory: directory)
    }

    /// The group named by the `HopeAppGroup` Info.plist key, which the build fills in only when live
    /// complication data is switched on (see apple/README.md).
    public static func fromBundle(_ bundle: Bundle = .main) -> WidgetSnapshotFile? {
        WidgetSnapshotFile(appGroup: bundle.object(forInfoDictionaryKey: "HopeAppGroup") as? String)
    }

    public func read() -> WidgetSnapshot? {
        guard let data = try? Data(contentsOf: url),
            let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
            snapshot.version <= WidgetSnapshot.currentVersion
        else { return nil }
        return snapshot
    }

    /// Replaces the file atomically, so the widget never sees half a snapshot.
    public func write(_ snapshot: WidgetSnapshot) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(snapshot).write(to: url, options: .atomic)
    }
}

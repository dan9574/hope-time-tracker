import HopeCore
import os
import SwiftUI
import UserNotifications

/// What one device has scheduled for a chain. The watch sends it to the iPhone over WatchConnectivity so
/// the phone drops its own, later reminders for the same steps (rebuild-plan 15.5).
struct BreakClaim: Codable, Equatable {
    /// The chain's first session id.
    var chainId: String
    /// Step number → when that step is due. Only steps the system actually accepted.
    var dueMs: [Int: Int64]
}

/// The running timer as this device sees it, sent watch → iPhone with every change so the phone can act
/// on a session it has not pulled yet (rebuild-plan 15.5 / 14.5): it syncs in the background, anchors the
/// away reminder and lines up its fallback break reminders.
struct TimerBeacon: Codable, Equatable {
    var sessionId: String?
    var activityId: String?
    var startMs: Int64?
    var sentMs: Int64
}

/// The "take a break" reminder on this device (rebuild-plan 15.3 / 15.5): every time the local store
/// changes it re-reads the running chain and (re)schedules the next few reminders as local notifications,
/// so the system delivers them while the app is suspended. The rules are `BreakReminder` in HopeCore;
/// this class only talks to the notification center and persists the switch.
///
/// Created at launch so a notification action that starts the app in the background finds it listening.
@MainActor
@Observable
final class BreakScheduler {
    static let categoryId = "hope.break"
    static let enabledKey = "break.enabled"
    static let watchClaimKey = "break.watchClaim"

    enum Action: String {
        case pause = "hope.break.pause"
        case keepGoing = "hope.break.keep"
    }

    /// Why nothing is lined up right now, for the status line under the switch.
    enum Idle: Equatable {
        case off, notAuthorized, noTimer, exempt, settled
        /// Phone only: the watch has every pending step.
        case watchHasIt
    }

    private let model: AppModel
    /// This device's delay after the due time (watch 0, phone 2 min).
    private let offsetMs: Int64
    private let defaults = UserDefaults.standard
    private let log = Logger(subsystem: "io.github.dan9574.hope", category: "break")

    private(set) var enabled: Bool
    /// The next reminder the system has accepted, if any.
    private(set) var nextFireMs: Int64?
    private(set) var idle: Idle = .off
    /// Watch: told the timer and what is now scheduled after every pass, to forward to the iPhone.
    @ObservationIgnored var onScheduled: ((BreakClaim?, TimerBeacon) -> Void)?
    /// Phone: the watch's latest claim; its steps are skipped here.
    @ObservationIgnored private var watchClaim: BreakClaim?
    /// Passes run one after another: a pass that removed our requests must not overtake the one that is
    /// re-adding them (that wiped the schedule once, 2026-10-14).
    @ObservationIgnored private var queue: Task<Void, Never>?

    /// - defaultEnabled: what the switch means before the user has touched it (the watch starts on).
    init(model: AppModel, offsetMs: Int64, defaultEnabled: Bool = false) {
        self.model = model
        self.offsetMs = offsetMs
        enabled = defaults.object(forKey: Self.enabledKey) == nil ? defaultEnabled : defaults.bool(forKey: Self.enabledKey)
        if let data = defaults.data(forKey: Self.watchClaimKey) {
            watchClaim = try? JSONDecoder().decode(BreakClaim.self, from: data)
        }
        NotificationRouter.shared.register(Self.category()) { [weak self] action, _ in
            await self?.handle(action: action)
        }
        observe()
        reschedule()
    }

    // MARK: Setting

    /// Turning it on asks for notification permission; off removes everything scheduled.
    func setEnabled(_ on: Bool) async {
        if on { await requestAuthorization() }
        enabled = on
        defaults.set(on, forKey: Self.enabledKey)
        reschedule()
        await queue?.value
    }

    /// Phone only: the watch reported what it has scheduled (or `nil`: nothing).
    func watchClaimed(_ claim: BreakClaim?) {
        log.notice("watch claim: \(claim.map { "\($0.chainId) steps \($0.dueMs.keys.sorted())" } ?? "none", privacy: .public)")
        watchClaim = claim
        defaults.set(claim.flatMap { try? JSONEncoder().encode($0) }, forKey: Self.watchClaimKey)
        reschedule()
    }

    private func requestAuthorization() async {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
        log.notice("notification permission \(granted ? "granted" : "denied", privacy: .public)")
    }

    // MARK: Following the timer

    private func observe() {
        withObservationTracking {
            _ = model.store.revision
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.reschedule()
                self?.observe()
            }
        }
    }

    /// Queues a pass that replaces every pending reminder of ours with what the running chain needs now.
    func reschedule() {
        let previous = queue
        queue = Task { [weak self] in
            await previous?.value
            await self?.pass()
        }
    }

    private func pass() async {
        let center = UNUserNotificationCenter.current()
        let ours = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(BreakReminder.identifierPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ours)

        let store = model.store
        let running = store.timerState().running
        let beacon = TimerBeacon(sessionId: running?.id, activityId: running?.activityId, startMs: running?.startMs, sentMs: store.now)
        var claimSent: BreakClaim?
        defer { onScheduled?(claimSent, beacon) }
        nextFireMs = nil

        guard enabled else {
            idle = .off
            return
        }
        guard let running else {
            // Nothing runs: a reminder still sitting in Notification Center is stale.
            let shown = await center.deliveredNotifications().map(\.request.identifier).filter { $0.hasPrefix(BreakReminder.identifierPrefix) }
            center.removeDeliveredNotifications(withIdentifiers: shown)
            idle = .noTimer
            return
        }
        guard !store.isExercise(activityId: running.activityId), !store.isScheduled(activityId: running.activityId) else {
            idle = .exempt
            return
        }
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            // On by default (watch): ask the first time there is something to remind about.
            await requestAuthorization()
        }
        guard await center.notificationSettings().authorizationStatus == .authorized else {
            log.notice("not scheduling: notifications not authorized")
            idle = .notAuthorized
            return
        }

        let now = store.now
        let chain = store.chainRootId(of: running)
        let elapsed = store.chainDuration(endingWith: running, now: now)
        let ack = store.chainBreakAckMs(endingWith: running)
        var due = BreakReminder.pending(elapsedMs: elapsed, nowMs: now, ackMs: ack, offsetMs: offsetMs)
        let watchCovers = watchClaim.flatMap { $0.chainId == chain ? $0 : nil }
        if let watchCovers {
            due.removeAll { watchCovers.dueMs[$0.step] != nil }
        }
        if due.isEmpty {
            idle = watchCovers != nil ? .watchHasIt : .settled
            log.notice("chain \(chain, privacy: .public): nothing to schedule (\(String(describing: self.idle), privacy: .public))")
            return
        }
        let name = store.displayName(activityId: running.activityId) ?? String(localized: "Unknown activity")
        var accepted: [Int: Int64] = [:]
        for d in due {
            let content = UNMutableNotificationContent()
            content.title = String(localized: "Take a break")
            let ran = Format.duration(Int64(d.step) * BreakReminder.intervalMs)
            content.body = String(localized: "\(name) has been running for \(ran) without a break")
            content.categoryIdentifier = Self.categoryId
            content.sound = .default
            content.userInfo = ["chain": chain, "step": d.step]
            let seconds = max(1, Double(d.fireAtMs - now) / 1000)
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
            let request = UNNotificationRequest(identifier: BreakReminder.identifier(chainId: chain, step: d.step), content: content, trigger: trigger)
            do {
                try await center.add(request)
                accepted[d.step] = d.dueMs
            } catch {
                log.error("could not schedule step \(d.step) of \(chain, privacy: .public): \(error, privacy: .public)")
            }
        }
        let firstAccepted = due.first { accepted[$0.step] != nil }
        nextFireMs = firstAccepted?.fireAtMs
        idle = .settled
        claimSent = accepted.isEmpty ? nil : BreakClaim(chainId: chain, dueMs: accepted)
        log.notice("chain \(chain, privacy: .public): \(accepted.count) of \(due.count) scheduled, elapsed \(elapsed / 60_000) min, next in \(firstAccepted.map { ($0.fireAtMs - now) / 60_000 } ?? -1) min")
    }

    // MARK: Actions

    /// A notification action, possibly handled in a background launch. Both write the store, which
    /// reschedules through `observe()`; the push gets a moment before the launch may end.
    func handle(action id: String) async {
        log.notice("action \(id, privacy: .public)")
        switch Action(rawValue: id) {
        case .pause:
            do {
                _ = try model.store.pause()
            } catch {
                log.error("could not pause from the break reminder: \(error, privacy: .public)")
            }
        case .keepGoing:
            do {
                _ = try model.store.breakAck()
            } catch {
                log.error("could not record Keep Going: \(error, privacy: .public)")
            }
        case nil:
            return  // tapped or dismissed: nothing changes, the next step stays scheduled
        }
        model.sync.syncNow()
        try? await Task.sleep(for: .seconds(3))
    }

    private static func category() -> UNNotificationCategory {
        UNNotificationCategory(
            identifier: categoryId,
            actions: [
                UNNotificationAction(identifier: Action.pause.rawValue, title: String(localized: "Pause")),
                UNNotificationAction(identifier: Action.keepGoing.rawValue, title: String(localized: "A Little Longer")),
            ],
            intentIdentifiers: [])
    }

    // MARK: Status line

    /// One line under the switch saying what will happen next.
    var statusText: String? {
        guard enabled else { return nil }
        if let next = nextFireMs {
            let time = Date(timeIntervalSince1970: Double(next) / 1000).formatted(date: .omitted, time: .shortened)
            return String(localized: "Next reminder at \(time)")
        }
        switch idle {
        case .off: return nil
        case .notAuthorized: return String(localized: "Notifications are off for Hope. Turn them on in Settings.")
        case .noTimer: return String(localized: "No timer running.")
        case .exempt: return String(localized: "Exercise and the timetable are not reminded.")
        case .settled: return String(localized: "Nothing more to remind for this timer.")
        case .watchHasIt: return String(localized: "The watch will remind.")
        }
    }
}

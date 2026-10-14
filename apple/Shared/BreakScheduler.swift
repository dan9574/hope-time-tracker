import HopeCore
import SwiftUI
import UserNotifications

/// What one device has scheduled for a chain. The watch sends it to the iPhone over WatchConnectivity so
/// the phone drops its own, later reminders for the same steps (rebuild-plan 15.5).
struct BreakClaim: Codable, Equatable {
    /// The chain's first session id.
    var chainId: String
    /// Step number → when that step is due.
    var dueMs: [Int: Int64]
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

    private let model: AppModel
    /// This device's delay after the due time (watch 0, phone 2 min).
    private let offsetMs: Int64
    private let defaults = UserDefaults.standard

    private(set) var enabled: Bool
    private(set) var notificationsDenied = false
    /// Watch: told what is now scheduled after every pass, to forward to the iPhone.
    @ObservationIgnored var onScheduled: ((BreakClaim?) -> Void)?
    /// Phone: the watch's latest claim; its steps are skipped here.
    @ObservationIgnored private var watchClaim: BreakClaim?
    @ObservationIgnored private var pass = 0

    init(model: AppModel, offsetMs: Int64) {
        self.model = model
        self.offsetMs = offsetMs
        enabled = defaults.bool(forKey: Self.enabledKey)
        if let data = defaults.data(forKey: Self.watchClaimKey) {
            watchClaim = try? JSONDecoder().decode(BreakClaim.self, from: data)
        }
        NotificationRouter.shared.register(Self.category()) { [weak self] action, _ in
            await self?.handle(action: action)
        }
        observe()
        Task { await reschedule() }
    }

    // MARK: Setting

    /// Turning it on asks for notification permission; off removes everything scheduled.
    func setEnabled(_ on: Bool) async {
        if on {
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
            notificationsDenied = !granted
        }
        enabled = on
        defaults.set(on, forKey: Self.enabledKey)
        await reschedule()
    }

    /// Phone only: the watch reported what it has scheduled (or `nil`: nothing).
    func watchClaimed(_ claim: BreakClaim?) {
        watchClaim = claim
        defaults.set(claim.flatMap { try? JSONEncoder().encode($0) }, forKey: Self.watchClaimKey)
        Task { await reschedule() }
    }

    // MARK: Following the timer

    private func observe() {
        withObservationTracking {
            _ = model.store.revision
        } onChange: { [weak self] in
            Task { @MainActor in
                await self?.reschedule()
                self?.observe()
            }
        }
    }

    /// Replaces every pending reminder of ours with what the running chain needs now.
    func reschedule() async {
        pass += 1
        let thisPass = pass
        let center = UNUserNotificationCenter.current()
        let ours = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(BreakReminder.identifierPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ours)
        // A later pass started while we were waiting; it will do the scheduling.
        guard thisPass == pass else { return }

        let store = model.store
        guard enabled, let running = store.timerState().running,
              !store.isExercise(activityId: running.activityId), !store.isScheduled(activityId: running.activityId)
        else {
            // Nothing runs: a reminder still sitting in Notification Center is stale.
            let shown = await center.deliveredNotifications().map(\.request.identifier).filter { $0.hasPrefix(BreakReminder.identifierPrefix) }
            center.removeDeliveredNotifications(withIdentifiers: shown)
            onScheduled?(nil)
            return
        }
        let now = store.now
        let chain = store.chainRootId(of: running)
        let elapsed = store.chainDuration(endingWith: running, now: now)
        let ack = store.chainBreakAckMs(endingWith: running)
        var due = BreakReminder.pending(elapsedMs: elapsed, nowMs: now, ackMs: ack, offsetMs: offsetMs)
        if let claim = watchClaim, claim.chainId == chain {
            due.removeAll { claim.dueMs[$0.step] != nil }
        }
        let name = store.displayName(activityId: running.activityId) ?? String(localized: "Unknown activity")
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
            } catch {
                print("Hope: could not schedule a break reminder: \(error)")
            }
        }
        let claim = due.isEmpty ? nil : BreakClaim(chainId: chain, dueMs: Dictionary(due.map { ($0.step, $0.dueMs) }, uniquingKeysWith: { a, _ in a }))
        onScheduled?(claim)
    }

    // MARK: Actions

    /// A notification action, possibly handled in a background launch. Both write the store, which
    /// reschedules through `observe()`; the push gets a moment before the launch may end.
    func handle(action id: String) async {
        switch Action(rawValue: id) {
        case .pause:
            do {
                _ = try model.store.pause()
            } catch {
                print("Hope: could not pause from the break reminder: \(error)")
            }
        case .keepGoing:
            do {
                _ = try model.store.breakAck()
            } catch {
                print("Hope: could not record Keep Going: \(error)")
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
}

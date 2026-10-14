import CoreLocation
import HopeCore
import SwiftUI
import UserNotifications

/// The iPhone side of the away reminder (rebuild-plan 14.2). While a timer runs on an ordinary activity,
/// the place it started is the anchor; a `CLMonitor` circle of 300 m around it wakes the app when it is
/// left, and a notification with three actions asks what to do. The rules themselves (`AwayReminder`) live
/// in HopeCore; this class only measures, persists and talks to the system.
///
/// Created at launch so that a geofence event or a notification action can reach it when the app is
/// started in the background for either.
@MainActor
@Observable
final class AwayMonitor: NSObject {
    static let enabledKey = "away.enabled"
    static let stateKey = "away.state"
    /// Letters and digits only: `CLMonitor` asserts ("Monitor name is not valid") on anything else, which
    /// took the app down at every launch while the switch was on (2026-10-14, the name was "hope.away").
    static let monitorName = "HopeAway"
    static let conditionId = "anchor"
    static let categoryId = "hope.away"

    enum Action: String {
        case keepGoing = "hope.away.keep"
        case stop = "hope.away.stop"
        case snooze = "hope.away.snooze"
    }

    private let model: AppModel
    private let defaults = UserDefaults.standard
    @ObservationIgnored private let location = CLLocationManager()
    @ObservationIgnored private var monitorTask: Task<CLMonitor, Never>?
    @ObservationIgnored private var eventsTask: Task<Void, Never>?
    @ObservationIgnored private var fixWaiters: [CheckedContinuation<CLLocationCoordinate2D?, Never>] = []
    @ObservationIgnored private var authWaiters: [CheckedContinuation<Void, Never>] = []

    private(set) var state = AwayReminder.State()
    private(set) var enabled: Bool
    private(set) var locationStatus: CLAuthorizationStatus
    private(set) var notificationsDenied = false

    init(model: AppModel) {
        self.model = model
        enabled = defaults.bool(forKey: Self.enabledKey)
        if let data = defaults.data(forKey: Self.stateKey),
           let saved = try? JSONDecoder().decode(AwayReminder.State.self, from: data) {
            state = saved
        }
        locationStatus = location.authorizationStatus
        super.init()
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyHundredMeters
        NotificationRouter.shared.register(Self.category()) { [weak self] action, _ in
            await self?.handle(action: action)
        }
        if enabled { startMonitor() }
        observe()
        syncWithTimer()
    }

    // MARK: Setting

    /// Turning it on asks for notifications and location (When In Use first, then Always, as iOS requires).
    func setEnabled(_ on: Bool) async {
        if on {
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
            notificationsDenied = !granted
            await requestLocationAuthorization()
        }
        enabled = on
        defaults.set(on, forKey: Self.enabledKey)
        if on {
            startMonitor()
            syncWithTimer()
        } else {
            state.clear()
            persist()
            await removeCondition()
        }
    }

    var locationStatusText: String {
        switch locationStatus {
        case .authorizedAlways: String(localized: "Always")
        case .authorizedWhenInUse: String(localized: "While using the app (can't remind in the background)")
        case .notDetermined: String(localized: "Not asked yet")
        default: String(localized: "Not allowed")
        }
    }

    private func requestLocationAuthorization() async {
        if location.authorizationStatus == .notDetermined {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                authWaiters.append(c)
                location.requestWhenInUseAuthorization()
            }
        }
        if location.authorizationStatus == .authorizedWhenInUse {
            // iOS may show this prompt now or later; the delegate keeps `locationStatus` current.
            location.requestAlwaysAuthorization()
        }
        locationStatus = location.authorizationStatus
    }

    // MARK: Following the timer

    private func observe() {
        withObservationTracking {
            _ = model.store.revision
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.syncWithTimer()
                self?.observe()
            }
        }
    }

    /// A running session on an ordinary activity gets an anchor; anything else drops it.
    func syncWithTimer() {
        guard enabled else { return }
        let store = model.store
        guard let running = store.timerState().running,
              !store.isExercise(activityId: running.activityId),
              !store.isScheduled(activityId: running.activityId)
        else {
            if state.anchor != nil {
                state.clear()
                persist()
                Task { await removeCondition() }
            }
            return
        }
        guard state.anchor?.sessionId != running.id else { return }
        let sessionId = running.id
        Task { await anchor(sessionId: sessionId) }
    }

    private func anchor(sessionId: String) async {
        guard let fix = await currentLocation() else { return }
        // The timer may have changed while the fix was coming in.
        guard model.store.timerState().running?.id == sessionId else { return }
        state.start(.init(sessionId: sessionId, latitude: fix.latitude, longitude: fix.longitude, setMs: model.store.now))
        persist()
        await addCondition()
    }

    // MARK: Checking

    /// Rule 2 of 14.2: the app came to the front (or was woken); check if the last one is old enough.
    func appActivated() {
        guard enabled, AwayReminder.checkDue(state, nowMs: model.store.now) else { return }
        Task { await check() }
    }

    private func check() async {
        guard enabled, let anchor = state.anchor else { return }
        let store = model.store
        guard let running = store.timerState().running, running.id == anchor.sessionId else {
            state.clear()
            persist()
            await removeCondition()
            return
        }
        guard let fix = await currentLocation() else { return }
        let now = store.now
        let distance = AwayReminder.distanceMeters(
            fromLatitude: anchor.latitude, longitude: anchor.longitude,
            toLatitude: fix.latitude, longitude: fix.longitude)
        state.checked(atMs: now)
        switch AwayReminder.evaluate(state, sessionId: running.id, distanceMeters: distance, nowMs: now) {
        case .prompt:
            state.prompted(atMs: now)
            persist()
            await notify(session: running, now: now)
        case .skip:
            persist()
        }
    }

    /// A notification action, possibly handled in a background launch.
    func handle(action id: String) async {
        let now = model.store.now
        switch Action(rawValue: id) {
        case .keepGoing:
            if let fix = await currentLocation() {
                state.reanchor(latitude: fix.latitude, longitude: fix.longitude, atMs: now)
                persist()
                await addCondition()
            }
        case .stop:
            do {
                _ = try model.store.stop()
            } catch {
                print("Hope: could not stop the timer from the notification: \(error)")
            }
            state.clear()
            persist()
            await removeCondition()
            model.sync.syncNow()
            // Give the push a moment before a background launch is allowed to end.
            try? await Task.sleep(for: .seconds(3))
        case .snooze:
            state.snooze(fromMs: now)
            persist()
        case nil:
            break  // tapped or dismissed: keep going, anchor unchanged
        }
    }

    private func persist() {
        defaults.set(try? JSONEncoder().encode(state), forKey: Self.stateKey)
    }

    // MARK: Geofence

    private func monitor() async -> CLMonitor {
        if monitorTask == nil {
            monitorTask = Task { await CLMonitor(Self.monitorName) }
        }
        return await monitorTask!.value
    }

    /// Listens for the circle being left; the system starts the app in the background for these.
    private func startMonitor() {
        guard eventsTask == nil else { return }
        eventsTask = Task { [weak self] in
            guard let monitor = await self?.monitor() else { return }
            do {
                for try await event in await monitor.events {
                    guard event.identifier == Self.conditionId, event.state == .unsatisfied else { continue }
                    await self?.check()
                }
            } catch {
                print("Hope: away monitor ended: \(error)")
            }
        }
    }

    private func addCondition() async {
        guard let anchor = state.anchor else { return }
        let monitor = await monitor()
        let center = CLLocationCoordinate2D(latitude: anchor.latitude, longitude: anchor.longitude)
        let circle = CLMonitor.CircularGeographicCondition(center: center, radius: AwayReminder.radiusMeters)
        await monitor.add(circle, identifier: Self.conditionId, assuming: .satisfied)
    }

    private func removeCondition() async {
        guard monitorTask != nil else { return }
        await monitor().remove(Self.conditionId)
    }

    // MARK: Location fixes

    private func currentLocation() async -> CLLocationCoordinate2D? {
        guard location.authorizationStatus == .authorizedAlways || location.authorizationStatus == .authorizedWhenInUse else {
            return nil
        }
        return await withCheckedContinuation { c in
            fixWaiters.append(c)
            location.requestLocation()
        }
    }

    private func resumeFixes(with fix: CLLocationCoordinate2D?) {
        let waiters = fixWaiters
        fixWaiters.removeAll()
        for w in waiters { w.resume(returning: fix) }
    }

    private func authorizationChanged(_ status: CLAuthorizationStatus) {
        locationStatus = status
        let waiters = authWaiters
        authWaiters.removeAll()
        for w in waiters { w.resume() }
    }

    // MARK: Notification

    private func notify(session: SessionRecord, now: Int64) async {
        let store = model.store
        let name = store.displayName(activityId: session.activityId) ?? String(localized: "Unknown activity")
        let elapsed = Format.duration(store.chainDuration(endingWith: session, now: now))
        let content = UNMutableNotificationContent()
        content.title = String(localized: "You've left where you started the timer")
        content.body = String(localized: "\(name) has been running for \(elapsed)")
        content.categoryIdentifier = Self.categoryId
        content.sound = .default
        let request = UNNotificationRequest(identifier: "hope.away.\(session.id)", content: content, trigger: nil)
        do {
            try await UNUserNotificationCenter.current().add(request)
        } catch {
            print("Hope: could not show the away reminder: \(error)")
        }
    }

    private static func category() -> UNNotificationCategory {
        UNNotificationCategory(
            identifier: categoryId,
            actions: [
                UNNotificationAction(identifier: Action.keepGoing.rawValue, title: String(localized: "Keep Going")),
                UNNotificationAction(identifier: Action.stop.rawValue, title: String(localized: "Stop"), options: [.destructive]),
                UNNotificationAction(identifier: Action.snooze.rawValue, title: String(localized: "Not for 30 Minutes")),
            ],
            intentIdentifiers: [])
    }
}

extension AwayMonitor: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let fix = locations.last?.coordinate
        Task { @MainActor in self.resumeFixes(with: fix) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        Task { @MainActor in self.resumeFixes(with: nil) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in self.authorizationChanged(status) }
    }
}

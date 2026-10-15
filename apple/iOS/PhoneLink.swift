import HopeCore
import Observation
import os
import UIKit
import WatchConnectivity

/// The iPhone end of WatchConnectivity. Hands the watch a sign-in (rebuild-plan 12.7) and receives the
/// watch's timer beacon and break-reminder claims (rebuild-plan 14.5 / 15.5); records never travel this
/// way — the watch talks to Supabase itself, and the phone pulls from there.
@MainActor
@Observable
final class PhoneLink: NSObject {
    private(set) var watchAvailable = false
    /// The watch reported what break reminders it has scheduled (`nil`: none). iOS starts this app in the
    /// background to deliver it when it is not running.
    @ObservationIgnored var onBreakClaim: ((BreakClaim?) -> Void)?
    /// The watch reported its running timer (or none). Handled in the background too.
    @ObservationIgnored var onTimerBeacon: ((TimerBeacon) -> Void)?
    @ObservationIgnored private var pending: SessionHandoff?
    @ObservationIgnored private var activated = false
    @ObservationIgnored private var lastBeacon: TimerBeacon?
    private let log = Logger(subsystem: "io.github.dan9574.hope", category: "link")

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Latest-wins delivery: the watch receives it next time it runs, even if it is not running now.
    func send(_ handoff: SessionHandoff) {
        guard WCSession.isSupported() else { return }
        guard activated else {
            pending = handoff
            return
        }
        do {
            let data = try JSONEncoder().encode(handoff)
            try WCSession.default.updateApplicationContext(["handoff": data])
        } catch {
            print("Hope: could not hand the sign-in to the watch: \(error)")
        }
    }

    private func update(activated: Bool, available: Bool) {
        self.activated = activated
        watchAvailable = available
        if activated, let pending {
            self.pending = nil
            send(pending)
        }
    }

    /// Everything the watch put in its application context. This may run in a background launch with only
    /// seconds to live, so the work (a sync round, a location fix, scheduling) gets a background task.
    private func receive(timer: Data?, claim: Data?) {
        guard timer != nil || claim != nil else { return }
        let beacon = timer.flatMap { try? JSONDecoder().decode(TimerBeacon.self, from: $0) }
        // The watch sends an empty value when it has nothing scheduled.
        let claim = claim.flatMap { try? JSONDecoder().decode(BreakClaim.self, from: $0) }
        log.notice("from watch: timer \(beacon?.sessionId ?? "none", privacy: .public), claim \(claim.map { "\($0.dueMs.count) steps" } ?? "none", privacy: .public), state \(UIApplication.shared.applicationState.rawValue)")
        let task = UIApplication.shared.beginBackgroundTask(withName: "hope.watch-context") {}
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(25))
            UIApplication.shared.endBackgroundTask(task)
        }
        if let beacon, beacon.sessionId != lastBeacon?.sessionId {
            lastBeacon = beacon
            onTimerBeacon?(beacon)
        }
        onBreakClaim?(claim)
    }
}

extension PhoneLink: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: (any Error)?) {
        let activated = state == .activated
        let available = session.isPaired && session.isWatchAppInstalled
        // Whatever the watch sent while this app was not running. Only the Data values cross to the main
        // actor: the dictionary itself is not Sendable.
        let context = session.receivedApplicationContext
        let timer = context["timer"] as? Data
        let claim = context["break"] as? Data
        Task { @MainActor in
            self.update(activated: activated, available: available)
            self.receive(timer: timer, claim: claim)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        let timer = context["timer"] as? Data
        let claim = context["break"] as? Data
        Task { @MainActor in self.receive(timer: timer, claim: claim) }
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        let activated = session.activationState == .activated
        let available = session.isPaired && session.isWatchAppInstalled
        Task { @MainActor in self.update(activated: activated, available: available) }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        // Switching between paired watches: start over with the new one.
        WCSession.default.activate()
    }
}

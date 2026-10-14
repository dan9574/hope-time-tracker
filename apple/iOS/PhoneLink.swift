import HopeCore
import Observation
import WatchConnectivity

/// The iPhone end of WatchConnectivity. Hands the watch a sign-in (rebuild-plan 12.7) and receives the
/// watch's break-reminder claims (rebuild-plan 15.5); data never travels this way — the watch talks to
/// Supabase itself.
@MainActor
@Observable
final class PhoneLink: NSObject {
    private(set) var watchAvailable = false
    /// The watch reported what break reminders it has scheduled (`nil`: none). iOS starts this app in the
    /// background to deliver it when it is not running.
    @ObservationIgnored var onBreakClaim: ((BreakClaim?) -> Void)?
    @ObservationIgnored private var pending: SessionHandoff?
    @ObservationIgnored private var activated = false

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

    private func receiveBreakClaim(_ data: Data?) {
        // The watch sends an empty value when it has nothing scheduled.
        let claim = data.flatMap { try? JSONDecoder().decode(BreakClaim.self, from: $0) }
        onBreakClaim?(claim)
    }
}

extension PhoneLink: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: (any Error)?) {
        let activated = state == .activated
        let available = session.isPaired && session.isWatchAppInstalled
        // Whatever the watch sent while this app was not running.
        let claim = session.receivedApplicationContext["break"] as? Data
        Task { @MainActor in
            self.update(activated: activated, available: available)
            if claim != nil { self.receiveBreakClaim(claim) }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        let claim = context["break"] as? Data
        Task { @MainActor in self.receiveBreakClaim(claim) }
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

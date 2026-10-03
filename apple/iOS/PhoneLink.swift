import HopeCore
import Observation
import WatchConnectivity

/// The iPhone end of WatchConnectivity. Used only to hand the watch a sign-in (rebuild-plan 12.7); data
/// never travels this way — the watch talks to Supabase itself.
@MainActor
@Observable
final class PhoneLink: NSObject {
    private(set) var watchAvailable = false
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
}

extension PhoneLink: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: (any Error)?) {
        let activated = state == .activated
        let available = session.isPaired && session.isWatchAppInstalled
        Task { @MainActor in self.update(activated: activated, available: available) }
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

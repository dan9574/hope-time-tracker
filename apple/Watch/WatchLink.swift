import HopeCore
import WatchConnectivity

/// The watch end of WatchConnectivity: receives the sign-in the iPhone hands over (rebuild-plan 12.7) and
/// gives it to sync. Everything else goes straight to Supabase.
@MainActor
final class WatchLink: NSObject {
    private weak var sync: SyncService?

    func attach(_ sync: SyncService) {
        guard self.sync == nil, WCSession.isSupported() else { return }
        self.sync = sync
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    private func receive(_ data: Data?) {
        guard let data, let handoff = try? JSONDecoder().decode(SessionHandoff.self, from: data) else { return }
        Task { await sync?.adopt(handoff) }
    }
}

extension WatchLink: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: (any Error)?) {
        // Whatever the phone sent while this app was not running.
        let data = session.receivedApplicationContext["handoff"] as? Data
        Task { @MainActor in self.receive(data) }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        let data = context["handoff"] as? Data
        Task { @MainActor in self.receive(data) }
    }
}

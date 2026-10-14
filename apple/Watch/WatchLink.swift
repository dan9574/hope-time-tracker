import HopeCore
import WatchConnectivity

/// The watch end of WatchConnectivity: receives the sign-in the iPhone hands over (rebuild-plan 12.7) and
/// gives it to sync, and tells the iPhone which break reminders this watch has scheduled (rebuild-plan
/// 15.5). Everything else goes straight to Supabase.
@MainActor
final class WatchLink: NSObject {
    private weak var sync: SyncService?
    private var activated = false
    private var pendingClaim: Data??

    func attach(_ sync: SyncService) {
        guard self.sync == nil, WCSession.isSupported() else { return }
        self.sync = sync
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Latest-wins delivery to the iPhone; `nil` = nothing scheduled. iOS starts the phone app in the
    /// background to receive it, so the phone's fallback reminders are dropped without anyone opening it.
    func sendBreakClaim(_ claim: BreakClaim?) {
        guard WCSession.isSupported() else { return }
        let data = claim.flatMap { try? JSONEncoder().encode($0) }
        guard activated else {
            pendingClaim = .some(data)
            return
        }
        do {
            try WCSession.default.updateApplicationContext(["break": data ?? Data()])
        } catch {
            print("Hope: could not tell the iPhone about the break reminders: \(error)")
        }
    }

    private func didActivate(_ ok: Bool) {
        activated = ok
        if ok, let pending = pendingClaim {
            pendingClaim = nil
            sendBreakClaim(pending.flatMap { try? JSONDecoder().decode(BreakClaim.self, from: $0) })
        }
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
        let ok = state == .activated
        Task { @MainActor in
            self.receive(data)
            self.didActivate(ok)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        let data = context["handoff"] as? Data
        Task { @MainActor in self.receive(data) }
    }
}

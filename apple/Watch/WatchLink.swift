import HopeCore
import os
import WatchConnectivity

/// The watch end of WatchConnectivity: receives the sign-in the iPhone hands over (rebuild-plan 12.7) and
/// gives it to sync, and tells the iPhone which break reminders this watch has scheduled (rebuild-plan
/// 15.5). Everything else goes straight to Supabase.
@MainActor
final class WatchLink: NSObject {
    private weak var sync: SyncService?
    private var activated = false
    private var pending: (claim: BreakClaim?, timer: TimerBeacon)?
    private var lastSent: (claim: BreakClaim?, timer: TimerBeacon)?
    private let log = Logger(subsystem: "io.github.dan9574.hope", category: "link")

    func attach(_ sync: SyncService) {
        guard self.sync == nil, WCSession.isSupported() else { return }
        self.sync = sync
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Latest-wins delivery to the iPhone of the timer as the watch sees it and the break reminders it has
    /// lined up (`nil` = none). iOS starts the phone app in the background to receive it, so the phone
    /// learns about a timer started here without anyone opening it (rebuild-plan 14.5 / 15.5).
    func send(claim: BreakClaim?, timer: TimerBeacon) {
        guard WCSession.isSupported() else { return }
        guard activated else {
            pending = (claim, timer)
            return
        }
        // The timer's `sentMs` changes every pass; compare the parts that matter.
        if let last = lastSent, last.claim == claim, last.timer.sessionId == timer.sessionId { return }
        var context: [String: Any] = ["timer": (try? JSONEncoder().encode(timer)) ?? Data()]
        context["break"] = claim.flatMap { try? JSONEncoder().encode($0) } ?? Data()
        do {
            try WCSession.default.updateApplicationContext(context)
            lastSent = (claim, timer)
            log.notice("sent timer \(timer.sessionId ?? "none", privacy: .public), claim \(claim.map { "\($0.dueMs.count) steps" } ?? "none", privacy: .public)")
        } catch {
            log.error("could not update the iPhone: \(error, privacy: .public)")
        }
    }

    private func didActivate(_ ok: Bool) {
        activated = ok
        if ok, let pending {
            self.pending = nil
            send(claim: pending.claim, timer: pending.timer)
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

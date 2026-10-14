import HopeCore
import SwiftUI

@main
struct HopeWatchApp: App {
    @State private var model: AppModel
    @State private var link: WatchLink
    @State private var breaks: BreakScheduler
    @State private var complication: ComplicationPublisher?
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let model = AppModel()
        _model = State(initialValue: model)
        // Both made at launch: a break-reminder action may start the app in the background, and what it
        // schedules must reach the iPhone even then (rebuild-plan 15.3).
        let link = WatchLink()
        link.attach(model.sync)
        _link = State(initialValue: link)
        let breaks = BreakScheduler(model: model, offsetMs: BreakReminder.watchOffsetMs)
        breaks.onScheduled = { claim in link.sendBreakClaim(claim) }
        _breaks = State(initialValue: breaks)
    }

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environment(model)
                .environment(breaks)
                // The interface is colourless; colour belongs to activities (rebuild-plan 4.1).
                .tint(.primary)
                .task {
                    if complication == nil {
                        let publisher = ComplicationPublisher(store: model.store)
                        publisher.start()
                        complication = publisher
                    }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                model.sync.syncNow()
                // Today's total may belong to yesterday by now.
                complication?.publish()
            }
        }
    }
}

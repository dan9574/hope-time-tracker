import HopeCore
import SwiftUI

@main
struct HopeWatchApp: App {
    @State private var model = AppModel()
    @State private var link = WatchLink()
    @State private var complication: ComplicationPublisher?
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environment(model)
                // The interface is colourless; colour belongs to activities (rebuild-plan 4.1).
                .tint(.primary)
                .task {
                    link.attach(model.sync)
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

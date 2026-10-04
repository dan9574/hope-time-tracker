import HopeCore
import SwiftUI

@main
struct HopeWatchApp: App {
    @State private var model = AppModel()
    @State private var link = WatchLink()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environment(model)
                // The interface is colourless; colour belongs to activities (rebuild-plan 4.1).
                .tint(.primary)
                .task { link.attach(model.sync) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.sync.syncNow() }
        }
    }
}

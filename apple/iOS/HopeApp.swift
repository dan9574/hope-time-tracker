import HopeCore
import SwiftUI

@main
struct HopeApp: App {
    @State private var model = AppModel()
    @State private var watch = PhoneLink()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            TodayView()
                .environment(model)
                .environment(watch)
        }
        .onChange(of: scenePhase) { _, phase in
            // A full round whenever the app comes to the front (rebuild-plan 12.3).
            if phase == .active { model.sync.syncNow() }
        }
    }
}

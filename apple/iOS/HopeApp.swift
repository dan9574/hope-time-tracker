import HopeCore
import SwiftUI

@main
struct HopeApp: App {
    @State private var model: AppModel
    @State private var watch = PhoneLink()
    @State private var away: AwayMonitor
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let model = AppModel()
        _model = State(initialValue: model)
        // Made at launch: a geofence event or a notification action may start the app in the background.
        _away = State(initialValue: AwayMonitor(model: model))
    }

    var body: some Scene {
        WindowGroup {
            TodayView()
                .environment(model)
                .environment(watch)
                .environment(away)
                // The interface is colourless; colour belongs to activities (rebuild-plan 4.1).
                .tint(.primary)
        }
        .onChange(of: scenePhase) { _, phase in
            // A full round whenever the app comes to the front (rebuild-plan 12.3).
            if phase == .active {
                model.sync.syncNow()
                away.appActivated()
            }
        }
    }
}

import HopeCore
import SwiftUI
import WidgetKit

/// Keeps the watch-face complication current: after every committed change to the local store (a timer
/// action here, or a sync pull that changed data) it rewrites the shared snapshot and, if the face would
/// look different, asks WidgetKit to reload. In the launcher-only build (no App Group configured) it does
/// nothing and the complication just opens the app.
@MainActor
final class ComplicationPublisher {
    private let store: LocalStore
    private let file: WidgetSnapshotFile?
    private var last: WidgetSnapshot?
    private var observing = false

    init(store: LocalStore, file: WidgetSnapshotFile? = .fromBundle()) {
        self.store = store
        self.file = file
        last = file?.read()
    }

    /// Starts following the store; safe to call more than once.
    func start() {
        guard file != nil, !observing else { return }
        observing = true
        publish()
        observe()
    }

    /// Writes the current snapshot. Also called when the app becomes active, so a new day shows up.
    func publish() {
        guard let file else { return }
        let snapshot = store.widgetSnapshot()
        do {
            try file.write(snapshot)
        } catch {
            print("Hope: could not write the complication snapshot: \(error)")
            return
        }
        if let last, last.looksSame(as: snapshot) { return }
        last = snapshot
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func observe() {
        withObservationTracking {
            _ = store.revision
        } onChange: { [weak self] in
            // Called before the new value is set; publish on the next turn, then track again.
            Task { @MainActor in
                self?.publish()
                self?.observe()
            }
        }
    }
}

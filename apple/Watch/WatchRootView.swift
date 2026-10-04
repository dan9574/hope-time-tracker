import HopeCore
import SwiftUI

/// The running screen while a timer runs or is paused; otherwise the activity list (rebuild-plan 9.3).
struct WatchRootView: View {
    @Environment(AppModel.self) private var model
    @State private var path = NavigationPath()

    var body: some View {
        let _ = model.store.revision
        let timer = model.store.timerState()
        let session = timer.running ?? timer.paused
        NavigationStack(path: $path) {
            Group {
                if let session {
                    RunningView(session: session, running: timer.running != nil)
                } else {
                    ActivityListView(onPick: pick)
                }
            }
            .navigationDestination(for: ActivityNodeRoute.self) { route in
                if let node = model.store.activityTree().first(where: { $0.id == route.id }) {
                    ChildActivityList(node: node, onPick: pick)
                }
            }
            .navigationDestination(for: SwitchRoute.self) { _ in
                ActivityListView(onPick: pick)
            }
        }
        .onChange(of: session?.id) { path = NavigationPath() }
        .alert(
            "Something went wrong", isPresented: Binding(get: { model.failure != nil }, set: { if !$0 { model.failure = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: model.failure ?? "")
        }
    }

    /// Tap = start. Starting anything ends whatever is running.
    private func pick(_ activityId: String) {
        model.start(activityId)
        path = NavigationPath()
    }
}

/// Opens the list from the running screen to switch to another activity.
struct SwitchRoute: Hashable {}

struct ActivityListView: View {
    @Environment(AppModel.self) private var model
    var onPick: (String) -> Void
    @State private var showNew = false

    var body: some View {
        let _ = model.store.revision
        let tree = model.store.activityTree()
        let idle = model.store.timerState().running == nil
        List {
            if idle {
                TimelineView(.everyMinute) { context in
                    let total = model.store.todaySummary(now: Int64(context.date.timeIntervalSince1970 * 1000)).totalMs
                    VStack(alignment: .leading, spacing: 2) {
                        DurationText(ms: total, size: 30)
                        Text("Tracked today").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .listRowBackground(Color.clear)
            }
            if tree.isEmpty {
                Text("No activities yet").foregroundStyle(.secondary)
            }
            ActivityRows(tree: tree, onPick: onPick)
            Button { showNew = true } label: {
                Label("New Activity", systemImage: "plus")
            }
            .foregroundStyle(.secondary)
            SyncFooter()
                .listRowBackground(Color.clear)
        }
        .navigationTitle("Hope")
        .sheet(isPresented: $showNew) {
            NavigationStack {
                NewActivityView { name, color in model.createActivity(name: name, color: color) }
            }
        }
    }
}

/// One quiet line about sync; nothing at all in a build without a sync server.
private struct SyncFooter: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let sync = model.sync
        Group {
            switch sync.phase {
            case .notConfigured: EmptyView()
            case .signedOut: Text("Not signed in. Sign in on iPhone to sync.")
            case .syncing: Text("Syncing…")
            case .synced: Text(verbatim: sync.email ?? "")
            case .error: Text("Can't sync right now")
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}

/// Activity name, the elapsed time ticking in big monospaced digits, Pause / Stop (or Resume / Stop).
struct RunningView: View {
    @Environment(AppModel.self) private var model
    var session: SessionRecord
    var running: Bool

    var body: some View {
        let store = model.store
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                ActivityDot(color: store.color(activityId: session.activityId), size: 8)
                Text(verbatim: store.displayName(activityId: session.activityId) ?? String(localized: "Unknown activity"))
                    .font(.headline)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            TimelineView(.periodic(from: .now, by: 1)) { context in
                let now = Int64(context.date.timeIntervalSince1970 * 1000)
                Text(verbatim: DurationFormat.elapsed(store.chainDuration(endingWith: session, now: now)))
                    .font(.system(size: 44, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .foregroundStyle(running ? .primary : .secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !running {
                Text("Paused").font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Spacer(minLength: 0)

            HStack(spacing: 8) {
                if running {
                    Button { model.pause() } label: { Image(systemName: "pause.fill") }
                        .accessibilityLabel(Text("Pause"))
                } else {
                    Button { model.resume() } label: { Image(systemName: "play.fill") }
                        .accessibilityLabel(Text("Resume"))
                }
                Button { model.stop() } label: { Image(systemName: "stop.fill") }
                    .accessibilityLabel(Text("Stop"))
            }
            .font(.title3)
            .buttonStyle(.bordered)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: SwitchRoute()) { Image(systemName: "list.bullet") }
                    .accessibilityLabel(Text("Start Something Else"))
            }
        }
    }
}

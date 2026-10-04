import HopeCore
import SwiftUI
import WidgetKit

// The watch-face complication (rebuild-plan 9.3). It reads only the snapshot the watch app writes to the
// App Group container (HopeCore/WidgetSnapshot.swift) and never opens the SwiftData store. Running time
// is a system timer text, so the face ticks without timeline reloads. Tapping it opens the watch app.

@main
struct HopeComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "HopeComplication", provider: Provider()) { entry in
            ComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Hope")
        .description(
            WidgetSnapshotFile.fromBundle() == nil
                ? Text("Opens Hope.") : Text("The running timer, or what you tracked today."))
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

// MARK: - Timeline

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: .now, content: .snapshot(.empty(now: Self.ms(.now))))
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        if context.isPreview, WidgetSnapshotFile.fromBundle()?.read() == nil {
            completion(Entry(date: .now, content: .snapshot(Self.sample)))
        } else {
            completion(current().first!)
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // The app reloads timelines whenever the snapshot changes; nothing to poll for.
        completion(Timeline(entries: current(), policy: .never))
    }

    /// Now, plus local midnight when idle so today's total drops to zero on a new day.
    private func current() -> [Entry] {
        let now = Date.now
        guard let file = WidgetSnapshotFile.fromBundle() else { return [Entry(date: now, content: .launcher)] }
        let snapshot = file.read() ?? .empty(now: Self.ms(now))
        var entries = [Entry(date: now, content: .snapshot(snapshot))]
        let dayEnd = Date(timeIntervalSince1970: Double(snapshot.dayEndMs) / 1000)
        if snapshot.state == .idle, dayEnd > now {
            entries.append(Entry(date: dayEnd, content: .snapshot(snapshot)))
        }
        return entries
    }

    static func ms(_ date: Date) -> Int64 { epochMs(date) }

    /// For the face gallery before the app has written anything.
    static var sample: WidgetSnapshot {
        let now = ms(.now)
        var s = WidgetSnapshot.empty(now: now)
        s.state = .running
        s.parentName = String(localized: "Reading")
        s.color = .blue
        s.effectiveStartMs = now - 25 * 60_000
        return s
    }
}

// MARK: - Previews

#if DEBUG
private func sampleEntry(_ state: WidgetSnapshot.State) -> Entry {
    let now = Provider.ms(.now)
    var s = WidgetSnapshot.empty(now: now)
    s.state = state
    s.todayTotalMs = 135 * 60_000
    if state != .idle {
        s.parentName = "Study"
        s.childName = "Linear algebra"
        s.color = .purple
    }
    if state == .running { s.effectiveStartMs = now - 1_234_000 }
    if state == .paused { s.elapsedMs = 754_000 }
    return Entry(date: .now, content: .snapshot(s))
}

#Preview("Rectangular", as: .accessoryRectangular) {
    HopeComplication()
} timeline: {
    sampleEntry(.running)
    sampleEntry(.paused)
    sampleEntry(.idle)
    Entry(date: .now, content: .launcher)
}

#Preview("Circular", as: .accessoryCircular) {
    HopeComplication()
} timeline: {
    sampleEntry(.running)
    sampleEntry(.paused)
    sampleEntry(.idle)
    Entry(date: .now, content: .launcher)
}

#Preview("Inline", as: .accessoryInline) {
    HopeComplication()
} timeline: {
    sampleEntry(.running)
    sampleEntry(.paused)
    sampleEntry(.idle)
}

#Preview("Corner", as: .accessoryCorner) {
    HopeComplication()
} timeline: {
    sampleEntry(.running)
    sampleEntry(.paused)
    sampleEntry(.idle)
}
#endif

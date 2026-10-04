import HopeCore
import SwiftUI
import WidgetKit

// What the complication draws for each family and state. Kept apart from the widget and its timeline so
// the views depend only on an `Entry`.

struct Entry: TimelineEntry {
    enum Content {
        /// Launcher-only build: no shared container, nothing to show but the glyph.
        case launcher
        case snapshot(WidgetSnapshot)
    }

    var date: Date
    var content: Content
}

func epochMs(_ date: Date) -> Int64 { Int64(date.timeIntervalSince1970 * 1000) }

// MARK: - Views

struct ComplicationView: View {
    var entry: Entry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch entry.content {
        case .launcher:
            LauncherView(family: family)
        case .snapshot(let s):
            switch family {
            case .accessoryRectangular: RectangularView(snapshot: s, date: entry.date)
            case .accessoryInline: InlineView(snapshot: s, date: entry.date)
            case .accessoryCorner: CornerView(snapshot: s, date: entry.date)
            default: CircularView(snapshot: s, date: entry.date)
            }
        }
    }
}

/// The activity's palette colour in full-colour faces; in tinted faces the system tint (via
/// `widgetAccentable`), since colour there belongs to the face.
private struct Accent {
    var mode: WidgetRenderingMode
    var color: ActivityColor?

    var style: Color {
        mode == .fullColor ? (color ?? .blue).color : .primary
    }
}

/// The app icon's ring, drawn as a shape so it renders in every mode and size: a faint track and an
/// open arc from twelve o'clock.
struct HopeGlyph: View {
    var lineWidth: CGFloat
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        ZStack {
            Circle().stroke(.secondary.opacity(0.35), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: 0.7)
                .stroke(Accent(mode: mode, color: .blue).style, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .widgetAccentable()
        }
        .padding(lineWidth / 2)
        .accessibilityHidden(true)
    }
}

/// Counts up from the chain's effective start when running; frozen at the chain's time when paused.
/// Both are system timer texts, so running and paused look alike.
private func timerText(_ s: WidgetSnapshot, date: Date) -> Text {
    let nowMs = epochMs(date)
    switch s.state {
    case .running:
        let start = Date(timeIntervalSince1970: Double(s.effectiveStartMs ?? nowMs) / 1000)
        return Text(timerInterval: start...Date.distantFuture, countsDown: false)
    case .paused, .idle:
        let elapsed = Double(s.elapsedMs ?? 0) / 1000
        let start = date.addingTimeInterval(-elapsed)
        return Text(timerInterval: start...Date.distantFuture, pauseTime: date, countsDown: false)
    }
}

private func unitName(_ unit: DurationFormat.Unit) -> String {
    switch unit {
    case .hour: String(localized: "h", comment: "Hours unit, as in “2 h 15 min”")
    case .minute: String(localized: "min", comment: "Minutes unit, as in “2 h 15 min”")
    }
}

/// `45 min`, `2 h 15 min`, `3 h` (rebuild-plan 11.1).
private func duration(_ ms: Int64) -> String { DurationFormat.duration(ms, unitName: unitName) }

/// Big numbers, small secondary units (rebuild-plan 11.1).
private func durationText(_ ms: Int64, size: CGFloat) -> Text {
    DurationFormat.parts(ms).enumerated().reduce(Text(verbatim: "")) { text, item in
        let (i, part) = item
        let number = Text(verbatim: "\(i > 0 ? " " : "")\(part.value)")
            .font(.system(size: size, weight: .semibold, design: .rounded))
        let unit = Text(verbatim: "\(DurationFormat.unitSpace)\(unitName(part.unit))")
            .font(.system(size: size * 0.55, weight: .medium))
            .foregroundStyle(.secondary)
        return text + number + unit
    }
}

struct LauncherView: View {
    var family: WidgetFamily

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(verbatim: "Hope")
        case .accessoryRectangular:
            HStack(spacing: 8) {
                HopeGlyph(lineWidth: 4).frame(width: 30, height: 30)
                Text(verbatim: "Hope").font(.headline)
                Spacer(minLength: 0)
            }
        case .accessoryCorner:
            HopeGlyph(lineWidth: 4).padding(4)
        default:
            HopeGlyph(lineWidth: 5).padding(6)
        }
    }
}

struct CircularView: View {
    var snapshot: WidgetSnapshot
    var date: Date
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let s = snapshot
        let accent = Accent(mode: mode, color: s.color)
        ZStack {
            switch s.state {
            case .idle:
                HopeGlyph(lineWidth: 4)
                VStack(spacing: -2) {
                    ForEach(Array(DurationFormat.parts(s.todayTotalMs(at: epochMs(date))).enumerated()), id: \.offset) { _, part in
                        (Text(verbatim: "\(part.value)").font(.system(size: 15, weight: .semibold, design: .rounded))
                            + Text(verbatim: "\(DurationFormat.unitSpace)\(unitName(part.unit))").font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.secondary))
                            .monospacedDigit()
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(9)
            case .running, .paused:
                let running = s.state == .running
                Circle()
                    .stroke(accent.style.opacity(running ? 1 : 0.4), lineWidth: 4)
                    .padding(2)
                    .widgetAccentable()
                VStack(spacing: 0) {
                    if !running {
                        Image(systemName: "pause.fill").font(.system(size: 9)).foregroundStyle(.secondary)
                    }
                    timerText(s, date: date)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .multilineTextAlignment(.center)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .foregroundStyle(running ? .primary : .secondary)
                }
                .padding(.horizontal, 7)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct RectangularView: View {
    var snapshot: WidgetSnapshot
    var date: Date
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let s = snapshot
        VStack(alignment: .leading, spacing: 0) {
            switch s.state {
            case .idle:
                HStack(spacing: 5) {
                    HopeGlyph(lineWidth: 2).frame(width: 12, height: 12)
                    Text(verbatim: "Hope").font(.headline)
                }
                durationText(s.todayTotalMs(at: epochMs(date)), size: 26)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text("Tracked today").font(.footnote).foregroundStyle(.secondary)
            case .running, .paused:
                let running = s.state == .running
                HStack(spacing: 5) {
                    Circle().fill(Accent(mode: mode, color: s.color).style).frame(width: 8, height: 8)
                        .widgetAccentable()
                    ViewThatFits {
                        Text(verbatim: s.title ?? String(localized: "Unknown activity"))
                        Text(verbatim: s.shortTitle ?? String(localized: "Unknown activity"))
                    }
                    .font(.headline)
                    .lineLimit(1)
                }
                timerText(s, date: date)
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .foregroundStyle(running ? .primary : .secondary)
                if !running {
                    Text("Paused").font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct InlineView: View {
    var snapshot: WidgetSnapshot
    var date: Date

    var body: some View {
        let s = snapshot
        switch s.state {
        case .idle:
            Text(verbatim: "Hope · \(duration(s.todayTotalMs(at: epochMs(date))))")
        case .running:
            Text(verbatim: "\(s.shortTitle ?? "Hope") ") + timerText(s, date: date)
        case .paused:
            // Inline takes text and one image; the pause symbol says it is not running.
            Label {
                Text(verbatim: "\(s.shortTitle ?? "Hope") ") + timerText(s, date: date)
            } icon: {
                Image(systemName: "pause.fill")
            }
        }
    }
}

struct CornerView: View {
    var snapshot: WidgetSnapshot
    var date: Date
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let s = snapshot
        switch s.state {
        case .idle:
            HopeGlyph(lineWidth: 4)
                .padding(4)
                .widgetLabel { Text(verbatim: duration(s.todayTotalMs(at: epochMs(date)))) }
        case .running, .paused:
            let running = s.state == .running
            Image(systemName: running ? "timer" : "pause.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Accent(mode: mode, color: s.color).style)
                .widgetAccentable()
                .widgetLabel { timerText(s, date: date).monospacedDigit() }
        }
    }
}

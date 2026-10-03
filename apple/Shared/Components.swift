import HopeCore
import SwiftUI

// Small views both apps use. The interface stays colourless; colour only comes from activities.

enum Format {
    static func unitName(_ unit: DurationFormat.Unit) -> String {
        switch unit {
        case .hour: String(localized: "h", comment: "Hours unit, as in “2 h 15 min”")
        case .minute: String(localized: "min", comment: "Minutes unit, as in “2 h 15 min”")
        }
    }

    /// `45 min`, `2 h 15 min`, `3 h` (rebuild-plan 11.1).
    static func duration(_ ms: Int64) -> String {
        DurationFormat.duration(ms, unitName: unitName)
    }

    static func clock(_ ms: Int64) -> String {
        Date(timeIntervalSince1970: Double(ms) / 1000).formatted(date: .omitted, time: .shortened)
    }

    static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

/// A big duration: numbers at full size, units smaller and secondary (rebuild-plan 11.1).
struct DurationText: View {
    var ms: Int64
    var size: CGFloat

    var body: some View {
        DurationFormat.parts(ms).enumerated().reduce(Text(verbatim: "")) { text, item in
            let (i, part) = item
            let number = Text(verbatim: "\(i > 0 ? " " : "")\(part.value)")
                .font(.system(size: size, weight: .semibold, design: .rounded))
            let unit = Text(verbatim: "\(DurationFormat.unitSpace)\(Format.unitName(part.unit))")
                .font(.system(size: size * 0.42, weight: .medium))
                .foregroundStyle(.secondary)
            return text + number + unit
        }
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}

struct ActivityDot: View {
    var color: ActivityColor
    var size: CGFloat = 10

    var body: some View {
        Circle().fill(color.color).frame(width: size, height: size)
    }
}

/// One row of the activity picker.
struct ActivityLabel: View {
    var name: String
    var color: ActivityColor

    var body: some View {
        HStack(spacing: 10) {
            ActivityDot(color: color)
            Text(verbatim: name).lineLimit(2)
        }
    }
}

extension ActivityColor {
    var localizedName: String {
        switch self {
        case .blue: String(localized: "Blue")
        case .green: String(localized: "Green")
        case .orange: String(localized: "Orange")
        case .pink: String(localized: "Pink")
        case .purple: String(localized: "Purple")
        case .teal: String(localized: "Teal")
        case .yellow: String(localized: "Yellow")
        case .gray: String(localized: "Gray")
        }
    }
}

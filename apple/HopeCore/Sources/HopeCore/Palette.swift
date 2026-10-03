/// The fixed activity palette (rebuild-plan 4.3). Activities store the name; this is the only place the
/// colours are defined on Apple platforms. Must match `--activity-*` in src/styles/tokens.css.
public enum ActivityColor: String, CaseIterable, Sendable, Codable {
    case blue, green, orange, pink, purple, teal, yellow, gray

    /// sRGB components, 0–255.
    public var rgb: (red: UInt8, green: UInt8, blue: UInt8) {
        switch self {
        case .blue: (0x6A, 0xA9, 0xFF)
        case .green: (0x5F, 0xD3, 0x9A)
        case .orange: (0xFF, 0xAB, 0x6B)
        case .pink: (0xFF, 0x8F, 0xB8)
        case .purple: (0xB0, 0x8C, 0xFF)
        case .teal: (0x5C, 0xD0, 0xD0)
        case .yellow: (0xF5, 0xD5, 0x6A)
        case .gray: (0xA5, 0xA5, 0xAC)
        }
    }
}

#if canImport(SwiftUI)
import SwiftUI

extension ActivityColor {
    public var color: Color {
        let c = rgb
        return Color(.sRGB, red: Double(c.red) / 255, green: Double(c.green) / 255, blue: Double(c.blue) / 255)
    }
}
#endif

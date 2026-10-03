/// Duration formats (rebuild-plan 11.1). Units are localized by the app, so this file has no strings.
public enum DurationFormat {
    public enum Unit: Sendable { case hour, minute }

    public struct Part: Equatable, Sendable {
        public var value: Int64
        public var unit: Unit
    }

    /// Narrow no-break space between a number and its unit.
    public static let unitSpace = "\u{202F}"

    /// `[2 h][15 min]`, `[3 h]` or `[45 min]`; under a minute is `[0 min]`. No decimals, no colons.
    public static func parts(_ ms: Int64) -> [Part] {
        let minutes = max(0, ms) / 60_000
        let h = minutes / 60
        let m = minutes % 60
        var parts: [Part] = []
        if h > 0 { parts.append(Part(value: h, unit: .hour)) }
        if m > 0 || h == 0 { parts.append(Part(value: m, unit: .minute)) }
        return parts
    }

    /// `45 min`, `2 h 15 min`, `3 h` with the given unit names (English `h` / `min`, Chinese `小时` / `分钟`).
    public static func duration(_ ms: Int64, unitName: (Unit) -> String) -> String {
        parts(ms).map { "\($0.value)\(unitSpace)\(unitName($0.unit))" }.joined(separator: " ")
    }

    /// Only for a running timer: `MM:SS`, or `H:MM:SS` from one hour on.
    public static func elapsed(_ ms: Int64) -> String {
        let seconds = max(0, ms) / 1000
        let h = seconds / 3600
        let mm = (seconds / 60) % 60
        let ss = seconds % 60
        let two = { (v: Int64) in v < 10 ? "0\(v)" : "\(v)" }
        return h > 0 ? "\(h):\(two(mm)):\(two(ss))" : "\(two(mm)):\(two(ss))"
    }
}

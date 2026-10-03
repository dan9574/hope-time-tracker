import Foundation

/// One JSON scalar, as PostgREST reads and writes column values.
public enum JSONValue: Sendable, Equatable, Codable, CustomStringConvertible {
    case null
    case int(Int64)
    case double(Double)
    case bool(Bool)
    case string(String)
    /// An array or object. Never valid in a row; kept so one odd column fails that row, not the whole response.
    case unsupported

    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let v = try? c.decode(Int64.self) {
            self = .int(v)
        } else if let v = try? c.decode(Double.self) {
            self = .double(v)
        } else if let v = try? c.decode(Bool.self) {
            self = .bool(v)
        } else if let v = try? c.decode(String.self) {
            self = .string(v)
        } else {
            self = .unsupported
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null, .unsupported: try c.encodeNil()
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        }
    }

    public var description: String {
        switch self {
        case .null: "null"
        case .int(let v): String(v)
        case .double(let v): String(v)
        case .bool(let v): String(v)
        case .string(let v): "\"\(v)\""
        case .unsupported: "<unsupported>"
        }
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByNilLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int64) { self = .int(value) }
    public init(nilLiteral: ()) { self = .null }
}

extension JSONValue {
    public init(_ value: String?) { self = value.map(JSONValue.string) ?? .null }
    public init(_ value: Int64?) { self = value.map(JSONValue.int) ?? .null }

    /// Integers may arrive as integral doubles or (for 0 / 1 flags) booleans.
    var int: Int64? {
        switch self {
        case .int(let v): v
        case .double(let v) where v.rounded() == v && abs(v) < 9.0e15: Int64(v)
        case .bool(let v): v ? 1 : 0
        default: nil
        }
    }

    var string: String? {
        if case .string(let s) = self { return s }
        return nil
    }
}

/// A row keyed by column name, exactly as PostgREST reads and writes it.
public typealias Row = [String: JSONValue]

extension Dictionary where Key == String, Value == JSONValue {
    /// A required text column.
    func text(_ column: String) throws -> String {
        guard let s = self[column]?.string else { throw SyncError.decode("missing text column \(column)") }
        return s
    }

    /// A nullable text column; absent means null.
    func optionalText(_ column: String) throws -> String? {
        switch self[column] ?? .null {
        case .null: return nil
        case .string(let s): return s
        default: throw SyncError.decode("column \(column) is not text")
        }
    }

    /// A required integer column.
    func integer(_ column: String) throws -> Int64 {
        guard let v = self[column]?.int else { throw SyncError.decode("missing integer column \(column)") }
        return v
    }

    /// A nullable integer column; absent means null.
    func optionalInteger(_ column: String) throws -> Int64? {
        let v = self[column] ?? .null
        if v == .null { return nil }
        guard let i = v.int else { throw SyncError.decode("column \(column) is not an integer") }
        return i
    }
}

import Foundation
import SwiftData

// The five synced tables of rebuild-plan 3.1 / 10.0 plus the device-local `setting` table, as SwiftData models.
// Times are Unix epoch milliseconds; dates are 'YYYY-MM-DD'; clock times are 'HH:MM'. No relationships:
// rows may arrive in any order, so references are plain ids, exactly like the SQLite schema.
// `dirty` = a local change the server has not acknowledged yet (rebuild-plan 12.2).

/// What the sync engine needs from every synced model.
protocol SyncedRecord: PersistentModel {
    static var table: SyncTable { get }
    var key: String { get }
    var updatedMs: Int64 { get set }
    var deviceId: String { get set }
    var dirty: Bool { get set }
    /// A detached instance built from a server row. Throws if a required column is missing or malformed.
    static func decode(_ row: Row) throws -> Self
    /// Copies every synced column from `other`.
    func assign(from other: Self)
    /// Every synced column, as PostgREST expects it.
    func row() -> Row
    static func find(_ key: String, in context: ModelContext) throws -> Self?
    static func dirtyRecords(in context: ModelContext) throws -> [Self]
}

@Model
public final class ActivityRecord {
    @Attribute(.unique) public var id: String
    public var name: String
    /// One of the eight palette names; children store (and always show) their parent's.
    public var color: String
    public var symbol: String?
    public var sort: Int64
    public var archivedAt: Int64?
    /// `nil` = top level. One level only.
    public var parentId: String?
    /// `nil` = ordinary, `schedule` = the schedule (classes) group (rebuild-plan 13.1), `exercise` = exercise,
    /// which gets no "you walked away" reminders (rebuild-plan 14.1). Top level only; children follow.
    public var kind: String?
    public var updatedMs: Int64
    public var deletedMs: Int64?
    public var deviceId: String
    public var dirty: Bool

    public init(
        id: String, name: String, color: String, symbol: String? = nil, sort: Int64 = 0, archivedAt: Int64? = nil,
        parentId: String? = nil, kind: String? = nil, updatedMs: Int64, deletedMs: Int64? = nil, deviceId: String,
        dirty: Bool = true
    ) {
        self.id = id
        self.name = name
        self.color = color
        self.symbol = symbol
        self.sort = sort
        self.archivedAt = archivedAt
        self.parentId = parentId
        self.kind = kind
        self.updatedMs = updatedMs
        self.deletedMs = deletedMs
        self.deviceId = deviceId
        self.dirty = dirty
    }

    public var palette: ActivityColor { ActivityColor(rawValue: color) ?? .gray }

    /// The `kind` of the schedule group.
    public static let scheduleKind = "schedule"
    /// The `kind` of an exercise activity.
    public static let exerciseKind = "exercise"

    public var isScheduleGroup: Bool { kind == Self.scheduleKind }
    public var isExercise: Bool { kind == Self.exerciseKind }
}

@Model
public final class SessionRecord {
    @Attribute(.unique) public var id: String
    public var activityId: String
    public var startMs: Int64
    /// `nil` while running.
    public var endMs: Int64?
    public var note: String?
    /// The session this one resumes after a pause.
    public var continuesId: String?
    /// Set when logged automatically from a recurring plan.
    public var planId: String?
    /// When the user last chose "Keep Going" on a break reminder while this segment ran (rebuild-plan 15.1).
    public var breakAckMs: Int64?
    public var updatedMs: Int64
    public var deletedMs: Int64?
    public var deviceId: String
    public var dirty: Bool

    public init(
        id: String, activityId: String, startMs: Int64, endMs: Int64? = nil, note: String? = nil,
        continuesId: String? = nil, planId: String? = nil, breakAckMs: Int64? = nil, updatedMs: Int64,
        deletedMs: Int64? = nil, deviceId: String, dirty: Bool = true
    ) {
        self.id = id
        self.activityId = activityId
        self.startMs = startMs
        self.endMs = endMs
        self.note = note
        self.continuesId = continuesId
        self.planId = planId
        self.breakAckMs = breakAckMs
        self.updatedMs = updatedMs
        self.deletedMs = deletedMs
        self.deviceId = deviceId
        self.dirty = dirty
    }
}

@Model
public final class PlanRecord {
    @Attribute(.unique) public var id: String
    public var activityId: String
    public var date: String
    public var startHm: String
    public var endHm: String
    /// `nil` = one-off, `weekly:1,3,5` = weekly (ISO weekdays).
    public var rule: String?
    /// 0 / 1, as in SQLite and on the server.
    public var autoLog: Int64
    public var until: String?
    /// Dates a recurring plan does not occur on, `YYYY-MM-DD,YYYY-MM-DD` (sorted, no duplicates); `nil` = none.
    public var skipDates: String?
    public var updatedMs: Int64
    public var deletedMs: Int64?
    public var deviceId: String
    public var dirty: Bool

    public init(
        id: String, activityId: String, date: String, startHm: String, endHm: String, rule: String? = nil,
        autoLog: Int64 = 1, until: String? = nil, skipDates: String? = nil, updatedMs: Int64, deletedMs: Int64? = nil,
        deviceId: String, dirty: Bool = true
    ) {
        self.id = id
        self.activityId = activityId
        self.date = date
        self.startHm = startHm
        self.endHm = endHm
        self.rule = rule
        self.autoLog = autoLog
        self.until = until
        self.skipDates = skipDates
        self.updatedMs = updatedMs
        self.deletedMs = deletedMs
        self.deviceId = deviceId
        self.dirty = dirty
    }
}

@Model
public final class JournalRecord {
    @Attribute(.unique) public var id: String
    public var date: String
    public var text: String
    public var updatedMs: Int64
    public var deletedMs: Int64?
    public var deviceId: String
    public var dirty: Bool

    public init(id: String, date: String, text: String, updatedMs: Int64, deletedMs: Int64? = nil, deviceId: String, dirty: Bool = true) {
        self.id = id
        self.date = date
        self.text = text
        self.updatedMs = updatedMs
        self.deletedMs = deletedMs
        self.deviceId = deviceId
        self.dirty = dirty
    }
}

@Model
public final class DayRecord {
    /// Local date of the wake-up, the primary key.
    @Attribute(.unique) public var date: String
    public var wakeMs: Int64?
    public var sleepMs: Int64?
    public var utcOffsetMin: Int64
    public var updatedMs: Int64
    public var deletedMs: Int64?
    public var deviceId: String
    public var dirty: Bool

    public init(
        date: String, wakeMs: Int64? = nil, sleepMs: Int64? = nil, utcOffsetMin: Int64, updatedMs: Int64,
        deletedMs: Int64? = nil, deviceId: String, dirty: Bool = true
    ) {
        self.date = date
        self.wakeMs = wakeMs
        self.sleepMs = sleepMs
        self.utcOffsetMin = utcOffsetMin
        self.updatedMs = updatedMs
        self.deletedMs = deletedMs
        self.deviceId = deviceId
        self.dirty = dirty
    }
}

/// Device-local key/value pairs; never synced (rebuild-plan 3.1 `setting`).
@Model
final class SettingRecord {
    @Attribute(.unique) var key: String
    var value: String

    init(key: String, value: String) {
        self.key = key
        self.value = value
    }
}

// MARK: - Sync glue

extension ActivityRecord: SyncedRecord {
    static var table: SyncTable { .activity }
    var key: String { id }

    static func decode(_ r: Row) throws -> ActivityRecord {
        let color = try r.text("color")
        // Local CHECK constraint (rebuild-plan 3.1): anything outside the palette is rejected.
        guard ActivityColor(rawValue: color) != nil else { throw SyncError.decode("unknown activity color \(color)") }
        return ActivityRecord(
            id: try r.text("id"), name: try r.text("name"), color: color, symbol: try r.optionalText("symbol"),
            sort: try r.optionalInteger("sort") ?? 0, archivedAt: try r.optionalInteger("archived_at"),
            parentId: try r.optionalText("parent_id"), kind: try r.optionalText("kind"),
            updatedMs: try r.integer("updated_ms"),
            deletedMs: try r.optionalInteger("deleted_ms"), deviceId: try r.text("device_id"), dirty: false)
    }

    func assign(from o: ActivityRecord) {
        name = o.name
        color = o.color
        symbol = o.symbol
        sort = o.sort
        archivedAt = o.archivedAt
        parentId = o.parentId
        kind = o.kind
        updatedMs = o.updatedMs
        deletedMs = o.deletedMs
        deviceId = o.deviceId
    }

    func row() -> Row {
        [
            "id": .string(id), "name": .string(name), "color": .string(color), "symbol": JSONValue(symbol),
            "sort": .int(sort), "archived_at": JSONValue(archivedAt), "parent_id": JSONValue(parentId),
            "kind": JSONValue(kind), "updated_ms": .int(updatedMs), "deleted_ms": JSONValue(deletedMs), "device_id": .string(deviceId),
        ]
    }

    static func find(_ key: String, in context: ModelContext) throws -> ActivityRecord? {
        var d = FetchDescriptor<ActivityRecord>(predicate: #Predicate { $0.id == key })
        d.fetchLimit = 1
        return try context.fetch(d).first
    }

    static func dirtyRecords(in context: ModelContext) throws -> [ActivityRecord] {
        try context.fetch(FetchDescriptor<ActivityRecord>(predicate: #Predicate { $0.dirty }, sortBy: [SortDescriptor(\.id)]))
    }
}

extension SessionRecord: SyncedRecord {
    static var table: SyncTable { .session }
    var key: String { id }

    static func decode(_ r: Row) throws -> SessionRecord {
        let start = try r.integer("start_ms")
        let end = try r.optionalInteger("end_ms")
        if let end, end < start { throw SyncError.decode("session ends before it starts") }
        return SessionRecord(
            id: try r.text("id"), activityId: try r.text("activity_id"), startMs: start, endMs: end,
            note: try r.optionalText("note"), continuesId: try r.optionalText("continues_id"),
            planId: try r.optionalText("plan_id"), breakAckMs: try r.optionalInteger("break_ack_ms"),
            updatedMs: try r.integer("updated_ms"), deletedMs: try r.optionalInteger("deleted_ms"),
            deviceId: try r.text("device_id"), dirty: false)
    }

    func assign(from o: SessionRecord) {
        activityId = o.activityId
        startMs = o.startMs
        endMs = o.endMs
        note = o.note
        continuesId = o.continuesId
        planId = o.planId
        breakAckMs = o.breakAckMs
        updatedMs = o.updatedMs
        deletedMs = o.deletedMs
        deviceId = o.deviceId
    }

    func row() -> Row {
        [
            "id": .string(id), "activity_id": .string(activityId), "start_ms": .int(startMs), "end_ms": JSONValue(endMs),
            "note": JSONValue(note), "continues_id": JSONValue(continuesId), "plan_id": JSONValue(planId),
            "break_ack_ms": JSONValue(breakAckMs), "updated_ms": .int(updatedMs), "deleted_ms": JSONValue(deletedMs),
            "device_id": .string(deviceId),
        ]
    }

    static func find(_ key: String, in context: ModelContext) throws -> SessionRecord? {
        var d = FetchDescriptor<SessionRecord>(predicate: #Predicate { $0.id == key })
        d.fetchLimit = 1
        return try context.fetch(d).first
    }

    static func dirtyRecords(in context: ModelContext) throws -> [SessionRecord] {
        try context.fetch(FetchDescriptor<SessionRecord>(predicate: #Predicate { $0.dirty }, sortBy: [SortDescriptor(\.id)]))
    }
}

extension PlanRecord: SyncedRecord {
    static var table: SyncTable { .plan }
    var key: String { id }

    static func decode(_ r: Row) throws -> PlanRecord {
        PlanRecord(
            id: try r.text("id"), activityId: try r.text("activity_id"), date: try r.text("date"),
            startHm: try r.text("start_hm"), endHm: try r.text("end_hm"), rule: try r.optionalText("rule"),
            autoLog: try r.optionalInteger("auto_log") ?? 1, until: try r.optionalText("until"),
            skipDates: try r.optionalText("skip_dates"), updatedMs: try r.integer("updated_ms"), deletedMs: try r.optionalInteger("deleted_ms"),
            deviceId: try r.text("device_id"), dirty: false)
    }

    func assign(from o: PlanRecord) {
        activityId = o.activityId
        date = o.date
        startHm = o.startHm
        endHm = o.endHm
        rule = o.rule
        autoLog = o.autoLog
        until = o.until
        skipDates = o.skipDates
        updatedMs = o.updatedMs
        deletedMs = o.deletedMs
        deviceId = o.deviceId
    }

    func row() -> Row {
        [
            "id": .string(id), "activity_id": .string(activityId), "date": .string(date), "start_hm": .string(startHm),
            "end_hm": .string(endHm), "rule": JSONValue(rule), "auto_log": .int(autoLog), "until": JSONValue(until),
            "skip_dates": JSONValue(skipDates), "updated_ms": .int(updatedMs), "deleted_ms": JSONValue(deletedMs), "device_id": .string(deviceId),
        ]
    }

    static func find(_ key: String, in context: ModelContext) throws -> PlanRecord? {
        var d = FetchDescriptor<PlanRecord>(predicate: #Predicate { $0.id == key })
        d.fetchLimit = 1
        return try context.fetch(d).first
    }

    static func dirtyRecords(in context: ModelContext) throws -> [PlanRecord] {
        try context.fetch(FetchDescriptor<PlanRecord>(predicate: #Predicate { $0.dirty }, sortBy: [SortDescriptor(\.id)]))
    }
}

extension JournalRecord: SyncedRecord {
    static var table: SyncTable { .journal }
    var key: String { id }

    static func decode(_ r: Row) throws -> JournalRecord {
        JournalRecord(
            id: try r.text("id"), date: try r.text("date"), text: try r.text("text"),
            updatedMs: try r.integer("updated_ms"), deletedMs: try r.optionalInteger("deleted_ms"),
            deviceId: try r.text("device_id"), dirty: false)
    }

    func assign(from o: JournalRecord) {
        date = o.date
        text = o.text
        updatedMs = o.updatedMs
        deletedMs = o.deletedMs
        deviceId = o.deviceId
    }

    func row() -> Row {
        [
            "id": .string(id), "date": .string(date), "text": .string(text), "updated_ms": .int(updatedMs),
            "deleted_ms": JSONValue(deletedMs), "device_id": .string(deviceId),
        ]
    }

    static func find(_ key: String, in context: ModelContext) throws -> JournalRecord? {
        var d = FetchDescriptor<JournalRecord>(predicate: #Predicate { $0.id == key })
        d.fetchLimit = 1
        return try context.fetch(d).first
    }

    static func dirtyRecords(in context: ModelContext) throws -> [JournalRecord] {
        try context.fetch(FetchDescriptor<JournalRecord>(predicate: #Predicate { $0.dirty }, sortBy: [SortDescriptor(\.id)]))
    }
}

extension DayRecord: SyncedRecord {
    static var table: SyncTable { .day }
    var key: String { date }

    static func decode(_ r: Row) throws -> DayRecord {
        DayRecord(
            date: try r.text("date"), wakeMs: try r.optionalInteger("wake_ms"), sleepMs: try r.optionalInteger("sleep_ms"),
            utcOffsetMin: try r.integer("utc_offset_min"), updatedMs: try r.integer("updated_ms"),
            deletedMs: try r.optionalInteger("deleted_ms"), deviceId: try r.text("device_id"), dirty: false)
    }

    func assign(from o: DayRecord) {
        wakeMs = o.wakeMs
        sleepMs = o.sleepMs
        utcOffsetMin = o.utcOffsetMin
        updatedMs = o.updatedMs
        deletedMs = o.deletedMs
        deviceId = o.deviceId
    }

    func row() -> Row {
        [
            "date": .string(date), "wake_ms": JSONValue(wakeMs), "sleep_ms": JSONValue(sleepMs),
            "utc_offset_min": .int(utcOffsetMin), "updated_ms": .int(updatedMs), "deleted_ms": JSONValue(deletedMs),
            "device_id": .string(deviceId),
        ]
    }

    static func find(_ key: String, in context: ModelContext) throws -> DayRecord? {
        var d = FetchDescriptor<DayRecord>(predicate: #Predicate { $0.date == key })
        d.fetchLimit = 1
        return try context.fetch(d).first
    }

    static func dirtyRecords(in context: ModelContext) throws -> [DayRecord] {
        try context.fetch(FetchDescriptor<DayRecord>(predicate: #Predicate { $0.dirty }, sortBy: [SortDescriptor(\.date)]))
    }
}

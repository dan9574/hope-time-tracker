// Minimal iCalendar (.ics) parser for the schedule import (rebuild-plan 13.2).
//
// Pure and import-free so it can be unit-tested with plain Node. It understands
// only the subset described in 13.2: VEVENT with UID / SUMMARY / DTSTART /
// DTEND or DURATION / RRULE (FREQ=WEEKLY) / EXDATE / RECURRENCE-ID. Everything
// else is either ignored (unknown properties) or reported in `skipped`.

export interface IcsCourse {
  /** Stable key for deterministic ids: the event UID, or merged UIDs sorted and joined with "|". */
  sourceKey: string;
  summary: string;
  /** Section code / exam suffix stripped (13.2 rules); the user may edit it. */
  suggestedName: string;
  /** ISO weekdays 1–7 for recurring courses; empty for one-off events. */
  days: number[];
  startHm: string; // "HH:MM" local
  endHm: string;
  /** First day (recurring) or the day (one-off), "YYYY-MM-DD" local. */
  date: string;
  /** Last day inclusive for recurring; null = no end. Null for one-off. */
  until: string | null;
  skipDates: string[];
}

export interface IcsSkipped {
  summary: string;
  reason: "unsupported-rule" | "all-day" | "recurrence-id" | "no-time" | "interval";
}

export interface IcsParseResult {
  calendarName: string | null; // X-WR-CALNAME
  courses: IcsCourse[];
  skipped: IcsSkipped[];
  /** Set when some event's TZID differs from `localTimeZone`; the IANA name of the file's zone. */
  foreignTimeZone: string | null;
}

export interface IcsParseOptions {
  /** IANA zone the plans are expressed in. Defaults to the system zone. */
  localTimeZone?: string;
  /** Reserved for callers that want a reference instant; the parser itself is time-independent. */
  now?: Date;
}

const DAY_MS = 86_400_000;
const WEEKDAY_CODES: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
/** RRULE parts we understand; anything else makes the rule unsupported. */
const RRULE_KEYS = new Set(["FREQ", "INTERVAL", "BYDAY", "UNTIL", "COUNT", "WKST"]);

const EXAM_SUFFIX = /\s*(期末考试|期中考试|Final(?: Exam)?|Midterm)$/i;
const SECTION_SUFFIX = /\s*-\s*[A-Z]{2}\d?$/;

/** Strip a trailing exam suffix, then a trailing section code ("CSE 101-LE Final" → "CSE 101"). */
export function suggestName(summary: string): string {
  const trimmed = summary.trim();
  const stripped = trimmed.replace(EXAM_SUFFIX, "").replace(SECTION_SUFFIX, "").trim();
  return stripped === "" ? trimmed : stripped;
}

// ---------------------------------------------------------------------------
// Content lines

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

/** Split `s` on `sep`, ignoring separators inside double quotes. */
function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (c === sep && !quoted) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

function parseLine(line: string): Prop | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [rawName = "", ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).replace(/^"(.*)"$/, "$1");
  }
  return { name: rawName.trim().toUpperCase(), params, value: line.slice(colon + 1) };
}

/** TEXT value unescaping: `\,` `\;` `\n` `\N` `\\`. */
function unescapeText(value: string): string {
  return value.replace(/\\([\\,;nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

// ---------------------------------------------------------------------------
// Calendar arithmetic. A "day number" is days since 1970-01-01; wall-clock
// times are handled as naive UTC milliseconds so no zone leaks in.

interface Wall {
  day: number; // day number
  sec: number; // seconds since midnight
}

function dayNumber(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function dateString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(day: number): number {
  // 1970-01-01 was a Thursday (ISO 4).
  return ((((day + 3) % 7) + 7) % 7) + 1;
}

function shiftWeekday(weekday: number, delta: number): number {
  return ((((weekday - 1 + delta) % 7) + 7) % 7) + 1;
}

function wallToNaive(w: Wall): number {
  return w.day * DAY_MS + w.sec * 1000;
}

function naiveToWall(ms: number): Wall {
  const day = Math.floor(ms / DAY_MS);
  return { day, sec: Math.floor((ms - day * DAY_MS) / 1000) };
}

function hm(w: Wall): string {
  const minutes = Math.floor(w.sec / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Time zones via Intl.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** Canonical IANA name, or null when the runtime does not know the zone. */
function canonicalZone(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Wall clock in `zone` at instant `epochMs`. */
function epochToWall(epochMs: number, zone: string): Wall {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(zone).formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const day = dayNumber(parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1);
  const sec = ((parts.hour ?? 0) % 24) * 3600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0);
  return { day, sec };
}

/**
 * Instant at which the wall clock in `zone` reads `w`. On a DST overlap the earlier
 * instant wins; inside a DST gap the pre-transition offset is used (02:30 → 03:30).
 */
function wallToEpoch(w: Wall, zone: string): number {
  const naive = wallToNaive(w);
  const offsetAt = (epoch: number) => wallToNaive(epochToWall(epoch, zone)) - epoch;
  // The two offsets in effect around `naive` (they differ only near a transition).
  const offsets = [offsetAt(naive - DAY_MS), offsetAt(naive + DAY_MS)];
  const candidates = offsets.map((o) => naive - o).sort((a, b) => a - b);
  const exact = candidates.find((c) => offsetAt(c) === naive - c);
  return exact ?? naive - (offsets[0] ?? 0);
}

// ---------------------------------------------------------------------------
// Date-time values

interface IcsTime {
  wall: Wall;
  dateOnly: boolean;
  /** Canonical zone: "UTC" for `Z`, the TZID if the runtime knows it, null for floating. */
  zone: string | null;
  /** True when the zone came from a TZID parameter (as opposed to `Z`). */
  fromTzid: boolean;
}

function parseIcsTime(value: string, params: Record<string, string>): IcsTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const day = dayNumber(Number(m[1]), Number(m[2]), Number(m[3]));
  const dateOnly = m[4] === undefined || params.VALUE?.toUpperCase() === "DATE";
  const sec = dateOnly ? 0 : Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] ?? 0);
  if (m[7]) return { wall: { day, sec }, dateOnly, zone: "UTC", fromTzid: false };
  // Unknown TZIDs (e.g. Windows names) are treated as floating times.
  const zone = params.TZID ? canonicalZone(params.TZID) : null;
  return { wall: { day, sec }, dateOnly, zone, fromTzid: zone !== null };
}

/** Wall clock of `t` in `zone`, or in its own terms when either side is floating. */
function wallIn(t: IcsTime, zone: string | null): Wall {
  if (t.dateOnly || t.zone === null || zone === null || t.zone === zone) return t.wall;
  return epochToWall(wallToEpoch(t.wall, t.zone), zone);
}

/** RFC 5545 duration (`PnW` or `PnDTnHnMnS`) in milliseconds, or null if malformed / negative. */
function parseDuration(value: string): number | null {
  const m = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m || value.trim() === "P" || value.trim().endsWith("T")) return null;
  const [w, d, h, min, s] = [m[1], m[2], m[3], m[4], m[5]].map((x) => Number(x ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return ((((w * 7 + d) * 24 + h) * 60 + min) * 60 + s) * 1000;
}

// ---------------------------------------------------------------------------
// Events

interface RawEvent {
  props: Prop[];
}

function first(ev: RawEvent, name: string): Prop | undefined {
  return ev.props.find((p) => p.name === name);
}

function all(ev: RawEvent, name: string): Prop[] {
  return ev.props.filter((p) => p.name === name);
}

/** A non-recurring event already converted to the local zone. */
interface Single {
  uid: string;
  summary: string;
  day: number;
  startHm: string;
  endHm: string;
}

type EventOutcome =
  | { kind: "course"; course: IcsCourse; foreign: string | null }
  | { kind: "single"; single: Single; foreign: string | null }
  | { kind: "skip"; reason: IcsSkipped["reason"] };

function readEvent(ev: RawEvent, localZone: string): EventOutcome {
  if (first(ev, "RECURRENCE-ID")) return { kind: "skip", reason: "recurrence-id" };

  const dtstartProp = first(ev, "DTSTART");
  const start = dtstartProp ? parseIcsTime(dtstartProp.value, dtstartProp.params) : null;
  if (!start) return { kind: "skip", reason: "no-time" };
  if (start.dateOnly) return { kind: "skip", reason: "all-day" };

  // Duration as wall-clock difference when both ends share a zone, so "09:00–09:50" stays 50 min.
  let durationMs: number | null = null;
  const dtendProp = first(ev, "DTEND");
  const durationProp = first(ev, "DURATION");
  if (dtendProp) {
    const end = parseIcsTime(dtendProp.value, dtendProp.params);
    if (end && !end.dateOnly) {
      durationMs =
        end.zone === start.zone || end.zone === null || start.zone === null
          ? wallToNaive(end.wall) - wallToNaive(start.wall)
          : wallToEpoch(end.wall, end.zone) - wallToEpoch(start.wall, start.zone);
    }
  } else if (durationProp) {
    durationMs = parseDuration(durationProp.value);
  }
  if (durationMs === null || durationMs < 0) return { kind: "skip", reason: "no-time" };

  // Event zone; floating events (zone null) are taken as-is.
  const eventZone = start.zone;
  const converts = eventZone !== null && eventZone !== localZone;
  const foreign = converts && start.fromTzid ? eventZone : null;
  /** Local wall clock of the event-zone wall clock `w`. */
  const toLocal = (w: Wall): Wall => (converts && eventZone ? epochToWall(wallToEpoch(w, eventZone), localZone) : w);
  /** Date (day number) in the event's own zone of the time `t`; floating events use the local zone. */
  const eventDay = (t: IcsTime): number => wallIn(t, eventZone ?? localZone).day;

  const uidProp = first(ev, "UID");
  const summary = unescapeText(first(ev, "SUMMARY")?.value ?? "").trim();
  const uid = uidProp ? unescapeText(uidProp.value).trim() : `nouid:${summary}|${dtstartProp?.value ?? ""}`;

  const rrules = all(ev, "RRULE");
  if (rrules.length === 0) {
    if (first(ev, "RDATE")) return { kind: "skip", reason: "unsupported-rule" };
    const localStart = toLocal(start.wall);
    const localEnd = naiveToWall(wallToNaive(localStart) + durationMs);
    return {
      kind: "single",
      single: { uid, summary, day: localStart.day, startHm: hm(localStart), endHm: hm(localEnd) },
      foreign,
    };
  }
  if (rrules.length > 1 || first(ev, "RDATE")) return { kind: "skip", reason: "unsupported-rule" };

  // RRULE
  const rule: Record<string, string> = {};
  for (const part of (rrules[0]?.value ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) rule[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
  }
  if (rule.FREQ?.toUpperCase() !== "WEEKLY") return { kind: "skip", reason: "unsupported-rule" };
  if (Object.keys(rule).some((k) => !RRULE_KEYS.has(k))) return { kind: "skip", reason: "unsupported-rule" };
  if (rule.INTERVAL !== undefined) {
    if (!/^\d+$/.test(rule.INTERVAL) || Number(rule.INTERVAL) < 1) return { kind: "skip", reason: "unsupported-rule" };
    if (Number(rule.INTERVAL) !== 1) return { kind: "skip", reason: "interval" };
  }

  // Weekdays in the event's own zone.
  let sourceDays: number[];
  if (rule.BYDAY !== undefined) {
    sourceDays = [];
    for (const code of rule.BYDAY.split(",")) {
      const d = WEEKDAY_CODES[code.trim().toUpperCase()];
      if (d === undefined) return { kind: "skip", reason: "unsupported-rule" }; // ordinals like "1MO", typos
      sourceDays.push(d);
    }
  } else {
    sourceDays = [weekdayOf(start.wall.day)];
  }
  const daySet = new Set(sourceDays);
  let firstDay = start.wall.day;
  while (!daySet.has(weekdayOf(firstDay))) firstDay++;

  // Last day (event zone), inclusive.
  let lastDay: number | null = null;
  if (rule.UNTIL !== undefined) {
    const until = parseIcsTime(rule.UNTIL, eventZone && !rule.UNTIL.endsWith("Z") ? { TZID: eventZone } : {});
    if (!until) return { kind: "skip", reason: "unsupported-rule" };
    if (until.dateOnly) lastDay = until.wall.day;
    else {
      const w = wallIn(until, eventZone ?? localZone);
      // UNTIL bounds the start instant: an UNTIL earlier in the day than DTSTART excludes that day.
      lastDay = w.sec < start.wall.sec ? w.day - 1 : w.day;
    }
  }
  if (rule.COUNT !== undefined) {
    if (!/^\d+$/.test(rule.COUNT) || Number(rule.COUNT) < 1) return { kind: "skip", reason: "unsupported-rule" };
    let remaining = Number(rule.COUNT);
    let day = firstDay;
    for (;;) {
      if (daySet.has(weekdayOf(day)) && --remaining === 0) break;
      day++;
    }
    lastDay = lastDay === null ? day : Math.min(lastDay, day);
  }
  if (lastDay !== null && lastDay < firstDay) return { kind: "skip", reason: "unsupported-rule" };

  // Convert the first occurrence; the whole series shifts by the same number of days.
  const localStart = toLocal({ day: firstDay, sec: start.wall.sec });
  const localEnd = naiveToWall(wallToNaive(localStart) + durationMs);
  const delta = localStart.day - firstDay;
  const days = [...new Set(sourceDays.map((d) => shiftWeekday(d, delta)))].sort((a, b) => a - b);
  const localLast = lastDay === null ? null : lastDay + delta;

  const skip = new Set<number>();
  for (const prop of all(ev, "EXDATE")) {
    for (const v of prop.value.split(",")) {
      const t = parseIcsTime(v, prop.params);
      if (!t) continue;
      const day = (t.dateOnly ? t.wall.day : eventDay(t)) + delta;
      if (day < localStart.day || (localLast !== null && day > localLast)) continue;
      if (!days.includes(weekdayOf(day))) continue;
      skip.add(day);
    }
  }

  return {
    kind: "course",
    course: {
      sourceKey: uid,
      summary,
      suggestedName: suggestName(summary),
      days,
      startHm: hm(localStart),
      endHm: hm(localEnd),
      date: dateString(localStart.day),
      until: localLast === null ? null : dateString(localLast),
      skipDates: [...skip].sort((a, b) => a - b).map(dateString),
    },
    foreign,
  };
}

/** Merge runs of identical one-off events into weekly courses (13.2), leaving the rest as one-offs. */
function mergeSingles(singles: Single[]): IcsCourse[] {
  const groups = new Map<string, Single[]>();
  for (const s of singles) {
    const key = `${s.summary}\u0000${s.startHm}\u0000${s.endHm}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }

  const out: IcsCourse[] = [];
  const oneOff = (s: Single): IcsCourse => ({
    sourceKey: s.uid,
    summary: s.summary,
    suggestedName: suggestName(s.summary),
    days: [],
    startHm: s.startHm,
    endHm: s.endHm,
    date: dateString(s.day),
    until: null,
    skipDates: [],
  });

  for (const group of groups.values()) {
    const dates = [...new Set(group.map((s) => s.day))].sort((a, b) => a - b);
    const perWeekday = new Map<number, number>();
    for (const d of dates) perWeekday.set(weekdayOf(d), (perWeekday.get(weekdayOf(d)) ?? 0) + 1);
    const mergeable = group.length >= 3 && [...perWeekday.values()].every((n) => n >= 2);
    const head = group[0];
    if (!mergeable || !head) {
      out.push(...group.map(oneOff));
      continue;
    }
    const firstDay = dates[0] ?? head.day;
    const lastDay = dates[dates.length - 1] ?? head.day;
    const present = new Set(dates);
    const skipDates: string[] = [];
    for (let d = firstDay; d <= lastDay; d++) {
      if (perWeekday.has(weekdayOf(d)) && !present.has(d)) skipDates.push(dateString(d));
    }
    out.push({
      sourceKey: [...new Set(group.map((s) => s.uid))].sort().join("|"),
      summary: head.summary,
      suggestedName: suggestName(head.summary),
      days: [...perWeekday.keys()].sort((a, b) => a - b),
      startHm: head.startHm,
      endHm: head.endHm,
      date: dateString(firstDay),
      until: dateString(lastDay),
      skipDates,
    });
  }
  return out;
}

export function parseIcs(text: string, options: IcsParseOptions = {}): IcsParseResult {
  const requested = options.localTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localZone = canonicalZone(requested) ?? requested;

  let calendarName: string | null = null;
  const events: RawEvent[] = [];
  const stack: string[] = [];
  let current: RawEvent | null = null;

  for (const line of unfold(text)) {
    if (line.trim() === "") continue;
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      const comp = prop.value.trim().toUpperCase();
      stack.push(comp);
      if (comp === "VEVENT") current = { props: [] };
      continue;
    }
    if (prop.name === "END") {
      const comp = stack.pop();
      if (comp === "VEVENT" && current) {
        events.push(current);
        current = null;
      }
      continue;
    }
    const top = stack[stack.length - 1];
    // Only direct VEVENT properties: nested VALARMs have their own DURATION etc.
    if (top === "VEVENT" && current) current.props.push(prop);
    else if (top === "VCALENDAR" && prop.name === "X-WR-CALNAME" && calendarName === null) {
      calendarName = unescapeText(prop.value).trim() || null;
    }
  }

  const courses: IcsCourse[] = [];
  const singles: Single[] = [];
  const skipped: IcsSkipped[] = [];
  let foreignTimeZone: string | null = null;

  for (const ev of events) {
    const outcome = readEvent(ev, localZone);
    if (outcome.kind === "skip") {
      skipped.push({ summary: unescapeText(first(ev, "SUMMARY")?.value ?? "").trim(), reason: outcome.reason });
      continue;
    }
    foreignTimeZone ??= outcome.foreign;
    if (outcome.kind === "course") courses.push(outcome.course);
    else singles.push(outcome.single);
  }
  courses.push(...mergeSingles(singles));

  courses.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startHm.localeCompare(b.startHm) ||
      a.summary.localeCompare(b.summary) ||
      a.sourceKey.localeCompare(b.sourceKey),
  );
  return { calendarName, courses, skipped, foreignTimeZone };
}

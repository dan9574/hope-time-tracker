// Run with `npm run test:ics` (node --test --experimental-strip-types).
//
// The project has no @types/node and tsconfig does not enable
// `allowImportingTsExtensions`, while Node's type stripping needs the explicit
// `.ts` extension. The three imports below are therefore ts-ignored; the rest
// of the file is still type-checked against the real `ics.ts` API.
// @ts-ignore -- node built-in, no @types/node in this project
import { test } from "node:test";
// @ts-ignore -- node built-in, no @types/node in this project
import assert from "node:assert/strict";
// @ts-ignore -- node built-in, no @types/node in this project
import { readFileSync } from "node:fs";
// @ts-ignore -- explicit .ts extension is required by Node's type stripping
import { parseIcs, suggestName, type IcsCourse, type IcsParseResult } from "./ics.ts";

const LA = "America/Los_Angeles";
const SHANGHAI = "Asia/Shanghai";

const fixture: string = readFileSync(new URL("./__fixtures__/fall2026.ics", import.meta.url), "utf8");

function course(result: IcsParseResult, summary: string): IcsCourse {
  const found = result.courses.find((c) => c.summary === summary);
  if (!found) throw new Error(`course "${summary}" not found`);
  return found;
}

/** Wrap VEVENT bodies (arrays of content lines) in a calendar, CRLF-terminated. */
function calendar(...events: string[][]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN"];
  for (const ev of events) lines.push("BEGIN:VEVENT", ...ev, "END:VEVENT");
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Real sample file

test("fall2026.ics: overall shape", () => {
  const r = parseIcs(fixture, { localTimeZone: LA });
  assert.equal(r.courses.length, 11);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.calendarName, "UCSD Fall 2026");
  assert.equal(r.foreignTimeZone, null);
  assert.equal(r.courses.filter((c) => c.days.length > 0).length, 7);
  // Sorted by date, then start time.
  const keys = r.courses.map((c) => `${c.date} ${c.startHm}`);
  assert.deepEqual(keys, [...keys].sort());
});

test("fall2026.ics: CSE 100-LE (UTC UNTIL converted into the event zone, EXDATE)", () => {
  const c = course(parseIcs(fixture, { localTimeZone: LA }), "CSE 100-LE");
  assert.deepEqual(c, {
    sourceKey: "tritoncal-fall2026-1@local",
    summary: "CSE 100-LE",
    suggestedName: "CSE 100",
    days: [1, 3, 5],
    startHm: "09:00",
    endHm: "09:50",
    date: "2026-09-25",
    until: "2026-12-04",
    skipDates: ["2026-11-11", "2026-11-27"],
  });
});

test("fall2026.ics: PHIL 27-LE and MUS 127-LE", () => {
  const r = parseIcs(fixture, { localTimeZone: LA });
  const phil = course(r, "PHIL 27-LE");
  assert.deepEqual(phil.days, [1, 3]);
  assert.equal(phil.date, "2026-09-28");
  assert.deepEqual(phil.skipDates, ["2026-11-11"]);
  const mus = course(r, "MUS 127-LE");
  assert.deepEqual(mus.days, [2, 4]);
  assert.equal(mus.date, "2026-09-24");
  assert.deepEqual(mus.skipDates, ["2026-11-26"]);
  assert.equal(mus.startHm, "11:00");
  assert.equal(mus.endHm, "12:20");
});

test("fall2026.ics: one-off exam", () => {
  const c = course(parseIcs(fixture, { localTimeZone: LA }), "CSE 101 期末考试");
  assert.deepEqual(c.days, []);
  assert.equal(c.date, "2026-12-07");
  assert.equal(c.startHm, "11:30");
  assert.equal(c.endHm, "14:29");
  assert.equal(c.until, null);
  assert.deepEqual(c.skipDates, []);
  assert.equal(c.suggestedName, "CSE 101");
  assert.equal(c.sourceKey, "tritoncal-fall2026-8@local");
});

test("fall2026.ics in Asia/Shanghai: converted to the local clock, series shifted by a day", () => {
  // 09:00 PDT on Fri 2026-09-25 is 00:00 on Sat 2026-09-26 in Shanghai. The spec
  // says the recurring plan keeps the first occurrence's converted wall clock, and
  // the plan's `date` must be one of its `days`, so the whole series moves with it:
  // weekdays Mon/Wed/Fri → Tue/Thu/Sat, UNTIL 12-04 → 12-05, and the EXDATEs
  // (11-11, 11-27 in LA) → 11-12, 11-28. Known limitation: after the US DST change
  // on 11-01 the real class is at 01:00 Shanghai time; one plan cannot express that.
  const r = parseIcs(fixture, { localTimeZone: SHANGHAI });
  assert.equal(r.foreignTimeZone, LA);
  assert.equal(r.courses.length, 11);
  const c = course(r, "CSE 100-LE");
  assert.equal(c.date, "2026-09-26");
  assert.equal(c.startHm, "00:00");
  assert.equal(c.endHm, "00:50");
  assert.deepEqual(c.days, [2, 4, 6]);
  assert.equal(c.until, "2026-12-05");
  assert.deepEqual(c.skipDates, ["2026-11-12", "2026-11-28"]);
  // 11:30 PST on 12-07 = 03:30 on 12-08 in Shanghai.
  const exam = course(r, "CSE 101 期末考试");
  assert.equal(exam.date, "2026-12-08");
  assert.equal(exam.startHm, "03:30");
  assert.equal(exam.endHm, "06:29");
});

// ---------------------------------------------------------------------------
// Time forms

test("floating time is taken as-is regardless of the local zone", () => {
  const ics = calendar(["UID:f1", "SUMMARY:Reading", "DTSTART:20261001T083000", "DTEND:20261001T093000"]);
  for (const zone of [LA, SHANGHAI]) {
    const r = parseIcs(ics, { localTimeZone: zone });
    assert.equal(r.foreignTimeZone, null);
    assert.deepEqual(r.courses[0], {
      sourceKey: "f1",
      summary: "Reading",
      suggestedName: "Reading",
      days: [],
      startHm: "08:30",
      endHm: "09:30",
      date: "2026-10-01",
      until: null,
      skipDates: [],
    });
  }
});

test("UTC DTSTART is converted to the local zone without flagging a foreign zone", () => {
  const ics = calendar(["UID:u1", "SUMMARY:Call", "DTSTART:20261001T160000Z", "DTEND:20261001T170000Z"]);
  const la = parseIcs(ics, { localTimeZone: LA });
  assert.equal(la.foreignTimeZone, null);
  assert.equal(la.courses[0]?.date, "2026-10-01");
  assert.equal(la.courses[0]?.startHm, "09:00");
  assert.equal(la.courses[0]?.endHm, "10:00");
  const sh = parseIcs(ics, { localTimeZone: SHANGHAI });
  assert.equal(sh.foreignTimeZone, null);
  assert.equal(sh.courses[0]?.date, "2026-10-02");
  assert.equal(sh.courses[0]?.startHm, "00:00");
});

test("TZID across a DST change converts with the offset of that day", () => {
  // 2026-11-02 is after the US fall-back: 08:00 PST = 16:00 UTC = 00:00 next day in Shanghai.
  const ics = calendar([
    "UID:d1",
    "SUMMARY:Lab",
    "DTSTART;TZID=America/Los_Angeles:20261102T080000",
    "DTEND;TZID=America/Los_Angeles:20261102T090000",
  ]);
  const r = parseIcs(ics, { localTimeZone: SHANGHAI });
  assert.equal(r.courses[0]?.date, "2026-11-03");
  assert.equal(r.courses[0]?.startHm, "00:00");
  assert.equal(r.courses[0]?.endHm, "01:00");
});

test("unknown TZID is treated as floating", () => {
  const ics = calendar([
    "UID:w1",
    "SUMMARY:Meeting",
    "DTSTART;TZID=Pacific Standard Time:20261001T090000",
    "DTEND;TZID=Pacific Standard Time:20261001T100000",
  ]);
  const r = parseIcs(ics, { localTimeZone: SHANGHAI });
  assert.equal(r.foreignTimeZone, null);
  assert.equal(r.courses[0]?.startHm, "09:00");
});

test("DURATION instead of DTEND", () => {
  const ics = calendar(
    ["UID:a", "SUMMARY:A", "DTSTART:20261001T083000", "DURATION:PT1H30M"],
    ["UID:b", "SUMMARY:B", "DTSTART:20261002T233000", "DURATION:PT45M"],
    ["UID:c", "SUMMARY:C", "DTSTART:20261003T100000", "DURATION:P0DT2H5M0S"],
  );
  const r = parseIcs(ics, { localTimeZone: LA });
  assert.deepEqual(
    r.courses.map((c) => [c.summary, c.startHm, c.endHm]),
    [
      ["A", "08:30", "10:00"],
      ["B", "23:30", "00:15"],
      ["C", "10:00", "12:05"],
    ],
  );
});

test("missing DTSTART or end is skipped as no-time", () => {
  const ics = calendar(
    ["UID:n1", "SUMMARY:No start", "DTEND:20261001T100000"],
    ["UID:n2", "SUMMARY:No end", "DTSTART:20261001T090000"],
  );
  const r = parseIcs(ics, { localTimeZone: LA });
  assert.equal(r.courses.length, 0);
  assert.deepEqual(r.skipped, [
    { summary: "No start", reason: "no-time" },
    { summary: "No end", reason: "no-time" },
  ]);
});

// ---------------------------------------------------------------------------
// RRULE

test("COUNT expands to the last occurrence; EXDATE does not reduce the count", () => {
  // Tue 2026-09-29: 9/29, 10/1, 10/6, 10/8, 10/13.
  const ics = calendar([
    "UID:c1",
    "SUMMARY:Seminar",
    "DTSTART:20260929T140000",
    "DTEND:20260929T150000",
    "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=5",
    "EXDATE:20261006T140000",
    "EXDATE:20261007T140000,20261020T140000",
  ]);
  const c = parseIcs(ics, { localTimeZone: LA }).courses[0];
  assert.deepEqual(c?.days, [2, 4]);
  assert.equal(c?.date, "2026-09-29");
  assert.equal(c?.until, "2026-10-13");
  // 10/7 is a Wednesday and 10/20 is past `until`: both dropped.
  assert.deepEqual(c?.skipDates, ["2026-10-06"]);
});

test("BYDAY missing uses DTSTART's weekday; date is the first BYDAY day on or after DTSTART", () => {
  const ics = calendar(
    ["UID:r1", "SUMMARY:Gym", "DTSTART:20261001T070000", "DTEND:20261001T080000", "RRULE:FREQ=WEEKLY"],
    // DTSTART Thu 10/1, but BYDAY=MO → first occurrence Mon 10/5.
    ["UID:r2", "SUMMARY:Swim", "DTSTART:20261001T180000", "DURATION:PT1H", "RRULE:FREQ=WEEKLY;BYDAY=MO;INTERVAL=1"],
  );
  const r = parseIcs(ics, { localTimeZone: LA });
  const gym = course(r, "Gym");
  assert.deepEqual(gym.days, [4]);
  assert.equal(gym.date, "2026-10-01");
  assert.equal(gym.until, null);
  const swim = course(r, "Swim");
  assert.deepEqual(swim.days, [1]);
  assert.equal(swim.date, "2026-10-05");
});

test("UNTIL in local and date forms; an UNTIL before the start time excludes that day", () => {
  const ics = calendar(
    ["UID:l1", "SUMMARY:L1", "DTSTART:20261001T090000", "DURATION:PT1H", "RRULE:FREQ=WEEKLY;UNTIL=20261029T235959"],
    ["UID:l2", "SUMMARY:L2", "DTSTART:20261001T090000", "DURATION:PT1H", "RRULE:FREQ=WEEKLY;UNTIL=20261029"],
    ["UID:l3", "SUMMARY:L3", "DTSTART:20261001T090000", "DURATION:PT1H", "RRULE:FREQ=WEEKLY;UNTIL=20261029T080000"],
  );
  const r = parseIcs(ics, { localTimeZone: LA });
  assert.equal(course(r, "L1").until, "2026-10-29");
  assert.equal(course(r, "L2").until, "2026-10-29");
  assert.equal(course(r, "L3").until, "2026-10-28");
});

test("unsupported rules and events are skipped with a reason", () => {
  const ics = calendar(
    ["UID:s1", "SUMMARY:Biweekly", "DTSTART:20261001T090000", "DURATION:PT1H", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH"],
    ["UID:s2", "SUMMARY:Daily", "DTSTART:20261001T090000", "DURATION:PT1H", "RRULE:FREQ=DAILY"],
    ["UID:s3", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261126", "DTEND;VALUE=DATE:20261127"],
    [
      "UID:s4",
      "SUMMARY:Moved",
      "RECURRENCE-ID;TZID=America/Los_Angeles:20261001T090000",
      "DTSTART;TZID=America/Los_Angeles:20261002T090000",
      "DURATION:PT1H",
    ],
    ["UID:s5", "SUMMARY:Monthly", "DTSTART:20261001T090000", "DURATION:PT1H", "RRULE:FREQ=WEEKLY;BYMONTH=10"],
    ["UID:s6", "SUMMARY:First Monday", "DTSTART:20261005T090000", "DURATION:PT1H", "RRULE:FREQ=WEEKLY;BYDAY=1MO"],
  );
  const r = parseIcs(ics, { localTimeZone: LA });
  assert.equal(r.courses.length, 0);
  assert.deepEqual(r.skipped, [
    { summary: "Biweekly", reason: "interval" },
    { summary: "Daily", reason: "unsupported-rule" },
    { summary: "Holiday", reason: "all-day" },
    { summary: "Moved", reason: "recurrence-id" },
    { summary: "Monthly", reason: "unsupported-rule" },
    { summary: "First Monday", reason: "unsupported-rule" },
  ]);
});

// ---------------------------------------------------------------------------
// Lexical details

test("line folding (CRLF and LF, space and tab) and escapes", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "X-WR-CALNAME:My\\, Calendar",
    "BEGIN:VEVENT",
    "UID:fold-",
    " 1",
    "SUMMARY:Lab\\, Sec",
    "\ttion A\\; room \\\\2\\N",
    "DTSTART:2026100",
    " 1T090000",
    "DTEND:20261001T100000",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "DURATION:PT5M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  for (const eol of ["\r\n", "\n"]) {
    const r = parseIcs(lines(ics, eol), { localTimeZone: LA });
    assert.equal(r.calendarName, "My, Calendar");
    assert.equal(r.courses.length, 1);
    assert.equal(r.courses[0]?.sourceKey, "fold-1");
    assert.equal(r.courses[0]?.summary, "Lab, Section A; room \\2");
    assert.equal(r.courses[0]?.startHm, "09:00");
    // DTEND wins; the VALARM's DURATION is not read as the event's.
    assert.equal(r.courses[0]?.endHm, "10:00");
  }
});

function lines(ls: string[], eol: string): string {
  return ls.join(eol) + eol;
}

// ---------------------------------------------------------------------------
// Merging of one-off events

function single(uid: string, summary: string, date: string, start = "100000", end = "105000"): string[] {
  const d = date.replaceAll("-", "");
  return [
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    `DTSTART;TZID=America/Los_Angeles:${d}T${start}`,
    `DTEND;TZID=America/Los_Angeles:${d}T${end}`,
  ];
}

test("six identical one-offs on Mon/Wed merge into a weekly course; the gap becomes a skip date", () => {
  // Mondays 10/5 10/12 10/19 10/26, Wednesdays 10/7 10/21 (10/14 missing).
  const ics = calendar(
    single("m6", "BILD 1-LA", "2026-10-26"),
    single("m1", "BILD 1-LA", "2026-10-05"),
    single("m2", "BILD 1-LA", "2026-10-07"),
    single("m3", "BILD 1-LA", "2026-10-12"),
    single("m4", "BILD 1-LA", "2026-10-19"),
    single("m5", "BILD 1-LA", "2026-10-21"),
    // Same name, different time: stays a separate one-off.
    single("x1", "BILD 1-LA", "2026-10-28", "150000", "155000"),
  );
  const r = parseIcs(ics, { localTimeZone: LA });
  assert.equal(r.courses.length, 2);
  assert.deepEqual(r.courses[0], {
    sourceKey: "m1|m2|m3|m4|m5|m6",
    summary: "BILD 1-LA",
    suggestedName: "BILD 1",
    days: [1, 3],
    startHm: "10:00",
    endHm: "10:50",
    date: "2026-10-05",
    until: "2026-10-26",
    skipDates: ["2026-10-14"],
  });
  assert.equal(r.courses[1]?.sourceKey, "x1");
  assert.deepEqual(r.courses[1]?.days, []);
});

test("two identical one-offs are not merged", () => {
  const ics = calendar(single("a", "Review", "2026-10-05"), single("b", "Review", "2026-10-12"));
  const r = parseIcs(ics, { localTimeZone: LA });
  assert.equal(r.courses.length, 2);
  for (const c of r.courses) {
    assert.deepEqual(c.days, []);
    assert.equal(c.until, null);
    assert.deepEqual(c.skipDates, []);
  }
  assert.deepEqual(
    r.courses.map((c) => c.date),
    ["2026-10-05", "2026-10-12"],
  );
});

test("three one-offs where a weekday appears only once are not merged", () => {
  const ics = calendar(
    single("a", "Review", "2026-10-05"),
    single("b", "Review", "2026-10-12"),
    single("c", "Review", "2026-10-13"),
  );
  const r = parseIcs(ics, { localTimeZone: LA });
  assert.equal(r.courses.length, 3);
  assert.ok(r.courses.every((c) => c.days.length === 0));
});

// ---------------------------------------------------------------------------
// Suggested names

test("suggestName strips exam suffixes and section codes", () => {
  assert.equal(suggestName("CSE 100-LE"), "CSE 100");
  assert.equal(suggestName("CSE 101 期末考试"), "CSE 101");
  assert.equal(suggestName("  MATH 20C - DI  "), "MATH 20C");
  assert.equal(suggestName("PHYS 2A-LA1"), "PHYS 2A");
  assert.equal(suggestName("CSE 101-LE Final"), "CSE 101");
  assert.equal(suggestName("ECON 1 Final Exam"), "ECON 1");
  assert.equal(suggestName("ECON 1 midterm"), "ECON 1");
  assert.equal(suggestName("PHIL 27 期中考试"), "PHIL 27");
  assert.equal(suggestName("Final"), "Final");
  assert.equal(suggestName("Reading"), "Reading");
});

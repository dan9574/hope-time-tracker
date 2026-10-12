import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { scheduleGroup } from "../lib/activity";
import {
  commands,
  type Activity,
  type CourseImport,
  type PastOccurrence,
  type PlanImportInput,
  type ScheduleImportReport,
} from "../lib/bindings";
import { alertInfo } from "../lib/confirm";
import { errorMessage } from "../lib/errors";
import type { IcsCourse, IcsParseResult, IcsSkipped } from "../lib/ics";
import { isoWeekday, makeRule } from "../lib/plans";
import { useIncludeSchedule } from "../lib/preferences";
import { atClock, dateKey, weekDays } from "../lib/time";
import { Segmented } from "./Segmented";
import "./Sheet.css";
import "./ScheduleImport.css";

type StartMode = "file" | "today" | "custom";
type EndMode = "file" | "none" | "custom";

interface Props {
  result: IcsParseResult;
  /** All activities, to name the timetable group the courses go under. */
  activities: Activity[];
  onClose: () => void;
}

/** "YYYY-MM-DD" → local midnight. */
const parseKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};

/** The first day on or after `key` whose ISO weekday is in `days`. */
function firstOnOrAfter(key: string, days: number[]): string {
  const date = parseKey(key);
  for (let i = 0; i < 7 && !days.includes(isoWeekday(date)); i++) date.setDate(date.getDate() + 1);
  return dateKey(date);
}

/** A course after the start / end choices. One-off events are never moved. */
interface Effective {
  date: string;
  until: string | null;
  skipDates: string[];
  /** Recurring: nothing left in the chosen range. One-off: outside the chosen range. */
  outside: boolean;
}

function effective(c: IcsCourse, start: string | null, endMode: EndMode, end: string): Effective {
  if (c.days.length === 0) {
    const outside = (start !== null && c.date < start) || (endMode === "custom" && end !== "" && c.date > end);
    return { date: c.date, until: null, skipDates: [], outside };
  }
  const date = start !== null && start > c.date ? firstOnOrAfter(start, c.days) : c.date;
  const until = endMode === "file" ? c.until : endMode === "none" ? null : end || null;
  const skipDates = c.skipDates.filter((d) => d >= date && (until === null || d <= until));
  return { date, until, skipDates, outside: until !== null && until < date };
}

/**
 * Occurrences of a recurring course from its effective first day to today that have already ended, in local
 * time (rebuild-plan 13.3.1). One-off events are never backfilled.
 */
function pastOccurrences(c: IcsCourse, eff: Effective, todayKey: string, now: number): PastOccurrence[] {
  if (c.days.length === 0) return [];
  const past: PastOccurrence[] = [];
  for (const day = parseKey(eff.date); ; day.setDate(day.getDate() + 1)) {
    const key = dateKey(day);
    if (key > todayKey || (eff.until !== null && key > eff.until)) break;
    if (!c.days.includes(isoWeekday(day)) || eff.skipDates.includes(key)) continue;
    const start = atClock(day, c.startHm);
    const end = atClock(day, c.endHm);
    if (start !== null && end !== null && end <= now) past.push({ date: key, start_ms: start, end_ms: end });
  }
  return past;
}

const SKIP_REASON: Record<IcsSkipped["reason"], string> = {
  "unsupported-rule": "schedule.import.reason.unsupportedRule",
  interval: "schedule.import.reason.interval",
  "all-day": "schedule.import.reason.allDay",
  "recurrence-id": "schedule.import.reason.recurrenceId",
  "no-time": "schedule.import.reason.noTime",
};

/** Preview of a parsed .ics file; imports the chosen courses under the timetable group (rebuild-plan 13.3). */
export function ScheduleImport({ result, activities, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const includeSchedule = useIncludeSchedule();
  const todayKey = dateKey(new Date());
  const { courses, skipped } = result;

  const [startMode, setStartMode] = useState<StartMode>("file");
  const [startCustom, setStartCustom] = useState(todayKey);
  const [endMode, setEndMode] = useState<EndMode>("file");
  const [endCustom, setEndCustom] = useState(
    () => courses.reduce<string | null>((max, c) => (c.until && (!max || c.until > max) ? c.until : max), null) ?? todayKey,
  );
  const [names, setNames] = useState(() => courses.map((c) => c.suggestedName));
  // Rows the user ticked or unticked; the rest follow the default (checked unless outside the range).
  const [picked, setPicked] = useState<Map<number, boolean>>(new Map());
  // Log the classes that already happened as attended (rebuild-plan 13.3.1).
  const [backfill, setBackfill] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => ref.current?.showModal(), []);

  const start = startMode === "file" ? null : startMode === "today" ? todayKey : startCustom || null;
  const end = endMode === "custom" ? endCustom : "";
  const rangeError = start !== null && end !== "" && end < start;
  const rows = courses.map((course, i) => {
    const eff = effective(course, start, endMode, end);
    // A recurring course with nothing left in the range has nothing to import.
    const disabled = eff.outside && course.days.length > 0;
    const checked = !disabled && (picked.get(i) ?? !eff.outside);
    return { course, eff, i, disabled, checked, name: names[i]!.trim() };
  });
  const chosen = rows.filter((r) => r.checked);
  const now = Date.now();
  const pastByRow = new Map(chosen.map((r) => [r.i, pastOccurrences(r.course, r.eff, todayKey, now)]));
  const pastCount = [...pastByRow.values()].reduce((n, list) => n + list.length, 0);
  const missingName = chosen.some((r) => r.name === "");

  const group = scheduleGroup(activities);
  const groupName = group?.name ?? t("schedule.group");

  const weekday = weekdayLabels(i18n.language);
  const monthDay = new Intl.DateTimeFormat(i18n.language, { month: "numeric", day: "numeric" });
  const md = (key: string) => monthDay.format(parseKey(key));
  const describe = (c: IcsCourse, eff: Effective) => {
    const time = `${c.startHm}–${c.endHm}`;
    if (c.days.length === 0) return `${md(c.date)} ${time}`;
    const days = [...c.days].sort((a, b) => a - b).map((d) => weekday.labels[d - 1]).join(weekday.joiner);
    const range = eff.until === null ? t("schedule.import.openEnded", { date: md(eff.date) }) : `${md(eff.date)}–${md(eff.until)}`;
    const parts = [`${days} ${time}`, range];
    if (eff.skipDates.length > 0) parts.push(t("schedule.import.skips", { count: eff.skipDates.length }));
    return parts.join(" · ");
  };

  const submit = async () => {
    if (chosen.length === 0 || missingName || rangeError || busy) return;
    // Rows with the same name become one sub-activity.
    const byName = new Map<string, PlanImportInput[]>();
    for (const { course, eff, name, i } of chosen) {
      const plan: PlanImportInput = {
        source_key: course.sourceKey,
        date: eff.date,
        start_hm: course.startHm,
        end_hm: course.endHm,
        rule: makeRule(course.days),
        auto_log: true,
        until: eff.until,
        skip_dates: eff.skipDates,
        past: backfill ? (pastByRow.get(i) ?? []) : [],
      };
      const list = byName.get(name);
      if (list) list.push(plan);
      else byName.set(name, [plan]);
    }
    const input: CourseImport[] = [...byName].map(([name, plans]) => ({ name, plans }));
    setBusy(true);
    const res = await commands.scheduleImport({ group_name: t("schedule.group"), courses: input });
    setBusy(false);
    if (res.status === "error") return setError(errorMessage(res.error, t));
    onClose();
    await alertInfo(t, t("schedule.import.doneTitle"), summary(res.data, t));
  };

  return (
    <dialog ref={ref} className="sheet is-wide" onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        className="sheet-body"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="import-header">
          <h2 className="sheet-title">{t("schedule.import.title")}</h2>
          <p className="import-subtitle">
            {t("schedule.import.subtitle", { name: result.calendarName ?? "ICS", count: courses.length })}
          </p>
        </div>

        <div className="sheet-row">
          <span>{t("schedule.import.start")}</span>
          <span className="sheet-inline">
            {startMode === "custom" && (
              <input
                type="date"
                className="settings-time tabular"
                value={startCustom}
                aria-label={t("schedule.import.start")}
                onChange={(e) => setStartCustom(e.target.value)}
              />
            )}
            <Segmented
              label={t("schedule.import.start")}
              value={startMode}
              options={[
                { value: "file", label: t("schedule.import.fromFile") },
                { value: "today", label: t("schedule.import.today") },
                { value: "custom", label: t("schedule.import.custom") },
              ]}
              onChange={setStartMode}
            />
          </span>
        </div>
        <div className="sheet-row">
          <span>{t("schedule.import.end")}</span>
          <span className="sheet-inline">
            {endMode === "custom" && (
              <input
                type="date"
                className="settings-time tabular"
                value={endCustom}
                aria-label={t("schedule.import.end")}
                onChange={(e) => setEndCustom(e.target.value)}
              />
            )}
            <Segmented
              label={t("schedule.import.end")}
              value={endMode}
              options={[
                { value: "file", label: t("schedule.import.fromFile") },
                { value: "none", label: t("schedule.import.noEnd") },
                { value: "custom", label: t("schedule.import.custom") },
              ]}
              onChange={setEndMode}
            />
          </span>
        </div>
        <p className="sheet-note">{t("schedule.import.rangeHint")}</p>
        {rangeError && <p className="sheet-error">{t("plan.untilBeforeStart")}</p>}

        <ul className="import-list">
          {rows.map(({ course, eff, i, disabled, checked }) => (
            <li key={course.sourceKey} className={disabled ? "import-row is-disabled" : "import-row"}>
              <input
                type="checkbox"
                className="sheet-check"
                checked={checked}
                disabled={disabled}
                aria-label={names[i]}
                onChange={(e) => setPicked((prev) => new Map(prev).set(i, e.target.checked))}
              />
              <span className="import-row-main">
                <input
                  className="import-name"
                  value={names[i]}
                  disabled={disabled}
                  placeholder={course.summary}
                  aria-label={t("schedule.import.name")}
                  onChange={(e) => setNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))}
                />
                <span className="import-detail tabular">
                  {describe(course, eff)}
                  {disabled && ` · ${t("schedule.import.outside")}`}
                </span>
              </span>
            </li>
          ))}
          {skipped.map((s, i) => (
            <li key={`skipped-${i}`} className="import-row is-disabled">
              <input type="checkbox" className="sheet-check" checked={false} disabled aria-label={s.summary} />
              <span className="import-row-main">
                <span className="import-skipped-name">{s.summary || t("schedule.import.untitled")}</span>
                <span className="import-detail">{t(SKIP_REASON[s.reason])}</span>
              </span>
            </li>
          ))}
        </ul>

        {pastCount > 0 && (
          <label className="sheet-row">
            <span>{t("schedule.import.backfill")}</span>
            <span className="sheet-inline">
              <span className="tabular">{t("schedule.import.backfillCount", { count: pastCount })}</span>
              <input
                type="checkbox"
                className="sheet-check"
                checked={backfill}
                onChange={(e) => setBackfill(e.target.checked)}
              />
            </span>
          </label>
        )}

        {result.foreignTimeZone && (
          <p className="sheet-note">{t("schedule.import.foreignZone", { zone: result.foreignTimeZone })}</p>
        )}
        <p className="sheet-note">
          {[
            group ? t("schedule.import.footnote", { group: groupName }) : t("schedule.import.footnoteNew", { group: groupName }),
            t("schedule.import.sameName"),
            includeSchedule ? t("schedule.import.counted") : t("schedule.import.notCounted"),
          ].join(sentenceGap(i18n.language))}
        </p>
        {missingName && <p className="sheet-error">{t("schedule.import.nameRequired")}</p>}
        {error && <p className="sheet-error">{error}</p>}

        <div className="sheet-actions">
          <span className="sheet-spacer" />
          <button type="button" className="settings-button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="settings-button is-primary"
            disabled={chosen.length === 0 || missingName || rangeError || busy}
          >
            {t("schedule.import.confirm", { count: chosen.length })}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Weekday labels Monday…Sunday. Narrow forms ("一", "M") read well run together, but where they
 * repeat (English T/T, S/S) the short forms are used instead, spaced.
 */
function weekdayLabels(locale: string): { labels: string[]; joiner: string } {
  const monday = weekDays(new Date());
  const narrow = monday.map((d) => new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(d));
  if (new Set(narrow).size === 7) return { labels: narrow, joiner: "" };
  return { labels: monday.map((d) => new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d)), joiner: " " };
}

/** Chinese sentences follow each other directly; others take a space. */
const sentenceGap = (locale: string) => (locale.startsWith("zh") ? "" : " ");

function summary(r: ScheduleImportReport, t: TFunction): string {
  const counts = { activities: r.activities_created, added: r.plans_added, updated: r.plans_updated };
  return r.sessions_logged > 0
    ? t("schedule.import.doneLogged", { ...counts, count: r.sessions_logged })
    : t("schedule.import.done", counts);
}

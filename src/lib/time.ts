import type { TimeRange } from "./bindings";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Local midnight → next local midnight (handles DST because it uses calendar math). */
export function dayRange(date: Date): TimeRange {
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const to = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return { from_ms: from.getTime(), to_ms: to.getTime() };
}

/** Weeks start on Monday everywhere in Hope. */
export function weekStart(date: Date): Date {
  const offset = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

/** The seven local days of the week containing `date`, Monday first. */
export function weekDays(date: Date): Date[] {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Every local day of the month containing `date`. */
export function monthDays(date: Date): Date[] {
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => new Date(date.getFullYear(), date.getMonth(), i + 1));
}

/** `date` moved by whole weeks / months (month math clamps to the 1st to avoid overflow). */
export function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + weeks * 7);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** Same wall-clock moment `days` days away (calendar math, so DST-safe). */
export function shiftDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** 'YYYY-MM-DD' in the system time zone. */
export function dateKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** Epoch ms for an 'HH:MM' clock time on the given local day; null if malformed. */
export function atClock(day: Date, hm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!match) return null;
  const [h, m] = [Number(match[1]), Number(match[2])];
  if (h > 24 || m > 59) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
}

/** `H:MM` — durations everywhere in the app. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** `H:MM:SS` — only for a live, running timer. */
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const s = String(seconds % 60).padStart(2, "0");
  return `${formatDuration(seconds * 1000)}:${s}`;
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock time in the user's locale, e.g. 09:30. */
export function formatClock(ms: number, locale: string): string {
  let f = clockFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
    clockFormats.set(locale, f);
  }
  return f.format(ms);
}

/** "Last week", "3 months ago" … in the user's locale, capitalized for use as a title. */
export function relativePeriod(offset: number, unit: "week" | "month", locale: string): string {
  const text = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(offset, unit);
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

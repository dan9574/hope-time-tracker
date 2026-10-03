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

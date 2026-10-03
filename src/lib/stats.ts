import type { Activity, Session, TimeRange } from "./bindings";
import type { RingSegment } from "../components/Ring";
import { dateKey, dayRange } from "./time";

/** One timeline row: a pause/resume chain shown as a single entry. */
export interface DayEntry {
  key: string;
  activityId: string;
  /** Undefined when the activity is unknown (no foreign keys; sync may deliver it later). */
  activity: Activity | undefined;
  startMs: number;
  /** Null while the last segment is running. */
  endMs: number | null;
  /** Sum of segment durations inside the range; pauses don't count. */
  durationMs: number;
  /** Clipped to the range, for drawing. */
  segments: Array<{ startMs: number; endMs: number }>;
  note: string | null;
}

export interface DaySummary {
  totalMs: number;
  entries: DayEntry[];
}

export function summarizeDay(
  sessions: Session[],
  activities: Activity[],
  range: TimeRange,
  now: number,
): DaySummary {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const activityById = new Map(activities.map((a) => [a.id, a]));

  // Walk each session back to the first segment of its chain that is in this day.
  const rootOf = (s: Session): string => {
    let cur = s;
    const seen = new Set<string>();
    while (cur.continues_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      const prev = byId.get(cur.continues_id);
      if (!prev) break;
      cur = prev;
    }
    return cur.id;
  };

  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const root = rootOf(s);
    const list = groups.get(root);
    if (list) list.push(s);
    else groups.set(root, [s]);
  }

  const entries: DayEntry[] = [];
  let totalMs = 0;
  for (const [key, chain] of groups) {
    chain.sort((a, b) => a.start_ms - b.start_ms);
    const first = chain[0]!;
    const last = chain[chain.length - 1]!;
    const segments = chain
      .map((s) => ({
        startMs: Math.max(s.start_ms, range.from_ms),
        endMs: Math.min(s.end_ms ?? now, range.to_ms),
      }))
      .filter((seg) => seg.endMs > seg.startMs);
    const durationMs = segments.reduce((sum, seg) => sum + seg.endMs - seg.startMs, 0);
    totalMs += durationMs;
    entries.push({
      key,
      activityId: first.activity_id,
      activity: activityById.get(first.activity_id),
      startMs: first.start_ms,
      endMs: last.end_ms,
      durationMs,
      segments,
      note: chain.map((s) => s.note).find((n): n is string => !!n) ?? null,
    });
  }
  entries.sort((a, b) => a.startMs - b.startMs);
  return { totalMs, entries };
}

export interface ActivityTotal {
  activityId: string;
  activity: Activity | undefined;
  ms: number;
}

/** Per-activity totals, largest first. */
export function totalsByActivity(entries: DayEntry[]): ActivityTotal[] {
  const totals = new Map<string, ActivityTotal>();
  for (const e of entries) {
    const t = totals.get(e.activityId);
    if (t) t.ms += e.durationMs;
    else totals.set(e.activityId, { activityId: e.activityId, activity: e.activity, ms: e.durationMs });
  }
  return [...totals.values()].filter((t) => t.ms > 0).sort((a, b) => b.ms - a.ms);
}

/** Day entries flattened into ring segments. */
export function ringRecords(entries: DayEntry[]): RingSegment[] {
  return entries.flatMap((e) =>
    e.segments.map((seg) => ({ key: `${e.key}-${seg.startMs}`, ...seg, color: e.activity?.color })),
  );
}

export interface DayTotals {
  key: string;
  date: Date;
  totalMs: number;
  parts: ActivityTotal[];
}

/** Each day's total and per-activity split; sessions crossing midnight are split between days. */
export function summarizeDays(sessions: Session[], activities: Activity[], days: Date[], now: number): DayTotals[] {
  return days.map((date) => {
    const s = summarizeDay(sessions, activities, dayRange(date), now);
    return { key: dateKey(date), date, totalMs: s.totalMs, parts: totalsByActivity(s.entries) };
  });
}

/** Per-activity totals across several days, largest first. */
export function mergeTotals(days: DayTotals[]): ActivityTotal[] {
  const merged = new Map<string, ActivityTotal>();
  for (const d of days) {
    for (const p of d.parts) {
      const m = merged.get(p.activityId);
      if (m) m.ms += p.ms;
      else merged.set(p.activityId, { ...p });
    }
  }
  return [...merged.values()].sort((a, b) => b.ms - a.ms);
}

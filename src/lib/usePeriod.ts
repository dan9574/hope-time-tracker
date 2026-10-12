import { commands } from "./bindings";
import { useQuery } from "./data";
import { useIncludeSchedule } from "./preferences";
import { mergeTotals, summarizeDays } from "./stats";
import { dateKey, dayRange } from "./time";
import { useNow } from "./useNow";

/** Sessions for a run of days, summarized per day and per activity. Ticks while a timer runs. */
export function usePeriod(days: Date[]) {
  const timer = useQuery(() => commands.sessionCurrent(), []);
  const now = useNow(timer?.running ? 1000 : 60_000);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const range = { from_ms: from.getTime(), to_ms: dayRange(to).to_ms };

  const sessions = useQuery(() => commands.sessionList(range), [range.from_ms, range.to_ms]);
  const activities = useQuery(() => commands.activityList(true), []);
  const includeSchedule = useIncludeSchedule();

  // Unless the setting says otherwise, timetable time stays out of the bars and totals (rebuild-plan 13.4).
  const perDay = summarizeDays(sessions ?? [], activities ?? [], days, now, includeSchedule);
  const scheduleMs = perDay.reduce((sum, d) => sum + d.scheduleMs, 0);
  return {
    now,
    perDay,
    totals: mergeTotals(perDay),
    todayKey: dateKey(new Date(now)),
    activities,
    includeSchedule,
    scheduleMs,
  };
}

import { activityColorVar } from "../lib/activity";
import type { DayTotals } from "../lib/stats";
import { formatDuration } from "../lib/time";
import "./MonthCalendar.css";

interface Props {
  days: DayTotals[];
  /** Short weekday names, Monday first. */
  weekdays: string[];
  todayKey: string;
  now: number;
}

/** Month grid, Monday first: date, the day's total, and a thin bar scaled to the month's busiest day. */
export function MonthCalendar({ days, weekdays, todayKey, now }: Props) {
  const lead = days.length > 0 ? (days[0]!.date.getDay() + 6) % 7 : 0;
  const peak = Math.max(...days.map((d) => d.totalMs), 1);

  return (
    <div className="calendar">
      {weekdays.map((w, i) => (
        <span key={i} className="calendar-weekday">
          {w}
        </span>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <span key={`lead-${i}`} />
      ))}
      {days.map((d) => {
        const future = d.date.getTime() > now;
        const classes = ["calendar-day", d.key === todayKey && "is-today", future && "is-future"].filter(Boolean).join(" ");
        return (
          <div key={d.key} className={classes}>
            <span className="calendar-date tabular">{d.date.getDate()}</span>
            <span className="calendar-total tabular">{d.totalMs > 0 ? formatDuration(d.totalMs) : ""}</span>
            {!future && (
              <span className="calendar-bar">
                <span className="calendar-bar-fill" style={{ width: `${(d.totalMs / peak) * 100}%` }}>
                  {d.parts.map((p) => (
                    <span key={p.activityId} style={{ flexGrow: p.ms, background: activityColorVar(p.activity?.color) }} />
                  ))}
                </span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

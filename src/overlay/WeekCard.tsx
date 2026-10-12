import { useTranslation } from "react-i18next";
import { activityColorVar } from "../lib/activity";
import type { Activity } from "../lib/bindings";
import { commands } from "../lib/bindings";
import { useQuery } from "../lib/data";
import { useIncludeSchedule } from "../lib/preferences";
import { dayTotals, summarizeDay } from "../lib/stats";
import { dateKey, dayRange, formatDuration, shiftDays, weekDays } from "../lib/time";

interface Props {
  now: number;
  activities: Activity[] | undefined;
}

const BAR_MAX = 48;

/** Seven thin stacked bars, the week's total, and the change against the same point last week. */
export function WeekCard({ now, activities }: Props) {
  const { t, i18n } = useTranslation();
  const days = weekDays(new Date(now));
  const from = days[0]!.getTime();
  const to = dayRange(days[6]!).to_ms;
  const lastFrom = shiftDays(from, -7);
  const lastUntil = shiftDays(now, -7);
  const weekKey = dateKey(days[0]!);
  const includeSchedule = useIncludeSchedule();

  const sessions = useQuery(() => commands.sessionList({ from_ms: from, to_ms: to }), [weekKey]);
  const lastSessions = useQuery(() => commands.sessionList({ from_ms: lastFrom, to_ms: lastUntil }), [
    weekKey,
    Math.floor(now / 60_000),
  ]);

  const bars = days.map((d) => dayTotals(sessions ?? [], activities ?? [], d, now, includeSchedule));
  const totalMs = bars.reduce((sum, b) => sum + b.totalMs, 0);
  // Activities are needed here too, to tell timetable time apart.
  const lastMs = summarizeDay(
    lastSessions ?? [],
    activities ?? [],
    { from_ms: lastFrom, to_ms: lastUntil },
    now,
    includeSchedule,
  ).totalMs;
  const delta = totalMs - lastMs;
  const peak = Math.max(...bars.map((b) => b.totalMs), 1);
  const todayKey = dateKey(new Date(now));
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "narrow" });

  return (
    <section className="overlay-card">
      <p className="overlay-label overlay-spread">
        <span>{t("overlay.thisWeek")}</span>
        <span className="overlay-value tabular">{formatDuration(totalMs)}</span>
      </p>
      <div className="overlay-bars" style={{ height: BAR_MAX }}>
        {bars.map((b) => (
          <div key={b.key} className={b.key === todayKey ? "overlay-bar is-today" : "overlay-bar"}>
            {b.parts.map((p) => (
              <span
                key={p.activityId}
                style={{ height: (p.ms / peak) * BAR_MAX, background: activityColorVar(p.activity?.color) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="overlay-bar-labels">
        {bars.map((b) => (
          <span key={b.key} className={b.key === todayKey ? "is-today" : undefined}>
            {weekday.format(b.date)}
          </span>
        ))}
      </div>
      {sessions && lastSessions && (
        <p className="overlay-muted tabular">
          {t("overlay.vsLastWeek", { delta: `${delta >= 0 ? "+" : "−"}${formatDuration(Math.abs(delta))}` })}
        </p>
      )}
    </section>
  );
}

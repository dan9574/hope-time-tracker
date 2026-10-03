import { useTranslation } from "react-i18next";
import { ActivityDot } from "../components/ActivityDot";
import { activityName, indexById, parentOf } from "../lib/activity";
import type { Activity, TimerState } from "../lib/bindings";
import { formatElapsed } from "../lib/time";
import { Duration } from "../components/Duration";

interface Props {
  timer: TimerState | undefined;
  activities: Activity[] | undefined;
  todayMs: number;
  now: number;
}

/** What's running right now; falls back to today's total. */
export function NowCard({ timer, activities, todayMs, now }: Props) {
  const { t } = useTranslation();
  const current = timer?.running ?? timer?.paused;
  const byId = indexById(activities);
  const activity = current ? byId.get(current.activity_id) : undefined;

  return (
    <section className="overlay-card">
      {current ? (
        <>
          <p className="overlay-label">
            <ActivityDot color={activity?.color} />
            <span className="overlay-ellipsis">{activityName(activity, t, parentOf(activity, byId))}</span>
            {timer?.paused && <span className="overlay-muted">· {t("timer.paused")}</span>}
          </p>
          <p className="overlay-big tabular">
            {timer?.running ? formatElapsed(now - timer.running.start_ms) : <Duration ms={current.end_ms! - current.start_ms} />}
          </p>
        </>
      ) : (
        <>
          <p className="overlay-label">
            {t("overlay.today")} · {t("today.total")}
          </p>
          <p className="overlay-big">
            <Duration ms={todayMs} />
          </p>
        </>
      )}
    </section>
  );
}

import { useTranslation } from "react-i18next";
import { ActivityDot } from "../components/ActivityDot";
import { Ring } from "../components/Ring";
import { activityName } from "../lib/activity";
import { ringRecords, totalsByActivity } from "../lib/stats";
import { formatDuration } from "../lib/time";
import type { useToday } from "../lib/useToday";

interface Props {
  today: ReturnType<typeof useToday>;
  now: number;
}

/** Thin horseshoe ring + the day's top three activities. */
export function TodayCard({ today, now }: Props) {
  const { t } = useTranslation();
  const top = totalsByActivity(today.summary.entries).slice(0, 3);

  return (
    <section className="overlay-card overlay-today">
      <Ring
        wakeMs={today.wakeMs}
        sleepMs={today.sleepMs}
        records={ringRecords(today.summary.entries)}
        plans={[]}
        now={now}
        diameter={72}
        stroke={6}
        trackWidth={3}
        sleepSegments={today.sleepSegments}
        slept={today.slept}
      />
      <div className="overlay-today-list">
        <p className="overlay-label">{today.slept ? t("day.rested") : t("overlay.today")}</p>
        {top.length === 0 ? (
          <p className="overlay-muted">{t("overlay.nothingYet")}</p>
        ) : (
          <ul className="overlay-rows">
            {top.map((a) => (
              <li key={a.activityId} className="overlay-row">
                <ActivityDot color={a.activity?.color} />
                <span className="overlay-ellipsis">{activityName(a.activity, t)}</span>
                <span className="overlay-row-value tabular">{formatDuration(a.ms)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

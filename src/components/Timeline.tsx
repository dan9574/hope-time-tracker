import { useTranslation } from "react-i18next";
import { activityColorVar, activityName } from "../lib/activity";
import type { DayEntry } from "../lib/stats";
import { formatClock, formatDuration } from "../lib/time";
import "./Timeline.css";

export function Timeline({ entries }: { entries: DayEntry[] }) {
  const { t, i18n } = useTranslation();

  return (
    <ol className="timeline">
      {entries.map((e) => (
        <li key={e.key} className="timeline-row" style={{ borderLeftColor: activityColorVar(e.activity?.color) }}>
          <span className="timeline-time tabular">
            {formatClock(e.startMs, i18n.language)}–{e.endMs === null ? t("today.now") : formatClock(e.endMs, i18n.language)}
          </span>
          <span className="timeline-main">
            <span className={e.activity ? "timeline-name" : "timeline-name is-unknown"}>{activityName(e.activity, t)}</span>
            {e.note && <span className="timeline-note">{e.note}</span>}
          </span>
          <span className="timeline-duration tabular">{formatDuration(e.durationMs)}</span>
        </li>
      ))}
    </ol>
  );
}

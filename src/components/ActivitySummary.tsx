import { useTranslation } from "react-i18next";
import { activityName } from "../lib/activity";
import type { ActivityTotal } from "../lib/stats";
import { formatDuration } from "../lib/time";
import { ActivityDot } from "./ActivityDot";
import "./ActivitySummary.css";

/** Totals per activity for a period, with each one's share. */
export function ActivitySummary({ totals }: { totals: ActivityTotal[] }) {
  const { t } = useTranslation();
  const sum = totals.reduce((s, a) => s + a.ms, 0);

  return (
    <section className="summary">
      <header className="summary-header">
        <h2>{t("period.byActivity")}</h2>
        <span className="tabular">
          {t("period.total")} {formatDuration(sum)}
        </span>
      </header>
      {totals.length === 0 ? (
        <p className="summary-empty">{t("period.empty")}</p>
      ) : (
        <ul className="summary-list">
          {totals.map((a) => (
            <li key={a.activityId} className="summary-row">
              <ActivityDot color={a.activity?.color} />
              <span className={a.activity ? "summary-name" : "summary-name is-unknown"}>{activityName(a.activity, t)}</span>
              <span className="summary-share tabular">{Math.round((a.ms / sum) * 100)}%</span>
              <span className="summary-value tabular">{formatDuration(a.ms)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { activityName } from "../lib/activity";
import type { ActivityTotal } from "../lib/stats";
import { formatDuration } from "../lib/time";
import { ActivityDot } from "./ActivityDot";
import { hoverProps } from "../lib/useHover";
import { useUi } from "../stores/ui";
import "./ActivitySummary.css";

/** Totals per top-level activity with each one's share; rows with sub-activities expand. */
export function ActivitySummary({ totals }: { totals: ActivityTotal[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const hoverKey = useUi((s) => s.hoverKey);
  const sum = totals.reduce((s, a) => s + a.ms, 0);
  const share = (ms: number) => `${Math.round((ms / sum) * 100)}%`;
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="summary">
      <header className="summary-header">
        <h2>{t("period.byActivity")}</h2>
      </header>
      {totals.length === 0 ? (
        <p className="summary-empty">{t("period.empty")}</p>
      ) : (
        <ul className="summary-list">
          {totals.map((a) => {
            const expandable = a.children.length > 0;
            const expanded = open.has(a.activityId);
            return (
              <li key={a.activityId}>
                <button
                  type="button"
                  className="summary-row"
                  data-hover={hoverKey === null ? undefined : hoverKey === a.activityId ? "on" : "off"}
                  {...hoverProps(a.activityId)}
                  aria-disabled={!expandable}
                  aria-expanded={expandable ? expanded : undefined}
                  onClick={() => expandable && toggle(a.activityId)}
                >
                  <ChevronRight
                    size={12}
                    className={["summary-chevron", expanded && "is-open", !expandable && "is-hidden"].filter(Boolean).join(" ")}
                    aria-hidden
                  />
                  <ActivityDot color={a.activity?.color} />
                  <span className={a.activity ? "summary-name" : "summary-name is-unknown"}>
                    {activityName(a.activity, t)}
                  </span>
                  <span className="summary-share tabular">{share(a.ms)}</span>
                  <span className="summary-value tabular">{formatDuration(a.ms)}</span>
                </button>
                {expanded && (
                  <ul className="summary-children">
                    {a.children.map((c) => (
                      <li key={c.activityId} className="summary-row is-child">
                        <span className="summary-name">
                          {c.activityId === a.activityId ? t("period.unspecified") : activityName(c.activity, t)}
                        </span>
                        <span className="summary-share tabular">{share(c.ms)}</span>
                        <span className="summary-value tabular">{formatDuration(c.ms)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

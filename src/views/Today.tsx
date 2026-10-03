import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Journal } from "../components/Journal";
import { Page } from "../components/Page";
import { PlanEditor } from "../components/PlanEditor";
import { Ring, type RingSegment } from "../components/Ring";
import { Timeline } from "../components/Timeline";
import { commands, type Plan } from "../lib/bindings";
import { useQuery } from "../lib/data";
import { occurrencesOn } from "../lib/plans";
import { useRingWidth } from "../lib/preferences";
import { ringRecords } from "../lib/stats";
import { dateKey, formatClock, formatDuration } from "../lib/time";
import { useNow } from "../lib/useNow";
import { useToday } from "../lib/useToday";
import "./Today.css";

/** `null` = closed, `"new"` = creating, otherwise the plan being edited. */
type Editing = Plan | "new" | null;

export function Today() {
  const { t, i18n } = useTranslation();
  const timer = useQuery(() => commands.sessionCurrent(), []);
  const now = useNow(timer?.running ? 1000 : 30_000);
  const { today, summary, activities, loaded, wakeMs, sleepMs } = useToday(now);
  const ringWidth = useRingWidth();
  const [editing, setEditing] = useState<Editing>(null);

  const key = dateKey(today);
  const plans = useQuery(() => commands.planList({ from: key, to: key }), [key]);
  const occurrences = occurrencesOn(plans ?? [], activities ?? [], today);
  const planSegments: RingSegment[] = occurrences.map((o) => ({
    key: o.key,
    startMs: o.startMs,
    endMs: o.endMs,
    color: o.activity?.color,
  }));
  const pickable = (activities ?? []).filter((a) => a.archived_at === null);

  const subtitle = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(today);

  return (
    <Page title={t("nav.today")} subtitle={subtitle}>
      <section className="today-ring">
        <Ring
          wakeMs={wakeMs}
          sleepMs={sleepMs}
          records={ringRecords(summary.entries)}
          plans={planSegments}
          now={now}
          stroke={ringWidth}
          wakeLabel={formatClock(wakeMs, i18n.language)}
          sleepLabel={formatClock(sleepMs, i18n.language)}
        >
          <span className="today-total tabular">{formatDuration(summary.totalMs)}</span>
          <span className="today-total-label">{t("today.total")}</span>
        </Ring>
      </section>

      <div className="today-toolbar">
        <button type="button" className="today-add" disabled={pickable.length === 0} onClick={() => setEditing("new")}>
          <Plus size={14} aria-hidden />
          {t("plan.add")}
        </button>
      </div>

      {loaded && summary.entries.length === 0 && occurrences.length === 0 ? (
        <p className="today-empty">{t("today.empty")}</p>
      ) : (
        <Timeline entries={summary.entries} plans={occurrences} onPlanClick={setEditing} />
      )}

      <Journal date={key} />

      {editing !== null && (
        <PlanEditor
          plan={editing === "new" ? null : editing}
          date={today}
          activities={pickable}
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  );
}

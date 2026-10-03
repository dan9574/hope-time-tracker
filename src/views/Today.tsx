import { useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Plus } from "lucide-react";
import { Journal } from "../components/Journal";
import { Page } from "../components/Page";
import { PlanEditor } from "../components/PlanEditor";
import { RecordEditor } from "../components/RecordEditor";
import { Ring, type RingSegment } from "../components/Ring";
import { Timeline } from "../components/Timeline";
import { commands, type Plan } from "../lib/bindings";
import { useQuery } from "../lib/data";
import { occurrencesOn } from "../lib/plans";
import { useRingWidth } from "../lib/preferences";
import { ringRecords, type DayEntry } from "../lib/stats";
import { dateKey, formatClock, formatDuration } from "../lib/time";
import { useNow } from "../lib/useNow";
import { useToday } from "../lib/useToday";
import "./Today.css";

/** Which sheet is open. */
type Editing =
  | { kind: "plan"; plan: Plan | null }
  | { kind: "record"; entry: DayEntry | null }
  | null;

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
        <button
          type="button"
          className="today-add"
          disabled={pickable.length === 0}
          onClick={() => setEditing({ kind: "record", entry: null })}
        >
          <History size={14} aria-hidden />
          {t("record.add")}
        </button>
        <button
          type="button"
          className="today-add"
          disabled={pickable.length === 0}
          onClick={() => setEditing({ kind: "plan", plan: null })}
        >
          <Plus size={14} aria-hidden />
          {t("plan.add")}
        </button>
      </div>

      {loaded && summary.entries.length === 0 && occurrences.length === 0 ? (
        <p className="today-empty">{t("today.empty")}</p>
      ) : (
        <Timeline
          entries={summary.entries}
          plans={occurrences}
          onEntryClick={(entry) => setEditing({ kind: "record", entry })}
          onPlanClick={(plan) => setEditing({ kind: "plan", plan })}
        />
      )}

      <Journal date={key} />

      {editing?.kind === "plan" && (
        <PlanEditor plan={editing.plan} date={today} activities={pickable} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === "record" && (
        <RecordEditor entry={editing.entry} activities={activities ?? []} date={today} onClose={() => setEditing(null)} />
      )}
    </Page>
  );
}

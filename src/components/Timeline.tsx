import { useTranslation } from "react-i18next";
import { Repeat } from "lucide-react";
import { activityColorVar, activityName } from "../lib/activity";
import type { Plan } from "../lib/bindings";
import type { PlanOccurrence } from "../lib/plans";
import type { DayEntry } from "../lib/stats";
import { formatClock, formatDuration } from "../lib/time";
import { hoverProps, hoverStateOf } from "../lib/useHover";
import { useUi } from "../stores/ui";
import "./Timeline.css";

interface Props {
  entries: DayEntry[];
  plans: PlanOccurrence[];
  onEntryClick: (entry: DayEntry) => void;
  onPlanClick: (plan: Plan) => void;
}

type Row = { kind: "entry"; startMs: number; entry: DayEntry } | { kind: "plan"; startMs: number; plan: PlanOccurrence };

/** Logged time (solid bar) and plans (dashed bar), in time order. */
export function Timeline({ entries, plans, onEntryClick, onPlanClick }: Props) {
  const { t, i18n } = useTranslation();
  const hoverKey = useUi((s) => s.hoverKey);
  const hoverAlso = useUi((s) => s.hoverAlso);
  const clock = (ms: number) => formatClock(ms, i18n.language);
  const rows: Row[] = [
    ...entries.map((e): Row => ({ kind: "entry", startMs: e.startMs, entry: e })),
    ...plans.map((p): Row => ({ kind: "plan", startMs: p.startMs, plan: p })),
  ].sort((a, b) => a.startMs - b.startMs);

  return (
    <ol className="timeline">
      {rows.map((row) =>
        row.kind === "entry" ? (
          <li key={row.entry.key}>
            <button
              type="button"
              className="timeline-row is-entry"
              style={{ borderLeftColor: activityColorVar(row.entry.activity?.color) }}
              data-hover={hoverStateOf(hoverKey, hoverAlso, [row.entry.key])}
              {...hoverProps(row.entry.key)}
              onClick={() => onEntryClick(row.entry)}
            >
            <span className="timeline-time tabular">
              {clock(row.entry.startMs)}–{row.entry.endMs === null ? t("today.now") : clock(row.entry.endMs)}
            </span>
            <span className="timeline-main">
              <span className={row.entry.activity ? "timeline-name" : "timeline-name is-unknown"}>
                {activityName(row.entry.activity, t, row.entry.parent)}
                {row.entry.autoLogged && <Repeat className="timeline-repeat" size={12} aria-label={t("plan.autoLogged")} />}
              </span>
              {row.entry.note && <span className="timeline-note">{row.entry.note}</span>}
            </span>
            <span className="timeline-duration tabular">{formatDuration(row.entry.durationMs)}</span>
            </button>
          </li>
        ) : (
          <li key={row.plan.key}>
            <button
              type="button"
              className="timeline-row is-plan"
              style={{ borderLeftColor: activityColorVar(row.plan.activity?.color) }}
              data-hover={hoverStateOf(hoverKey, hoverAlso, [row.plan.key])}
              {...hoverProps(row.plan.key)}
              onClick={() => onPlanClick(row.plan.plan)}
            >
              <span className="timeline-time tabular">
                {clock(row.plan.startMs)}–{clock(row.plan.endMs)}
              </span>
              <span className="timeline-main">
                <span className="timeline-name">
                  {activityName(row.plan.activity, t, row.plan.parent)}
                  {row.plan.plan.rule && <Repeat className="timeline-repeat" size={12} aria-label={t("plan.repeats")} />}
                </span>
              </span>
              <span className="timeline-duration tabular">{formatDuration(row.plan.endMs - row.plan.startMs)}</span>
            </button>
          </li>
        ),
      )}
    </ol>
  );
}

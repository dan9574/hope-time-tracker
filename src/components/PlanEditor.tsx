import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type Activity, type Plan } from "../lib/bindings";
import { makeRule, ruleDays } from "../lib/plans";
import { ActivityPicker } from "./ActivityPicker";
import { errorMessage } from "../lib/errors";
import { confirmDelete } from "../lib/confirm";
import { dateKey, weekDays } from "../lib/time";
import "./Sheet.css";

/** Starting values for a new plan (the schedule view pre-fills the clicked slot). */
export interface PlanPreset {
  days: number[];
  start: string;
  end: string;
}

interface Props {
  /** `null` creates a plan for `date`. */
  plan: Plan | null;
  date: Date;
  activities: Activity[];
  preset?: PlanPreset;
  onClose: () => void;
}

/** Modal sheet for creating or editing a plan. Recurring plans are edited as a whole series. */
export function PlanEditor({ plan, date, activities, preset, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [activityId, setActivityId] = useState(plan?.activity_id ?? activities[0]?.id ?? "");
  const [start, setStart] = useState(plan?.start_hm ?? preset?.start ?? "09:00");
  const [end, setEnd] = useState(plan?.end_hm ?? preset?.end ?? "10:00");
  const [days, setDays] = useState<number[]>(plan ? ruleDays(plan.rule) : (preset?.days ?? []));
  const [until, setUntil] = useState(plan?.until ?? "");
  const [autoLog, setAutoLog] = useState(plan?.auto_log ?? true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => ref.current?.showModal(), []);

  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "narrow" });
  const isoDays = weekDays(date).map((d, i) => ({ iso: i + 1, label: weekday.format(d) }));

  const save = async () => {
    if (!activityId) return setError(t("plan.needActivity"));
    if (start >= end) return setError(t("plan.endAfterStart"));
    const firstDay = plan?.rule && days.length > 0 ? plan.date : dateKey(date);
    if (days.length > 0 && until && until < firstDay) return setError(t("plan.untilBeforeStart"));
    const res = await commands.planUpsert({
      id: plan?.id ?? null,
      activity_id: activityId,
      // An existing series keeps its first day; anything else lands on the day being viewed.
      date: firstDay,
      start_hm: start,
      end_hm: end,
      rule: makeRule(days),
      auto_log: autoLog,
      until: days.length > 0 && until ? until : null,
    });
    if (res.status === "error") setError(errorMessage(res.error, t));
    else onClose();
  };
  const remove = async () => {
    if (!plan) return;
    const message = plan.rule ? t("plan.confirmDeleteSeries") : t("plan.confirmDelete");
    if (!(await confirmDelete(t, message))) return;
    const res = await commands.planDelete(plan.id);
    if (res.status === "error") setError(errorMessage(res.error, t));
    else onClose();
  };

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        className="sheet-body"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="sheet-title">{plan ? t("plan.edit") : t("plan.new")}</h2>

        <div className="sheet-row">
          <span>{t("plan.activity")}</span>
          <ActivityPicker activities={activities} value={activityId} onChange={setActivityId} />
        </div>
        <div className="sheet-row">
          <span>{t("plan.time")}</span>
          <span className="sheet-inline">
            <input type="time" className="settings-time tabular" value={start} onChange={(e) => setStart(e.target.value)} />
            –
            <input type="time" className="settings-time tabular" value={end} onChange={(e) => setEnd(e.target.value)} />
          </span>
        </div>
        <div className="sheet-row">
          <span>{t("plan.repeat")}</span>
          <span className="weekday-chips">
            {isoDays.map(({ iso, label }) => (
              <button
                key={iso}
                type="button"
                className="weekday-chip"
                aria-pressed={days.includes(iso)}
                onClick={() => setDays((d) => (d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso]))}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
        {days.length > 0 && (
          <>
            <label className="sheet-row">
              <span>{t("plan.until")}</span>
              <span className="sheet-inline">
                <input type="date" className="settings-time tabular" value={until} onChange={(e) => setUntil(e.target.value)} />
                {until && (
                  <button type="button" className="settings-button" onClick={() => setUntil("")}>
                    {t("plan.forever")}
                  </button>
                )}
              </span>
            </label>
            <label className="sheet-row">
              <span>{t("plan.autoLog")}</span>
              <input type="checkbox" className="sheet-check" checked={autoLog} onChange={(e) => setAutoLog(e.target.checked)} />
            </label>
          </>
        )}
        <p className="sheet-note">
          {days.length === 0 ? t("plan.onceHint") : autoLog ? t("plan.autoLogHint") : t("plan.seriesHint")}
        </p>
        {error && <p className="sheet-error">{error}</p>}

        <div className="sheet-actions">
          {plan && (
            <button type="button" className="settings-button" onClick={() => void remove()}>
              {plan.rule ? t("plan.deleteSeries") : t("common.delete")}
            </button>
          )}
          <span className="sheet-spacer" />
          <button type="button" className="settings-button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="settings-button is-primary">
            {t("common.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Repeat } from "lucide-react";
import { Page } from "../components/Page";
import { PlanEditor, type PlanPreset } from "../components/PlanEditor";
import { activityColorVar, activityName, indexById, parentOf } from "../lib/activity";
import { commands, type Plan } from "../lib/bindings";
import { useQuery, useSetting } from "../lib/data";
import { ruleDays } from "../lib/plans";
import { DEFAULT_SLEEP, DEFAULT_WAKE, PREF } from "../lib/preferences";
import { dateKey, weekDays } from "../lib/time";
import "./Schedule.css";

const HOUR_PX = 40;
const SLOT_MIN = 30;

const minutes = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h! * 60 + m!;
};
const toHm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

interface Block {
  plan: Plan;
  start: number;
  end: number;
  lane: number;
  lanes: number;
}

/** Side-by-side lanes for plans that overlap within one day. */
function layout(plans: Plan[]): Block[] {
  const blocks = plans
    .map((plan) => ({ plan, start: minutes(plan.start_hm), end: minutes(plan.end_hm), lane: 0, lanes: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: Block[] = [];
  let groupEnd = -1;
  const flush = () => group.forEach((b) => (b.lanes = Math.max(...group.map((g) => g.lane)) + 1));
  for (const b of blocks) {
    if (b.start >= groupEnd) {
      flush();
      group = [];
    }
    const used = new Set(group.filter((g) => g.end > b.start).map((g) => g.lane));
    while (used.has(b.lane)) b.lane++;
    group.push(b);
    groupEnd = Math.max(groupEnd, b.end);
  }
  flush();
  return blocks;
}

/** Weekly timetable of recurring plans (rebuild-plan 10 F). */
export function Schedule() {
  const { t, i18n } = useTranslation();
  const today = new Date();
  const todayKey = dateKey(today);
  const plans = useQuery(() => commands.planList({ from: todayKey, to: "9999-12-31" }), [todayKey]);
  const activities = useQuery(() => commands.activityList(true), []) ?? [];
  const wakeHm = useSetting(PREF.wake) ?? DEFAULT_WAKE;
  const sleepHm = useSetting(PREF.sleep) ?? DEFAULT_SLEEP;
  const [editing, setEditing] = useState<{ plan: Plan | null; preset?: PlanPreset } | null>(null);

  const byId = indexById(activities);
  const recurring = (plans ?? []).filter((p) => p.rule !== null);
  const days = weekDays(today);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });

  // Show the waking day, widened to fit every plan.
  const sleepMin = minutes(sleepHm) <= minutes(wakeHm) ? 24 * 60 : minutes(sleepHm);
  const fromMin = Math.floor(Math.min(minutes(wakeHm), ...recurring.map((p) => minutes(p.start_hm))) / 60) * 60;
  const toMin = Math.ceil(Math.max(sleepMin, ...recurring.map((p) => minutes(p.end_hm))) / 60) * 60;
  const hours = Array.from({ length: (toMin - fromMin) / 60 }, (_, i) => fromMin / 60 + i);
  const top = (min: number) => ((min - fromMin) / 60) * HOUR_PX;

  const addAt = (iso: number, e: React.MouseEvent<HTMLDivElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const start = Math.min(fromMin + Math.floor(((y / HOUR_PX) * 60) / SLOT_MIN) * SLOT_MIN, toMin - 60);
    setEditing({ plan: null, preset: { days: [iso], start: toHm(start), end: toHm(start + 60) } });
  };

  return (
    <Page title={t("nav.schedule")} subtitle={t("views.schedule.subtitle")}>
      <div className="schedule">
        <div className="schedule-head">
          <span />
          {days.map((d) => (
            <span key={d.getDay()} className={dateKey(d) === todayKey ? "is-today" : undefined}>
              {weekday.format(d)}
            </span>
          ))}
        </div>
        <div className="schedule-body" style={{ height: hours.length * HOUR_PX }}>
          <div className="schedule-hours">
            {hours.map((h) => (
              <span key={h} style={{ top: top(h * 60) }}>
                {toHm((h % 24) * 60)}
              </span>
            ))}
          </div>
          {days.map((_, i) => {
            const iso = i + 1;
            const blocks = layout(recurring.filter((p) => ruleDays(p.rule).includes(iso)));
            return (
              <div key={iso} className="schedule-day" onClick={(e) => addAt(iso, e)}>
                {hours.map((h) => (
                  <span key={h} className="schedule-line" style={{ top: top(h * 60) }} />
                ))}
                {blocks.map((b) => {
                  const activity = byId.get(b.plan.activity_id);
                  const color = activityColorVar(activity?.color);
                  return (
                    <button
                      key={b.plan.id}
                      type="button"
                      className="schedule-block"
                      style={{
                        top: top(b.start),
                        height: Math.max(top(b.end) - top(b.start), HOUR_PX / 2),
                        left: `${(b.lane / b.lanes) * 100}%`,
                        width: `${100 / b.lanes}%`,
                        borderLeftColor: color,
                        background: `color-mix(in srgb, ${color} 28%, transparent)`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing({ plan: b.plan });
                      }}
                    >
                      <span className="schedule-block-name">
                        {activityName(activity, t, parentOf(activity, byId))}
                        {b.plan.auto_log && <Repeat size={10} aria-label={t("plan.autoLog")} />}
                      </span>
                      <span className="schedule-block-time tabular">
                        {b.plan.start_hm}–{b.plan.end_hm}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        {plans && recurring.length === 0 && <p className="schedule-empty">{t("schedule.empty")}</p>}
      </div>

      {editing && (
        <PlanEditor
          plan={editing.plan}
          preset={editing.preset}
          date={today}
          activities={activities.filter((a) => a.archived_at === null)}
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  );
}

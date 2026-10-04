import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play } from "lucide-react";
import { commands } from "../lib/bindings";
import { activityName, indexById, parentOf } from "../lib/activity";
import { run, useQuery } from "../lib/data";
import { formatElapsed, timerElapsed } from "../lib/time";
import { useNow } from "../lib/useNow";
import { ActivityDot } from "./ActivityDot";
import "./TimerButton.css";

/** Window counterpart of the tray icon: opens the same native menu. */
export function TimerButton() {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useQuery(() => commands.sessionCurrent(), []);
  const activities = useQuery(() => commands.activityList(true), []);
  const now = useNow(timer?.running ? 1000 : 60_000);

  const current = timer?.running ?? timer?.paused ?? null;
  const byId = indexById(activities);
  const activity = current ? byId.get(current.activity_id) : undefined;
  const label = activityName(activity, t, parentOf(activity, byId));

  const openMenu = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    void run(commands.timerMenuPopup(Math.round(rect.left), Math.round(rect.bottom + 4)));
  };

  return (
    <button ref={ref} type="button" className="timer-button" onClick={openMenu} aria-haspopup="menu">
      {timer?.running ? (
        <>
          <ActivityDot color={activity?.color} />
          <span className="timer-button-name">{label}</span>
          <span className="tabular">{formatElapsed(timerElapsed(timer, now))}</span>
        </>
      ) : timer?.paused ? (
        <>
          <Pause size={14} strokeWidth={2} aria-hidden />
          <span className="timer-button-name">{label}</span>
          <span className="timer-button-muted">{t("timer.paused")}</span>
        </>
      ) : (
        <>
          <Play size={14} strokeWidth={2} aria-hidden />
          <span>{t("timer.start")}</span>
        </>
      )}
    </button>
  );
}

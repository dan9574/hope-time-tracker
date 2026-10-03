import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useUi, type View } from "../stores/ui";
import { commands } from "../lib/bindings";
import { useLocalePreference, useThemePreference } from "../lib/preferences";
import { TimerButton } from "../components/TimerButton";
import { useNow } from "../lib/useNow";
import { useToday, utcOffsetMin } from "../lib/useToday";
import { Sidebar } from "./Sidebar";
import { Today } from "../views/Today";
import { Week } from "../views/Week";
import { Month } from "../views/Month";
import { Activities } from "../views/Activities";
import { Settings } from "../views/Settings";
import "./App.css";

const VIEW_COMPONENTS: Record<View, () => JSX.Element> = {
  today: Today,
  week: Week,
  month: Month,
  activities: Activities,
  settings: Settings,
};

/** The tray menu is built in Rust; hand it the localized labels whenever the language changes. */
function useTrayStrings() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    void commands.traySetStrings({
      pause: t("tray.pause"),
      resume: t("tray.resume", { name: "{name}" }),
      stop: t("tray.stop"),
      no_activities: t("tray.noActivities"),
      unknown_activity: t("activity.unknown"),
      open: t("tray.open"),
      quit: t("tray.quit"),
      wake: t("day.wake"),
      sleep: t("day.sleep"),
    });
  }, [t, i18n.language]);
}

/** Keeps the tray's wake/sleep item in step with the same time windows as the Today button. */
function useTrayDayAction() {
  const now = useNow(60_000);
  const { button } = useToday(now);
  const action = button && button.kind !== "undo" ? { kind: button.kind, date: button.date, utc_offset_min: utcOffsetMin() } : null;
  const key = action ? `${action.kind}:${action.date}` : "";
  useEffect(() => {
    void commands.traySetDayAction(action);
  }, [key]);
}

export function App() {
  const view = useUi((s) => s.view);
  const Current = VIEW_COMPONENTS[view];
  useLocalePreference();
  useThemePreference();
  useTrayStrings();
  useTrayDayAction();

  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <div className="titlebar content-titlebar" data-tauri-drag-region>
          <TimerButton />
        </div>
        <div className="content-scroll">
          <Current />
        </div>
      </main>
    </div>
  );
}

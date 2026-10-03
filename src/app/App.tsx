import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useUi, type View } from "../stores/ui";
import { commands } from "../lib/bindings";
import { TimerButton } from "../components/TimerButton";
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
    });
  }, [t, i18n.language]);
}

export function App() {
  const view = useUi((s) => s.view);
  const Current = VIEW_COMPONENTS[view];
  useTrayStrings();

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

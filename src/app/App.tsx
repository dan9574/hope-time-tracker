import { useUi, type View } from "../stores/ui";
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

export function App() {
  const view = useUi((s) => s.view);
  const Current = VIEW_COMPONENTS[view];

  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <div className="titlebar" data-tauri-drag-region />
        <div className="content-scroll">
          <Current />
        </div>
      </main>
    </div>
  );
}

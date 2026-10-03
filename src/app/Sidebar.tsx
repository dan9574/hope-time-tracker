import { useTranslation } from "react-i18next";
import { CalendarDays, CalendarRange, Settings, Shapes, Sun, type LucideIcon } from "lucide-react";
import { useUi, VIEWS, type View } from "../stores/ui";

const ICONS: Record<View, LucideIcon> = {
  today: Sun,
  week: CalendarRange,
  month: CalendarDays,
  activities: Shapes,
  settings: Settings,
};

export function Sidebar() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);

  return (
    <nav className="sidebar">
      <div className="titlebar" data-tauri-drag-region />
      <ul className="sidebar-list">
        {VIEWS.map((v) => {
          const Icon = ICONS[v];
          return (
            <li key={v}>
              <button
                type="button"
                className="sidebar-item"
                aria-current={v === view ? "page" : undefined}
                onClick={() => setView(v)}
              >
                <Icon className="sidebar-icon" size={16} strokeWidth={1.75} aria-hidden />
                {t(`nav.${v}`)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

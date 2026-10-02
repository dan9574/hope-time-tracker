import { useTranslation } from "react-i18next";
import { useUi, VIEWS } from "../stores/ui";

export function Sidebar() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);

  return (
    <nav className="sidebar">
      <div className="titlebar" data-tauri-drag-region />
      <ul className="sidebar-list">
        {VIEWS.map((v) => (
          <li key={v}>
            <button
              type="button"
              className="sidebar-item"
              aria-current={v === view ? "page" : undefined}
              onClick={() => setView(v)}
            >
              {t(`nav.${v}`)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

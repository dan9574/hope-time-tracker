import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ColorPicker } from "../components/ColorPicker";
import { commands, type Activity, type ActivityColor } from "../lib/bindings";
import { activityColorVar } from "../lib/activity";
import { SYMBOLS } from "../lib/symbols";

interface Props {
  /** `null` creates a new activity. */
  activity: Activity | null;
  onClose: () => void;
}

export function ActivityEditor({ activity, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(activity?.name ?? "");
  const [color, setColor] = useState<ActivityColor>(activity?.color ?? "blue");
  const [symbol, setSymbol] = useState<string | null>(activity?.symbol ?? null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return setError(t("activities.nameRequired"));
    const res = await commands.activityUpsert({ id: activity?.id ?? null, name, color, symbol, sort: null });
    if (res.status === "error") setError(res.error);
    else onClose();
  };
  const archive = async () => {
    if (!activity) return;
    const res = await commands.activityArchive(activity.id, true);
    if (res.status === "error") setError(res.error);
    else onClose();
  };

  return (
    <form
      className="activity-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <input
        className="activity-editor-name"
        value={name}
        autoFocus
        placeholder={t("activities.namePlaceholder")}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="activity-editor-row">
        <span className="activity-editor-label">{t("activities.color")}</span>
        <ColorPicker label={t("activities.color")} value={color} onChange={setColor} />
      </div>
      <div className="activity-editor-row is-top">
        <span className="activity-editor-label">{t("activities.symbol")}</span>
        <div className="symbol-grid" role="radiogroup" aria-label={t("activities.symbol")}>
          <button
            type="button"
            role="radio"
            aria-checked={symbol === null}
            className="symbol-option"
            onClick={() => setSymbol(null)}
          >
            <span className="symbol-none" style={{ background: activityColorVar(color) }} />
          </button>
          {SYMBOLS.map(([sfName, Icon]) => (
            <button
              key={sfName}
              type="button"
              role="radio"
              aria-checked={symbol === sfName}
              aria-label={sfName}
              className="symbol-option"
              style={symbol === sfName ? { color: activityColorVar(color) } : undefined}
              onClick={() => setSymbol(sfName)}
            >
              <Icon size={16} strokeWidth={2} aria-hidden />
            </button>
          ))}
        </div>
      </div>
      {error && <p className="activity-editor-error">{error}</p>}
      <div className="activity-editor-actions">
        {activity && (
          <button type="button" className="settings-button" onClick={() => void archive()}>
            {t("activities.archive")}
          </button>
        )}
        <span className="activity-editor-spacer" />
        <button type="button" className="settings-button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="settings-button is-primary">
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}

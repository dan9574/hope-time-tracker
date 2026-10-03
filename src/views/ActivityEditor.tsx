import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ColorPicker } from "../components/ColorPicker";
import { commands, type Activity, type ActivityColor } from "../lib/bindings";
import { activityColorVar } from "../lib/activity";
import { SYMBOLS } from "../lib/symbols";

interface Props {
  /** `null` creates a new activity. */
  activity: Activity | null;
  /** Parent for a new sub-activity, or the current parent of an existing one. */
  parentId: string | null;
  /** Live top-level activities, for moving a sub-activity under another parent. */
  roots: Activity[];
  /** Live sub-activities of `activity`; an activity that has some must stay top-level. */
  childCount: number;
  onClose: () => void;
}

export function ActivityEditor({ activity, parentId: initialParent, roots, childCount, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(activity?.name ?? "");
  const [color, setColor] = useState<ActivityColor>(activity?.color ?? "blue");
  const [symbol, setSymbol] = useState<string | null>(activity?.symbol ?? null);
  const [parentId, setParentId] = useState<string | null>(initialParent);
  const [error, setError] = useState<string | null>(null);

  const parent = roots.find((r) => r.id === parentId);
  // Sub-activities show their parent's color; an activity with children cannot be moved under another.
  const shownColor = parent?.color ?? color;
  const parentChoices = roots.filter((r) => r.id !== activity?.id);

  const save = async () => {
    if (!name.trim()) return setError(t("activities.nameRequired"));
    const res = await commands.activityUpsert({
      id: activity?.id ?? null,
      name,
      color: shownColor,
      symbol,
      sort: null,
      parent_id: parentId,
    });
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
        placeholder={parent ? t("activities.subNamePlaceholder", { name: parent.name }) : t("activities.namePlaceholder")}
        onChange={(e) => setName(e.target.value)}
      />
      {childCount === 0 && (activity || parentId) && (
        <label className="activity-editor-row">
          <span className="activity-editor-label">{t("activities.parent")}</span>
          <select className="settings-select" value={parentId ?? ""} onChange={(e) => setParentId(e.target.value || null)}>
            <option value="">{t("activities.topLevel")}</option>
            {parentChoices.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="activity-editor-row">
        <span className="activity-editor-label">{t("activities.color")}</span>
        {parent ? (
          <span className="activity-editor-note">{t("activities.colorFollows", { name: parent.name })}</span>
        ) : (
          <ColorPicker label={t("activities.color")} value={color} onChange={setColor} />
        )}
      </div>
      <div className="activity-editor-row is-top">
        <span className="activity-editor-label">{t("activities.symbol")}</span>
        <div className="symbol-grid" role="radiogroup" aria-label={t("activities.symbol")}>
          <button type="button" role="radio" aria-checked={symbol === null} className="symbol-option" onClick={() => setSymbol(null)}>
            <span className="symbol-none" style={{ background: activityColorVar(shownColor) }} />
          </button>
          {SYMBOLS.map(([sfName, Icon]) => (
            <button
              key={sfName}
              type="button"
              role="radio"
              aria-checked={symbol === sfName}
              aria-label={sfName}
              className="symbol-option"
              style={symbol === sfName ? { color: activityColorVar(shownColor) } : undefined}
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

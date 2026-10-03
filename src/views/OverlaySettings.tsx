import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "../lib/bindings";
import { run, useSetting } from "../lib/data";
import {
  CARDS,
  OPACITY_MAX,
  OPACITY_MIN,
  OVERLAY_CARDS,
  OVERLAY_ENABLED,
  OVERLAY_OPACITY,
  parseCards,
  parseOpacity,
  type CardId,
} from "../overlay/settings";

const CARD_LABEL: Record<CardId, string> = {
  now: "settings.cardNow",
  today: "settings.cardToday",
  week: "settings.cardWeek",
};

export function OverlaySettings() {
  const { t } = useTranslation();
  const enabled = useSetting(OVERLAY_ENABLED) !== "0";
  const cards = parseCards(useSetting(OVERLAY_CARDS));
  const storedOpacity = parseOpacity(useSetting(OVERLAY_OPACITY));
  const [opacity, setOpacity] = useState(storedOpacity);
  const [editing, setEditing] = useState(false);

  useEffect(() => setOpacity(storedOpacity), [storedOpacity]);
  // Leaving Settings mid-edit must not strand the overlay above other windows.
  useEffect(() => () => void commands.overlaySetEditing(false), []);

  const toggleEnabled = (on: boolean) => {
    if (!on) setEditing(false);
    void run(on ? commands.overlayShow() : commands.overlayHide());
  };
  const toggleCard = (card: CardId, on: boolean) => {
    const next = CARDS.filter((c) => (c === card ? on : cards.has(c)));
    void run(commands.settingSet(OVERLAY_CARDS, next.join(",")));
  };
  const toggleEditing = () => {
    const next = !editing;
    setEditing(next);
    void run(commands.overlaySetEditing(next));
  };

  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{t("settings.overlay")}</h2>
      <div className="settings-rows">
        <label className="settings-row">
          <span>{t("settings.overlayShow")}</span>
          <input type="checkbox" checked={enabled} onChange={(e) => toggleEnabled(e.target.checked)} />
        </label>
        <div className="settings-row">
          <span>{t("settings.overlayCards")}</span>
          <span className="settings-inline">
            {CARDS.map((c) => (
              <label key={c} className="settings-check">
                <input
                  type="checkbox"
                  checked={cards.has(c)}
                  disabled={!enabled}
                  onChange={(e) => toggleCard(c, e.target.checked)}
                />
                {t(CARD_LABEL[c])}
              </label>
            ))}
          </span>
        </div>
        <label className="settings-row">
          <span>{t("settings.overlayOpacity")}</span>
          <span className="settings-inline">
            <input
              type="range"
              min={OPACITY_MIN}
              max={OPACITY_MAX}
              step={0.05}
              value={opacity}
              disabled={!enabled}
              onChange={(e) => setOpacity(Number(e.target.value))}
              onPointerUp={() => void run(commands.settingSet(OVERLAY_OPACITY, String(opacity)))}
              onKeyUp={() => void run(commands.settingSet(OVERLAY_OPACITY, String(opacity)))}
            />
            <span className="settings-value tabular">{Math.round(opacity * 100)}%</span>
          </span>
        </label>
        <div className="settings-row">
          <span>{t("settings.overlayPosition")}</span>
          <span className="settings-inline">
            <button type="button" className="settings-button" disabled={!enabled || editing} onClick={() => void run(commands.overlayResetPosition())}>
              {t("settings.resetPosition")}
            </button>
            <button type="button" className="settings-button" disabled={!enabled} aria-pressed={editing} onClick={toggleEditing}>
              {editing ? t("settings.done") : t("settings.adjustPosition")}
            </button>
          </span>
        </div>
      </div>
    </section>
  );
}

import { useTranslation } from "react-i18next";
import { Segmented } from "../../components/Segmented";
import { ColorPicker } from "../../components/ColorPicker";
import { commands, type ActivityColor } from "../../lib/bindings";
import { run, useSetting } from "../../lib/data";
import { APPEARANCES, DEFAULT_SLEEP, DEFAULT_WAKE, PREF, RING_WIDTHS, TINTS, type Appearance, type Tint } from "../../lib/preferences";

const save = (key: string, value: string) => void run(commands.settingSet(key, value));

export function GeneralSettings() {
  const { t } = useTranslation();
  const locale = useSetting(PREF.locale) ?? "system";

  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{t("settings.general")}</h2>
      <div className="settings-rows">
        <label className="settings-row">
          <span>{t("settings.language")}</span>
          <select className="settings-select" value={locale} onChange={(e) => save(PREF.locale, e.target.value)}>
            <option value="system">{t("settings.languageSystem")}</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
    </section>
  );
}

export function ScheduleSettings() {
  const { t } = useTranslation();
  const wake = useSetting(PREF.wake) ?? DEFAULT_WAKE;
  const sleep = useSetting(PREF.sleep) ?? DEFAULT_SLEEP;

  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{t("settings.schedule")}</h2>
      <div className="settings-rows">
        <label className="settings-row">
          <span>{t("settings.wake")}</span>
          <TimeInput value={wake} onCommit={(v) => save(PREF.wake, v)} />
        </label>
        <label className="settings-row">
          <span>{t("settings.sleep")}</span>
          <TimeInput value={sleep} onCommit={(v) => save(PREF.sleep, v)} />
        </label>
      </div>
      <p className="settings-footnote">{t("settings.scheduleHint")}</p>
    </section>
  );
}

/** Native time field; saves complete values only. */
export function TimeInput({ value, onCommit }: { value: string; onCommit: (hm: string) => void }) {
  return (
    <input
      type="time"
      className="settings-time tabular"
      defaultValue={value}
      key={value}
      onBlur={(e) => {
        if (/^\d{2}:\d{2}$/.test(e.target.value) && e.target.value !== value) onCommit(e.target.value);
      }}
    />
  );
}

export function AppearanceSettings() {
  const { t } = useTranslation();
  const appearance = (useSetting(PREF.appearance) ?? "system") as Appearance;
  const tint = (useSetting(PREF.tint) ?? "clear") as Tint;
  const accent = (useSetting(PREF.accent) ?? "blue") as ActivityColor;
  const ring = useSetting(PREF.ring) === "16" ? "16" : "10";

  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{t("settings.appearance")}</h2>
      <div className="settings-rows">
        <div className="settings-row">
          <span>{t("settings.appearanceMode")}</span>
          <Segmented
            label={t("settings.appearanceMode")}
            value={appearance}
            options={APPEARANCES.map((v) => ({ value: v, label: t(`settings.appearance_${v}`) }))}
            onChange={(v) => save(PREF.appearance, v)}
          />
        </div>
        <div className="settings-row">
          <span>{t("settings.tint")}</span>
          <Segmented
            label={t("settings.tint")}
            value={tint}
            options={TINTS.map((v) => ({ value: v, label: t(`settings.tint_${v}`) }))}
            onChange={(v) => save(PREF.tint, v)}
          />
        </div>
        <div className="settings-row">
          <span>{t("settings.accent")}</span>
          <ColorPicker label={t("settings.accent")} value={accent} onChange={(c) => save(PREF.accent, c)} />
        </div>
        <div className="settings-row">
          <span>{t("settings.ringWidth")}</span>
          <Segmented
            label={t("settings.ringWidth")}
            value={ring}
            options={RING_WIDTHS.map((w) => ({ value: String(w) as "10" | "16", label: t(`settings.ring_${w}`) }))}
            onChange={(v) => save(PREF.ring, v)}
          />
        </div>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type Day } from "../lib/bindings";
import { errorMessage } from "../lib/errors";
import { atClock, DAY } from "../lib/time";
import { utcOffsetMin } from "../lib/useToday";
import "./Sheet.css";

interface Props {
  which: "wake" | "sleep";
  /** The day being edited (its wake-up date). */
  date: Date;
  dateKey: string;
  day: Day | undefined;
  /** What the label currently shows (actual or default). */
  currentMs: number;
  onClose: () => void;
}

const hm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Edit one day's actual wake-up or bedtime from the ring's end labels; "Use default" clears it. */
export function DayTimeEditor({ which, date, dateKey, day, currentMs, onClose }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(hm(currentMs));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => ref.current?.showModal(), []);

  const save = async (ms: number | null) => {
    const input = {
      date: dateKey,
      wake_ms: which === "wake" ? ms : (day?.wake_ms ?? null),
      sleep_ms: which === "sleep" ? ms : (day?.sleep_ms ?? null),
      utc_offset_min: day?.utc_offset_min ?? utcOffsetMin(),
    };
    const res = await commands.daySet(input);
    if (res.status === "error") setError(errorMessage(res.error, t));
    else onClose();
  };

  const submit = () => {
    let ms = atClock(date, value);
    if (ms === null) return setError(t("record.badTime"));
    // A bedtime earlier than the wake-up is after midnight.
    const wake = day?.wake_ms ?? null;
    if (which === "sleep" && ms <= (wake ?? atClock(date, "04:00")!)) ms += DAY;
    void save(ms);
  };

  return (
    <dialog ref={ref} className="sheet is-narrow" onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        className="sheet-body"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="sheet-title">{which === "wake" ? t("day.editWake") : t("day.editSleep")}</h2>
        <label className="sheet-row">
          <span>{t("plan.time")}</span>
          <input type="time" className="settings-time tabular" value={value} required autoFocus onChange={(e) => setValue(e.target.value)} />
        </label>
        <p className="sheet-note">{which === "wake" ? t("day.editWakeHint") : t("day.editSleepHint")}</p>
        {error && <p className="sheet-error">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="settings-button" onClick={() => void save(null)}>
            {t("day.useDefault")}
          </button>
          <span className="sheet-spacer" />
          <button type="button" className="settings-button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="settings-button is-primary">
            {t("common.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

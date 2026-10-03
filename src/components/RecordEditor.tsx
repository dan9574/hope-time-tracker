import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type Activity, type SessionInput } from "../lib/bindings";
import { activityName, indexById } from "../lib/activity";
import { confirmDelete } from "../lib/confirm";
import { errorMessage } from "../lib/errors";
import type { DayEntry } from "../lib/stats";
import { atClock, dateKey, formatClock, MINUTE } from "../lib/time";
import { ActivityPicker } from "./ActivityPicker";
import "./Sheet.css";

interface Props {
  /** `null` adds a past record by hand. */
  entry: DayEntry | null;
  /** All activities (for labels); only live ones can be picked. */
  activities: Activity[];
  /** Day a new record starts on. */
  date: Date;
  onClose: () => void;
}

/** One segment of the record; `end` is null while it is still running. */
interface Segment {
  id: string | null;
  start: string;
  end: string | null;
}

const hm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const roundDown = (ms: number, step = 5 * MINUTE) => Math.floor(ms / step) * step;
const parseDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};

/**
 * Edit, add or delete a record. A pause/resume chain is edited as one record: activity, note and day
 * apply to every segment; each segment keeps its own times. Overlaps are rejected by Rust, never trimmed.
 */
export function RecordEditor({ entry, activities, date, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const byId = indexById(activities);
  const live = activities.filter((a) => a.archived_at === null);

  const [activityId, setActivityId] = useState(entry?.activityId ?? live[0]?.id ?? "");
  const [day, setDay] = useState(dateKey(entry ? new Date(entry.startMs) : date));
  const [note, setNote] = useState(entry?.note ?? "");
  const [segments, setSegments] = useState<Segment[]>(() => {
    if (entry) return entry.sessions.map((s) => ({ id: s.id, start: hm(s.start_ms), end: s.end_ms === null ? null : hm(s.end_ms) }));
    const end = roundDown(Date.now());
    return [{ id: null, start: hm(end - 60 * MINUTE), end: hm(end) }];
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => ref.current?.showModal(), []);
  // A new record defaults to the first activity once the list has loaded.
  useEffect(() => {
    if (!activityId && live[0]) setActivityId(live[0].id);
  }, [activityId, live[0]?.id]);

  const setSegment = (i: number, patch: Partial<Segment>) =>
    setSegments((segs) => segs.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const save = async () => {
    if (!activityId) return setError(t("plan.needActivity"));
    const base = parseDate(day);
    const inputs: SessionInput[] = [];
    for (const [i, seg] of segments.entries()) {
      const start = atClock(base, seg.start);
      const end = seg.end === null ? null : atClock(base, seg.end);
      if (start === null || (seg.end !== null && end === null)) return setError(t("record.badTime"));
      if (end !== null && end < start) return setError(t("plan.endAfterStart"));
      inputs.push({
        id: seg.id,
        activity_id: activityId,
        start_ms: start,
        end_ms: end,
        // The note lives on the first segment; the rest are cleared so it shows once.
        note: i === 0 ? note : null,
      });
    }
    const res = await commands.sessionSave(inputs);
    if (res.status === "error") setError(errorMessage(res.error, t));
    else onClose();
  };

  const remove = async () => {
    if (!entry) return;
    const label = activityName(entry.activity, t, entry.parent);
    const range = `${formatClock(entry.startMs, i18n.language)}–${entry.endMs === null ? t("today.now") : formatClock(entry.endMs, i18n.language)}`;
    if (!(await confirmDelete(t, t("record.confirmDelete", { name: label, range })))) return;
    const res = await commands.sessionDeleteMany(entry.sessions.map((s) => s.id));
    if (res.status === "error") setError(errorMessage(res.error, t));
    else onClose();
  };

  const selected = byId.get(activityId);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        className="sheet-body"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="sheet-title">{entry ? t("record.edit") : t("record.new")}</h2>

        <div className="sheet-row">
          <span>{t("plan.activity")}</span>
          <ActivityPicker
            activities={selected && !live.includes(selected) ? [...live, selected] : live}
            value={activityId}
            onChange={setActivityId}
          />
        </div>
        <label className="sheet-row">
          <span>{t("record.date")}</span>
          <input type="date" className="settings-time tabular" value={day} required onChange={(e) => setDay(e.target.value)} />
        </label>
        {segments.map((seg, i) => (
          <div key={seg.id ?? i} className="sheet-row">
            <span>{segments.length > 1 ? t("record.segment", { n: i + 1 }) : t("plan.time")}</span>
            <span className="sheet-inline">
              <input
                type="time"
                className="settings-time tabular"
                value={seg.start}
                required
                onChange={(e) => setSegment(i, { start: e.target.value })}
              />
              –
              {seg.end === null ? (
                <span className="sheet-running">{t("record.running")}</span>
              ) : (
                <input
                  type="time"
                  className="settings-time tabular"
                  value={seg.end}
                  required
                  onChange={(e) => setSegment(i, { end: e.target.value })}
                />
              )}
            </span>
          </div>
        ))}
        <label className="sheet-row is-stacked">
          <span>{t("record.note")}</span>
          <textarea className="sheet-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="sheet-error">{error}</p>}

        <div className="sheet-actions">
          {entry && (
            <button type="button" className="settings-button" onClick={() => void remove()}>
              {t("common.delete")}
            </button>
          )}
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

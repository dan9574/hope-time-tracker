import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { activityName, indexById, parentOf } from "../lib/activity";
import { buildTree } from "../lib/activityTree";
import type { Activity } from "../lib/bindings";
import { ActivityDot } from "./ActivityDot";
import "./ActivityPicker.css";

interface Props {
  /** Live (non-archived) activities. */
  activities: Activity[];
  value: string;
  onChange: (id: string) => void;
}

/** Two-level picker: click a parent to pick it; the arrow beside a parent reveals its sub-activities. */
export function ActivityPicker({ activities, value, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const byId = indexById(activities);
  const selected = byId.get(value);
  const tree = buildTree(activities);

  // Opening reveals the branch holding the current choice.
  useEffect(() => {
    if (open && selected?.parent_id) setExpanded((e) => new Set(e).add(selected.parent_id!));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      className="picker"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button type="button" className="picker-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ActivityDot color={selected?.color} />
        <span className="picker-label">{selected ? activityName(selected, t, parentOf(selected, byId)) : t("plan.needActivity")}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <ul className="picker-menu" role="listbox">
          {tree.map(({ activity: a, children }) => (
            <li key={a.id}>
              <div className="picker-row">
                <button type="button" role="option" aria-selected={a.id === value} className="picker-option" onClick={() => pick(a.id)}>
                  <ActivityDot color={a.color} />
                  <span className="picker-label">{a.name}</span>
                </button>
                {children.length > 0 && (
                  <button
                    type="button"
                    className="picker-expand"
                    aria-label={t("activities.showSub")}
                    aria-expanded={expanded.has(a.id)}
                    onClick={() => toggle(a.id)}
                  >
                    <ChevronRight size={14} className={expanded.has(a.id) ? "is-open" : undefined} aria-hidden />
                  </button>
                )}
              </div>
              {expanded.has(a.id) &&
                children.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={c.id === value}
                    className="picker-option is-child"
                    onClick={() => pick(c.id)}
                  >
                    <span className="picker-label">{c.name}</span>
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import { ActivityDot } from "../components/ActivityDot";
import { Page } from "../components/Page";
import { commands, type Activity } from "../lib/bindings";
import { run, useQuery } from "../lib/data";
import { activityColorVar } from "../lib/activity";
import { symbolIcon } from "../lib/symbols";
import { ActivityEditor } from "./ActivityEditor";
import "./Activities.css";

/** `null` = closed, `"new"` = creating, otherwise the id being edited. */
type Editing = string | "new" | null;

export function Activities() {
  const { t } = useTranslation();
  const all = useQuery(() => commands.activityList(true), []);
  const [editing, setEditing] = useState<Editing>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = (all ?? []).filter((a) => a.archived_at === null);
  const archived = (all ?? []).filter((a) => a.archived_at !== null);
  const order = useDragOrder(active);

  return (
    <Page title={t("nav.activities")} subtitle={t("views.activities.subtitle")}>
      <ul className="activity-list" onDragOver={(e) => e.preventDefault()}>
        {order.items.map((a) =>
          editing === a.id ? (
            <li key={a.id} className="activity-editing">
              <ActivityEditor activity={a} onClose={() => setEditing(null)} />
            </li>
          ) : (
            <li
              key={a.id}
              className={order.dragging === a.id ? "activity-row is-dragging" : "activity-row"}
              draggable={editing === null}
              onDragStart={(e) => order.start(e, a.id)}
              onDragEnter={() => order.over(a.id)}
              onDragEnd={order.end}
            >
              <GripVertical className="activity-grip" size={14} aria-hidden />
              <button type="button" className="activity-open" onClick={() => setEditing(a.id)}>
                <ActivityGlyph activity={a} />
                <span className="activity-name">{a.name}</span>
                <ChevronRight className="activity-chevron" size={14} aria-hidden />
              </button>
            </li>
          ),
        )}
        {editing === "new" ? (
          <li className="activity-editing">
            <ActivityEditor activity={null} onClose={() => setEditing(null)} />
          </li>
        ) : (
          <li>
            <button type="button" className="activity-add" onClick={() => setEditing("new")}>
              <Plus size={14} aria-hidden />
              {t("activities.add")}
            </button>
          </li>
        )}
      </ul>

      {archived.length > 0 && (
        <section className="activity-archived">
          <button type="button" className="activity-archived-toggle" onClick={() => setShowArchived((v) => !v)}>
            <ChevronRight size={14} className={showArchived ? "is-open" : undefined} aria-hidden />
            {t("activities.archived", { count: archived.length })}
          </button>
          {showArchived && (
            <ul className="activity-list">
              {archived.map((a) => (
                <li key={a.id} className="activity-row is-archived">
                  <ActivityGlyph activity={a} />
                  <span className="activity-name">{a.name}</span>
                  <button
                    type="button"
                    className="settings-button"
                    onClick={() => void run(commands.activityArchive(a.id, false))}
                  >
                    {t("activities.restore")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Page>
  );
}

export function ActivityGlyph({ activity }: { activity: Activity }) {
  const Icon = symbolIcon(activity.symbol);
  if (!Icon) return <span className="activity-glyph"><ActivityDot color={activity.color} /></span>;
  return (
    <span className="activity-glyph" style={{ color: activityColorVar(activity.color) }}>
      <Icon size={16} strokeWidth={2} aria-hidden />
    </span>
  );
}

/** Live reordering while dragging; the new order is saved on drop. */
function useDragOrder(items: Activity[]) {
  const [order, setOrder] = useState(items);
  const [dragging, setDragging] = useState<string | null>(null);
  const key = items.map((a) => `${a.id}:${a.name}:${a.color}:${a.symbol}`).join("|");
  // Depend on content, not array identity, so refetches during a drag do not reset it.
  useEffect(() => setOrder(items), [key]);

  return {
    items: order,
    dragging,
    start: (e: React.DragEvent, id: string) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      setDragging(id);
    },
    over: (id: string) => {
      if (!dragging || dragging === id) return;
      setOrder((prev) => {
        const from = prev.findIndex((a) => a.id === dragging);
        const to = prev.findIndex((a) => a.id === id);
        const next = [...prev];
        next.splice(to, 0, ...next.splice(from, 1));
        return next;
      });
    },
    end: () => {
      setDragging(null);
      const ids = order.map((a) => a.id);
      if (ids.join() !== items.map((a) => a.id).join()) void run(commands.activityReorder(ids));
    },
  };
}

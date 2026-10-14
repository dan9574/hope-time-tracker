import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import { ActivityDot } from "../components/ActivityDot";
import { Page } from "../components/Page";
import { commands, type Activity } from "../lib/bindings";
import { run, useQuery } from "../lib/data";
import { activityColorVar, activityName, indexById, liveActivities, parentOf } from "../lib/activity";
import { buildTree } from "../lib/activityTree";
import { symbolIcon } from "../lib/symbols";
import { useDragOrder } from "../lib/useDragOrder";
import { ActivityEditor } from "./ActivityEditor";
import "./Activities.css";

/** What the inline editor is showing: an existing activity, or a new one (optionally under a parent). */
type Editing = { kind: "edit"; id: string } | { kind: "new"; parentId: string | null } | null;

const reorder = (ids: string[]) => void run(commands.activityReorder(ids));

export function Activities() {
  const { t } = useTranslation();
  const all = useQuery(() => commands.activityList(true), []) ?? [];
  const [editing, setEditing] = useState<Editing>(null);
  const [showArchived, setShowArchived] = useState(false);

  const byId = indexById(all);
  // Sub-activities of an archived parent are hidden with it (rebuild-plan 10 C), as Rust lists them.
  const live = liveActivities(all);
  const liveIds = new Set(live.map((a) => a.id));
  const tree = buildTree(live);
  const roots = tree.map((n) => n.activity);
  const archived = all.filter((a) => !liveIds.has(a.id));
  // An archived parent keeps its sub-activities nested under it, e.g. the timetable group and its courses
  // (rebuild-plan 13.7); an archived sub-activity of a live parent is listed as "Parent · Child".
  const archivedTree = buildTree(archived);
  const order = useDragOrder(roots, reorder);
  const close = () => setEditing(null);

  const editorFor = (a: Activity | null, parentId: string | null) => (
    <ActivityEditor activity={a} parentId={parentId} roots={roots} childCount={a ? live.filter((c) => c.parent_id === a.id).length : 0} onClose={close} />
  );

  return (
    <Page title={t("nav.activities")} subtitle={t("views.activities.subtitle")}>
      <ul className="activity-list" onDragOver={(e) => e.preventDefault()}>
        {order.items.map((root) => {
          const children = tree.find((n) => n.activity.id === root.id)?.children ?? [];
          return (
            <li key={root.id} className="activity-group">
              {editing?.kind === "edit" && editing.id === root.id ? (
                <div className="activity-editing">{editorFor(root, null)}</div>
              ) : (
                <div
                  className={order.dragging === root.id ? "activity-row is-dragging" : "activity-row"}
                  draggable={editing === null}
                  onDragStart={(e) => order.start(e, root.id)}
                  onDragEnter={() => order.over(root.id)}
                  onDragEnd={order.end}
                >
                  <GripVertical className="activity-grip" size={14} aria-hidden />
                  <button type="button" className="activity-open" onClick={() => setEditing({ kind: "edit", id: root.id })}>
                    <ActivityGlyph activity={root} />
                    <span className="activity-name">{root.name}</span>
                    {root.kind === "schedule" && <span className="activity-badge">{t("activities.scheduleBadge")}</span>}
                    {root.kind === "exercise" && <span className="activity-badge">{t("activities.exerciseBadge")}</span>}
                  </button>
                  <button
                    type="button"
                    className="activity-icon-button"
                    aria-label={t("activities.addSub", { name: root.name })}
                    title={t("activities.addSub", { name: root.name })}
                    onClick={() => setEditing({ kind: "new", parentId: root.id })}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                  <ChevronRight className="activity-chevron" size={14} aria-hidden />
                </div>
              )}
              <Children
                parent={root}
                items={children}
                editing={editing}
                onEdit={(id) => setEditing({ kind: "edit", id })}
                editorFor={editorFor}
              />
              {editing?.kind === "new" && editing.parentId === root.id && (
                <div className="activity-editing is-child">{editorFor(null, root.id)}</div>
              )}
            </li>
          );
        })}
        {editing?.kind === "new" && editing.parentId === null ? (
          <li className="activity-editing">{editorFor(null, null)}</li>
        ) : (
          <li>
            <button type="button" className="activity-add" onClick={() => setEditing({ kind: "new", parentId: null })}>
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
              {archivedTree.map(({ activity: a, children }) => (
                <li key={a.id} className="activity-group">
                  <ArchivedRow activity={a} name={activityName(a, t, parentOf(a, byId))} nested={false} />
                  {children.length > 0 && (
                    <ul className="activity-children">
                      {children.map((c) => (
                        <li key={c.id}>
                          <ArchivedRow activity={c} name={c.name} nested />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Page>
  );
}

interface ArchivedRowProps {
  activity: Activity;
  name: string;
  /** A sub-activity hidden with its archived parent. */
  nested: boolean;
}

/** A row of the archived list. */
function ArchivedRow({ activity, name, nested }: ArchivedRowProps) {
  const { t } = useTranslation();
  return (
    <div className={nested ? "activity-row is-archived is-child" : "activity-row is-archived"}>
      <ActivityGlyph activity={activity} />
      <span className="activity-name">{name}</span>
      {activity.kind === "schedule" && <span className="activity-badge">{t("activities.scheduleBadge")}</span>}
      {activity.kind === "exercise" && <span className="activity-badge">{t("activities.exerciseBadge")}</span>}
      <span className="activity-row-spacer" />
      {/* Restoring a nested row alone would leave it hidden under its archived parent; restore the parent. */}
      {!nested && (
        <button type="button" className="settings-button" onClick={() => void run(commands.activityArchive(activity.id, false))}>
          {t("activities.restore")}
        </button>
      )}
    </div>
  );
}

interface ChildrenProps {
  parent: Activity;
  items: Activity[];
  editing: Editing;
  onEdit: (id: string) => void;
  editorFor: (a: Activity | null, parentId: string | null) => JSX.Element;
}

/** A parent's sub-activities, reorderable among themselves. */
function Children({ parent, items, editing, onEdit, editorFor }: ChildrenProps) {
  const order = useDragOrder(items, reorder);
  if (items.length === 0) return null;
  return (
    <ul className="activity-children" onDragOver={(e) => e.preventDefault()}>
      {order.items.map((c) =>
        editing?.kind === "edit" && editing.id === c.id ? (
          <li key={c.id} className="activity-editing is-child">
            {editorFor(c, parent.id)}
          </li>
        ) : (
          <li
            key={c.id}
            className={order.dragging === c.id ? "activity-row is-child is-dragging" : "activity-row is-child"}
            draggable={editing === null}
            onDragStart={(e) => order.start(e, c.id)}
            onDragEnter={() => order.over(c.id)}
            onDragEnd={order.end}
          >
            <GripVertical className="activity-grip" size={14} aria-hidden />
            <button type="button" className="activity-open" onClick={() => onEdit(c.id)}>
              <ActivityGlyph activity={c} />
              <span className="activity-name">{c.name}</span>
            </button>
            <ChevronRight className="activity-chevron" size={14} aria-hidden />
          </li>
        ),
      )}
    </ul>
  );
}

export function ActivityGlyph({ activity }: { activity: Activity }) {
  const Icon = symbolIcon(activity.symbol);
  if (!Icon)
    return (
      <span className="activity-glyph">
        <ActivityDot color={activity.color} />
      </span>
    );
  return (
    <span className="activity-glyph" style={{ color: activityColorVar(activity.color) }}>
      <Icon size={16} strokeWidth={2} aria-hidden />
    </span>
  );
}

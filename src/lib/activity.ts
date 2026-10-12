import type { TFunction } from "i18next";
import type { Activity, ActivityColor } from "./bindings";

/**
 * "Parent · Child" for sub-activities, the plain name otherwise.
 * Orphaned sessions (activity not found) render as gray "Unknown activity".
 */
export function activityName(activity: Activity | undefined, t: TFunction, parent?: Activity): string {
  if (!activity) return t("activity.unknown");
  return parent ? `${parent.name} · ${activity.name}` : activity.name;
}

/** The parent of a sub-activity, if it is known. */
export function parentOf(activity: Activity | undefined, byId: Map<string, Activity>): Activity | undefined {
  return activity?.parent_id ? byId.get(activity.parent_id) : undefined;
}

export function indexById(activities: Activity[] | undefined): Map<string, Activity> {
  return new Map((activities ?? []).map((a) => [a.id, a]));
}

export function activityColorVar(color: ActivityColor | undefined): string {
  return `var(--activity-${color ?? "gray"})`;
}

/** Timetable time: the activity or its parent is a timetable group (rebuild-plan 13.4). */
export function isScheduleActivity(activity: Activity | undefined, parent?: Activity): boolean {
  return activity?.kind === "schedule" || parent?.kind === "schedule";
}

/** The timetable group the importer would use: the live top-level one with the smallest `sort`. */
export function scheduleGroup(activities: Activity[] | undefined): Activity | undefined {
  return (activities ?? [])
    .filter((a) => a.kind === "schedule" && a.parent_id === null && a.archived_at === null)
    .sort((a, b) => a.sort - b.sort)[0];
}

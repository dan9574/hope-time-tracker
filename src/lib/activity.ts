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

/** Exercise activities, and their sub-activities, get no "you walked away" reminders (rebuild-plan 14.1). */
export function isExerciseActivity(activity: Activity | undefined, parent?: Activity): boolean {
  return activity?.kind === "exercise" || parent?.kind === "exercise";
}

/**
 * The timetable group the importer would use, as Rust's `schedule_group` picks it: a top-level `kind = 'schedule'`
 * activity, unarchived ones first, then the smallest `sort`. The group is normally archived (rebuild-plan 13.7).
 */
export function scheduleGroup(activities: Activity[] | undefined): Activity | undefined {
  const archived = (a: Activity) => (a.archived_at === null ? 0 : 1);
  return (activities ?? [])
    .filter((a) => a.kind === "schedule" && a.parent_id === null)
    .sort((a, b) => archived(a) - archived(b) || a.sort - b.sort || a.name.localeCompare(b.name))[0];
}

/** Hidden like an archived activity: archived itself, or a sub-activity of an archived parent (as Rust lists them). */
export function isArchived(activity: Activity, byId: Map<string, Activity>): boolean {
  return activity.archived_at !== null || (parentOf(activity, byId)?.archived_at ?? null) !== null;
}

/** Activities that can be picked when starting a timer or adding something new. */
export function liveActivities(activities: Activity[]): Activity[] {
  const byId = indexById(activities);
  return activities.filter((a) => !isArchived(a, byId));
}

/**
 * What an editor's activity picker offers: the live activities plus the one already chosen (with its parent), so
 * a plan or record on an archived activity, such as every timetable course (rebuild-plan 13.7), keeps showing it.
 */
export function pickableActivities(activities: Activity[], currentId: string | null | undefined): Activity[] {
  const byId = indexById(activities);
  const current = currentId ? byId.get(currentId) : undefined;
  const keep = new Set([current?.id, current?.parent_id ?? undefined]);
  return activities.filter((a) => keep.has(a.id) || !isArchived(a, byId));
}

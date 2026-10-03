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

import type { TFunction } from "i18next";
import type { Activity, ActivityColor } from "./bindings";

/** Orphaned sessions (activity not found) render as gray "Unknown activity". */
export function activityName(activity: Activity | undefined, t: TFunction): string {
  return activity?.name ?? t("activity.unknown");
}

export function activityColorVar(color: ActivityColor | undefined): string {
  return `var(--activity-${color ?? "gray"})`;
}

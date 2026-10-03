import type { Activity } from "./bindings";

export interface ActivityNode {
  activity: Activity;
  children: Activity[];
}

/**
 * Top-level activities with their sub-activities, in `sort` order (the list from Rust is already sorted).
 * A child whose parent is missing is treated as top-level, matching how Rust reads it.
 */
export function buildTree(activities: Activity[]): ActivityNode[] {
  const ids = new Set(activities.map((a) => a.id));
  const isRoot = (a: Activity) => !a.parent_id || !ids.has(a.parent_id);
  return activities
    .filter(isRoot)
    .map((activity) => ({ activity, children: activities.filter((c) => c.parent_id === activity.id) }));
}

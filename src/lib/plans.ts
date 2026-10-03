import type { Activity, Plan } from "./bindings";
import { parentOf } from "./activity";
import { atClock, dateKey } from "./time";

/** A plan placed on a specific day. */
export interface PlanOccurrence {
  key: string;
  plan: Plan;
  activity: Activity | undefined;
  parent: Activity | undefined;
  startMs: number;
  endMs: number;
}

/** ISO weekday, 1 = Monday … 7 = Sunday (matches `plan.rule`). */
export function isoWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

export function ruleDays(rule: string | null): number[] {
  if (!rule?.startsWith("weekly:")) return [];
  return rule
    .slice("weekly:".length)
    .split(",")
    .map(Number)
    .filter((d) => d >= 1 && d <= 7);
}

export function makeRule(days: number[]): string | null {
  return days.length === 0 ? null : `weekly:${[...days].sort((a, b) => a - b).join(",")}`;
}

export function occursOn(plan: Plan, date: Date): boolean {
  const key = dateKey(date);
  if (plan.rule === null) return plan.date === key;
  return plan.date <= key && ruleDays(plan.rule).includes(isoWeekday(date));
}

export function occurrencesOn(plans: Plan[], activities: Activity[], date: Date): PlanOccurrence[] {
  const byId = new Map(activities.map((a) => [a.id, a]));
  return plans
    .filter((p) => occursOn(p, date))
    .map((p) => ({
      key: `${p.id}@${dateKey(date)}`,
      plan: p,
      activity: byId.get(p.activity_id),
      parent: parentOf(byId.get(p.activity_id), byId),
      startMs: atClock(date, p.start_hm)!,
      endMs: atClock(date, p.end_hm)!,
    }))
    .sort((a, b) => a.startMs - b.startMs);
}

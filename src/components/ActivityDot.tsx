import type { ActivityColor } from "../lib/bindings";
import { activityColorVar } from "../lib/activity";
import "./ActivityDot.css";

export function ActivityDot({ color }: { color: ActivityColor | undefined }) {
  return <span className="activity-dot" style={{ background: activityColorVar(color) }} aria-hidden />;
}

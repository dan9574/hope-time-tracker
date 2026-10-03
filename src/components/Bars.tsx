import { activityColorVar } from "../lib/activity";
import type { DayTotals } from "../lib/stats";
import { formatDuration } from "../lib/time";
import "./Bars.css";

interface Props {
  days: DayTotals[];
  /** Short label under each bar. */
  label: (date: Date) => string;
  highlightKey?: string;
}

const MAX_HEIGHT = 160;

/** Stacked daily bars (rebuild-plan 4.5): 24px wide, 16px apart, total on top. */
export function Bars({ days, label, highlightKey }: Props) {
  const peak = Math.max(...days.map((d) => d.totalMs), 1);

  return (
    <div className="bars">
      {days.map((d) => {
        const height = (d.totalMs / peak) * MAX_HEIGHT;
        return (
          <div key={d.key} className={d.key === highlightKey ? "bars-col is-highlight" : "bars-col"}>
            <span className="bars-value tabular">{d.totalMs > 0 ? formatDuration(d.totalMs) : ""}</span>
            <div className="bars-track" style={{ height: MAX_HEIGHT }}>
              <div className="bars-stack" style={{ height }}>
                {d.parts.map((p) => (
                  <span
                    key={p.activityId}
                    style={{ flexGrow: p.ms, background: activityColorVar(p.activity?.color) }}
                  />
                ))}
              </div>
            </div>
            <span className="bars-label">{label(d.date)}</span>
          </div>
        );
      })}
    </div>
  );
}

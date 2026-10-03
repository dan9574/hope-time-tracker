import { useEffect } from "react";
import { commands, type Occurrence } from "./bindings";
import { useDataVersion } from "./data";
import { autoLogs, occurrencesOn } from "./plans";
import { dateKey, shiftDays } from "./time";
import { useNow } from "./useNow";

const BACKFILL_DAYS = 30;

/**
 * Sends the recurring-plan occurrences that have ended to Rust, which logs the eligible ones
 * (rebuild-plan 10 F). Runs at start, every minute, and whenever data changes; covers the past
 * 30 days for days the app was not running. Rust makes this idempotent.
 */
export function useAutoLog() {
  const now = useNow(60_000);
  const version = useDataVersion();
  const minute = Math.floor(now / 60_000);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const today = new Date(now);
      const from = new Date(shiftDays(today.getTime(), -BACKFILL_DAYS));
      const res = await commands.planList({ from: dateKey(from), to: dateKey(today) });
      if (cancelled || res.status === "error") return;
      const recurring = res.data.filter(autoLogs);
      if (recurring.length === 0) return;

      const occurrences: Occurrence[] = [];
      for (let i = 0; i <= BACKFILL_DAYS; i++) {
        const day = new Date(shiftDays(from.getTime(), i));
        for (const o of occurrencesOn(recurring, [], day)) {
          if (o.endMs <= now) {
            occurrences.push({ plan_id: o.plan.id, date: dateKey(day), start_ms: o.startMs, end_ms: o.endMs });
          }
        }
      }
      if (occurrences.length > 0) await commands.planAutolog(occurrences);
    })();
    return () => {
      cancelled = true;
    };
    // Re-run every minute and after any data change (a plan was added or edited).
  }, [minute, version]);
}

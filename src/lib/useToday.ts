import { commands } from "./bindings";
import { useQuery, useSetting } from "./data";
import { summarizeDay } from "./stats";
import { atClock, dateKey, DAY, dayRange } from "./time";

const DEFAULT_WAKE = "07:00";
const DEFAULT_SLEEP = "23:00";

/** Today's sessions summarized, plus the waking window the ring spans. */
export function useToday(now: number) {
  const today = new Date(now);
  const key = dateKey(today); // re-query when the day rolls over
  const range = dayRange(today);

  const sessions = useQuery(() => commands.sessionList(range), [key]);
  const activities = useQuery(() => commands.activityList(true), []);
  const wakeHm = useSetting("wake_hm");
  const sleepHm = useSetting("sleep_hm");

  const summary = summarizeDay(sessions ?? [], activities ?? [], range, now);
  const wakeMs = atClock(today, wakeHm ?? DEFAULT_WAKE) ?? atClock(today, DEFAULT_WAKE)!;
  let sleepMs = atClock(today, sleepHm ?? DEFAULT_SLEEP) ?? atClock(today, DEFAULT_SLEEP)!;
  if (sleepMs <= wakeMs) sleepMs += DAY; // sleeping after midnight

  return { today, summary, activities, loaded: sessions !== undefined, wakeMs, sleepMs };
}

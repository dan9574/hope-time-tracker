import { useTranslation } from "react-i18next";
import { Page } from "../components/Page";
import { Ring, type RingSegment } from "../components/Ring";
import { Timeline } from "../components/Timeline";
import { commands } from "../lib/bindings";
import { useQuery } from "../lib/data";
import { summarizeDay } from "../lib/stats";
import { atClock, dateKey, DAY, dayRange, formatClock, formatDuration } from "../lib/time";
import { useNow } from "../lib/useNow";
import "./Today.css";

const DEFAULT_WAKE = "07:00";
const DEFAULT_SLEEP = "23:00";
/** Plans arrive in stage 6; the ring already knows how to draw them. */
const NO_PLANS: RingSegment[] = [];

export function Today() {
  const { t, i18n } = useTranslation();
  const timer = useQuery(() => commands.sessionCurrent(), []);
  const now = useNow(timer?.running ? 1000 : 30_000);

  const today = new Date(now);
  const key = dateKey(today); // re-query when the day rolls over
  const range = dayRange(today);

  const sessions = useQuery(() => commands.sessionList(range), [key]);
  const activities = useQuery(() => commands.activityList(true), []);
  const wakeHm = useQuery(() => commands.settingGet("wake_hm"), []);
  const sleepHm = useQuery(() => commands.settingGet("sleep_hm"), []);

  const summary = summarizeDay(sessions ?? [], activities ?? [], range, now);
  const records: RingSegment[] = summary.entries.flatMap((e) =>
    e.segments.map((seg) => ({ key: `${e.key}-${seg.startMs}`, ...seg, color: e.activity?.color })),
  );

  const wake = atClock(today, wakeHm ?? DEFAULT_WAKE) ?? atClock(today, DEFAULT_WAKE)!;
  let sleep = atClock(today, sleepHm ?? DEFAULT_SLEEP) ?? atClock(today, DEFAULT_SLEEP)!;
  if (sleep <= wake) sleep += DAY; // sleeping after midnight

  const subtitle = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(today);

  return (
    <Page title={t("nav.today")} subtitle={subtitle}>
      <section className="today-ring">
        <Ring
          wakeMs={wake}
          sleepMs={sleep}
          records={records}
          plans={NO_PLANS}
          now={now}
          wakeLabel={formatClock(wake, i18n.language)}
          sleepLabel={formatClock(sleep, i18n.language)}
        >
          <span className="today-total tabular">{formatDuration(summary.totalMs)}</span>
          <span className="today-total-label">{t("today.total")}</span>
        </Ring>
      </section>

      {sessions && summary.entries.length === 0 ? (
        <p className="today-empty">{t("today.empty")}</p>
      ) : (
        <Timeline entries={summary.entries} />
      )}
    </Page>
  );
}

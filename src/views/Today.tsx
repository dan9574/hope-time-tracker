import { useTranslation } from "react-i18next";
import { Page } from "../components/Page";
import { Ring, type RingSegment } from "../components/Ring";
import { Timeline } from "../components/Timeline";
import { commands } from "../lib/bindings";
import { useQuery } from "../lib/data";
import { ringRecords } from "../lib/stats";
import { formatClock, formatDuration } from "../lib/time";
import { useNow } from "../lib/useNow";
import { useToday } from "../lib/useToday";
import "./Today.css";

/** Plans arrive in stage 5; the ring already knows how to draw them. */
const NO_PLANS: RingSegment[] = [];

export function Today() {
  const { t, i18n } = useTranslation();
  const timer = useQuery(() => commands.sessionCurrent(), []);
  const now = useNow(timer?.running ? 1000 : 30_000);
  const { today, summary, loaded, wakeMs, sleepMs } = useToday(now);

  const subtitle = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(today);

  return (
    <Page title={t("nav.today")} subtitle={subtitle}>
      <section className="today-ring">
        <Ring
          wakeMs={wakeMs}
          sleepMs={sleepMs}
          records={ringRecords(summary.entries)}
          plans={NO_PLANS}
          now={now}
          wakeLabel={formatClock(wakeMs, i18n.language)}
          sleepLabel={formatClock(sleepMs, i18n.language)}
        >
          <span className="today-total tabular">{formatDuration(summary.totalMs)}</span>
          <span className="today-total-label">{t("today.total")}</span>
        </Ring>
      </section>

      {loaded && summary.entries.length === 0 ? (
        <p className="today-empty">{t("today.empty")}</p>
      ) : (
        <Timeline entries={summary.entries} />
      )}
    </Page>
  );
}

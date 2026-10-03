import { useTranslation } from "react-i18next";
import { ActivitySummary } from "../components/ActivitySummary";
import { MonthCalendar } from "../components/MonthCalendar";
import { Page } from "../components/Page";
import { PeriodNav } from "../components/PeriodNav";
import { usePeriod } from "../lib/usePeriod";
import { addMonths, monthDays, relativePeriod, weekDays } from "../lib/time";
import { useUi } from "../stores/ui";

export function Month() {
  const { t, i18n } = useTranslation();
  const offset = useUi((s) => s.monthOffset);
  const setOffset = useUi((s) => s.setMonthOffset);

  const month = addMonths(new Date(), offset);
  const days = monthDays(month);
  const { now, perDay, totals, todayKey } = usePeriod(days);

  const title = new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "long" }).format(month);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });
  const weekdays = weekDays(month).map((d) => weekday.format(d));

  return (
    <Page
      title={offset === 0 ? t("nav.month") : relativePeriod(offset, "month", i18n.language)}
      subtitle={title}
      accessory={<PeriodNav offset={offset} onChange={setOffset} currentLabel={t("period.thisMonth")} />}
    >
      <MonthCalendar days={perDay} weekdays={weekdays} todayKey={todayKey} now={now} />
      <ActivitySummary totals={totals} />
    </Page>
  );
}

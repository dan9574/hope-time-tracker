import { useTranslation } from "react-i18next";
import { ActivitySummary } from "../components/ActivitySummary";
import { Bars } from "../components/Bars";
import { Page } from "../components/Page";
import { PeriodNav } from "../components/PeriodNav";
import { usePeriod } from "../lib/usePeriod";
import { addWeeks, relativePeriod, weekDays } from "../lib/time";
import { useUi } from "../stores/ui";

export function Week() {
  const { t, i18n } = useTranslation();
  const offset = useUi((s) => s.weekOffset);
  const setOffset = useUi((s) => s.setWeekOffset);

  const days = weekDays(addWeeks(new Date(), offset));
  const { perDay, totals, todayKey } = usePeriod(days);

  const range = new Intl.DateTimeFormat(i18n.language, { month: "long", day: "numeric" }).formatRange(
    days[0]!,
    days[6]!,
  );
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });

  return (
    <Page
      title={offset === 0 ? t("nav.week") : relativePeriod(offset, "week", i18n.language)}
      subtitle={range}
      accessory={<PeriodNav offset={offset} onChange={setOffset} currentLabel={t("period.thisWeek")} />}
    >
      <Bars days={perDay} label={(d) => weekday.format(d)} highlightKey={todayKey} />
      <ActivitySummary totals={totals} />
    </Page>
  );
}

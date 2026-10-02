import { useTranslation } from "react-i18next";
import { Page } from "../components/Page";

export function Today() {
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());

  return (
    <Page title={t("nav.today")} subtitle={date}>
      <p className="page-placeholder">{t("placeholder")}</p>
    </Page>
  );
}

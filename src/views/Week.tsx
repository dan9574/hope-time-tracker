import { useTranslation } from "react-i18next";
import { Page } from "../components/Page";

export function Week() {
  const { t } = useTranslation();
  return (
    <Page title={t("nav.week")} subtitle={t("views.week.subtitle")}>
      <p className="page-placeholder">{t("placeholder")}</p>
    </Page>
  );
}

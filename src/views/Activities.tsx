import { useTranslation } from "react-i18next";
import { Page } from "../components/Page";

export function Activities() {
  const { t } = useTranslation();
  return (
    <Page title={t("nav.activities")} subtitle={t("views.activities.subtitle")}>
      <p className="page-placeholder">{t("placeholder")}</p>
    </Page>
  );
}

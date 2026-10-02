import { useTranslation } from "react-i18next";
import { Page } from "../components/Page";

export function Month() {
  const { t } = useTranslation();
  return (
    <Page title={t("nav.month")} subtitle={t("views.month.subtitle")}>
      <p className="page-placeholder">{t("placeholder")}</p>
    </Page>
  );
}

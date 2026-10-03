import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Page } from "../components/Page";
import { commands, type AppInfo } from "../lib/bindings";
import { OverlaySettings } from "./OverlaySettings";
import "./Settings.css";

export function Settings() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    commands.appInfo().then((res) => {
      if (res.status === "ok") setInfo(res.data);
      else setError(res.error);
    });
  }, []);

  return (
    <Page title={t("nav.settings")} subtitle={t("views.settings.subtitle")}>
      <OverlaySettings />
      <section className="settings-group">
        <h2 className="settings-group-title">{t("settings.about")}</h2>
        {error && <p className="page-placeholder">{t("settings.loadFailed", { message: error })}</p>}
        {info && (
          <dl className="settings-rows">
            <div className="settings-row">
              <dt>{t("settings.version")}</dt>
              <dd className="tabular">{info.version}</dd>
            </div>
            <div className="settings-row">
              <dt>{t("settings.schema")}</dt>
              <dd className="tabular">{info.schema_version}</dd>
            </div>
            <div className="settings-row">
              <dt>{t("settings.database")}</dt>
              <dd className="settings-path">{info.db_path}</dd>
            </div>
          </dl>
        )}
      </section>
    </Page>
  );
}

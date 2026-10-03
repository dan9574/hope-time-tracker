import { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type ImportReport } from "../../lib/bindings";
import { dateKey } from "../../lib/time";
import { errorMessage } from "../../lib/errors";
import { WipeData } from "./WipeData";

type Status = { kind: "ok" | "error"; text: string } | null;

/** JSON import / export (rebuild-plan 3.3). Panels are opened by Rust. */
export function DataSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [wiping, setWiping] = useState(false);

  const exportData = async () => {
    setBusy(true);
    const res = await commands.dataExport(`hope-${dateKey(new Date())}.json`);
    setBusy(false);
    if (res.status === "error") setStatus({ kind: "error", text: t("settings.dataFailed", { message: errorMessage(res.error, t) }) });
    else if (res.data) setStatus({ kind: "ok", text: t("settings.exported", { path: res.data }) });
  };

  const importData = async () => {
    setBusy(true);
    const res = await commands.dataImport();
    setBusy(false);
    if (res.status === "error") setStatus({ kind: "error", text: t("settings.dataFailed", { message: errorMessage(res.error, t) }) });
    else if (res.data) setStatus({ kind: "ok", text: summarize(res.data, t) });
  };

  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{t("settings.data")}</h2>
      <div className="settings-rows">
        <div className="settings-row">
          <span>{t("settings.dataHint")}</span>
          <span className="settings-inline">
            <button type="button" className="settings-button" disabled={busy} onClick={importData}>
              {t("settings.import")}
            </button>
            <button type="button" className="settings-button" disabled={busy} onClick={exportData}>
              {t("settings.export")}
            </button>
          </span>
        </div>
        <div className="settings-row">
          <span>{t("settings.wipeHint")}</span>
          <button type="button" className="settings-button" disabled={busy} onClick={() => setWiping(true)}>
            {t("settings.wipe")}
          </button>
        </div>
      </div>
      {wiping && (
        <WipeData
          onClose={() => setWiping(false)}
          onDone={(path) => {
            setWiping(false);
            setStatus({ kind: "ok", text: t("settings.wiped", { path }) });
          }}
        />
      )}
      {status && <p className={status.kind === "error" ? "settings-footnote is-error" : "settings-footnote"}>{status.text}</p>}
    </section>
  );
}

function summarize(r: ImportReport, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const tables = [r.activity, r.session, r.plan, r.journal];
  const sum = (k: "added" | "updated" | "unchanged") => tables.reduce((s, c) => s + c[k], 0);
  return t("settings.imported", { added: sum("added"), updated: sum("updated"), unchanged: sum("unchanged") });
}

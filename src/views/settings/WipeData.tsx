import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "../../lib/bindings";
import { errorMessage } from "../../lib/errors";
import { dateKey } from "../../lib/time";
import "../../components/Sheet.css";

const PHRASE = "DELETE";

/** Clears every record. The user must type DELETE; a JSON backup is saved to Downloads first. */
export function WipeData({ onDone, onClose }: { onDone: (backupPath: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => ref.current?.showModal(), []);

  const wipe = async () => {
    setBusy(true);
    const stamp = `${dateKey(new Date())}-${Date.now() % 100000}`;
    const res = await commands.dataWipe(typed, `hope-backup-${stamp}.json`);
    setBusy(false);
    if (res.status === "error") setError(errorMessage(res.error, t));
    else onDone(res.data);
  };

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        className="sheet-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed === PHRASE) void wipe();
        }}
      >
        <h2 className="sheet-title">{t("settings.wipeTitle")}</h2>
        <p className="sheet-message">{t("settings.wipeBody")}</p>
        <label className="sheet-row is-stacked">
          <span>{t("settings.wipeType", { phrase: PHRASE })}</span>
          <input
            className="sheet-input tabular"
            value={typed}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        {error && <p className="sheet-error">{error}</p>}
        <div className="sheet-actions">
          <span className="sheet-spacer" />
          <button type="button" className="settings-button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="settings-button is-destructive" disabled={typed !== PHRASE || busy}>
            {t("settings.wipeConfirm")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

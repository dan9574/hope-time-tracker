import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { commands, events, type SyncError, type SyncStatus } from "../../lib/bindings";
import { dateKey, formatClock } from "../../lib/time";

/** Live sync status: read once, then follow Rust's SyncStatusChanged event. */
function useSyncStatus(): SyncStatus | undefined {
  const [status, setStatus] = useState<SyncStatus>();
  useEffect(() => {
    let cancelled = false;
    void commands.syncStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    const unlisten = events.syncStatusChanged.listen((e) => setStatus(e.payload));
    return () => {
      cancelled = true;
      void unlisten.then((f) => f());
    };
  }, []);
  return status;
}

function errorText(err: SyncError, t: TFunction): string {
  return t(`sync.error.${err.code}`, { message: err.message });
}

function syncedAt(ms: number, locale: string): string {
  const clock = formatClock(ms, locale);
  if (dateKey(new Date(ms)) === dateKey(new Date())) return clock;
  return `${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(ms)} ${clock}`;
}

type Note = { kind: "ok" | "error"; text: string } | null;

/** Settings → Sync (rebuild-plan 12.4). All network work happens in Rust. */
export function SyncSettings() {
  const { t, i18n } = useTranslation();
  const status = useSyncStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  // Offer the last account used on this device.
  useEffect(() => {
    if (status?.phase === "signed_out" && status.email) setEmail((current) => current || status.email || "");
  }, [status?.phase, status?.email]);

  if (!status) return null;

  const signIn = async (mode: "sign_in" | "sign_up", confirmSwitch = false) => {
    setBusy(true);
    setNote(null);
    const res =
      mode === "sign_in"
        ? await commands.syncSignIn(email, password, confirmSwitch)
        : await commands.syncSignUp(email, password, confirmSwitch);
    setBusy(false);
    if (res.status === "error") {
      setNote({ kind: "error", text: errorText(res.error, t) });
      return;
    }
    const outcome = res.data;
    if (outcome.kind === "signed_in") {
      setPassword("");
    } else if (outcome.kind === "check_email") {
      setNote({ kind: "ok", text: t("sync.checkEmail", { email }) });
    } else {
      const ok = await commands.dialogConfirm(
        t("sync.switchTitle"),
        t("sync.switchBody", { previous: outcome.previous_email ?? t("sync.anotherAccount"), next: email }),
        t("sync.switchConfirm"),
        t("common.cancel"),
      );
      // The account exists by now (also after sign-up), so continue with a plain sign-in.
      if (ok) await signIn("sign_in", true);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setNote(null);
    const res = await commands.syncSignOut();
    setBusy(false);
    if (res.status === "error") setNote({ kind: "error", text: errorText(res.error, t) });
    else setNote({ kind: "ok", text: t("sync.signedOutNote") });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim() && password) void signIn("sign_in");
  };

  const statusText = (() => {
    switch (status.phase) {
      case "not_configured":
        return t("sync.notConfigured");
      case "signed_out":
        return t("sync.signedOut");
      case "syncing":
        return t("sync.syncing");
      case "synced":
        return status.last_ok_ms === null ? t("sync.syncing") : t("sync.synced", { time: syncedAt(status.last_ok_ms, i18n.language) });
      case "error":
        return t("sync.failed");
    }
  })();

  const signedIn = status.phase === "syncing" || status.phase === "synced" || status.phase === "error";
  const canSubmit = !busy && email.trim() !== "" && password !== "";
  // A background failure (or an expired session) is shown under the group unless a fresher note replaces it.
  const footnote: Note =
    note ??
    (status.error && status.phase !== "not_configured" ? { kind: "error", text: errorText(status.error, t) } : null);

  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{t("sync.title")}</h2>
      <div className="settings-rows">
        <div className="settings-row">
          <span>{t("sync.status")}</span>
          <span className="settings-value-text">{statusText}</span>
        </div>

        {signedIn && (
          <>
            <div className="settings-row">
              <span>{t("sync.account")}</span>
              <span className="settings-value-text settings-path">{status.email ?? ""}</span>
            </div>
            <div className="settings-row">
              <span>{t("sync.signedInHint")}</span>
              <span className="settings-inline">
                <button type="button" className="settings-button" disabled={busy} onClick={() => void commands.syncNow()}>
                  {t("sync.syncNow")}
                </button>
                <button type="button" className="settings-button" disabled={busy} onClick={() => void signOut()}>
                  {t("sync.signOut")}
                </button>
              </span>
            </div>
          </>
        )}

        {status.phase === "signed_out" && (
          <form className="settings-form" onSubmit={onSubmit}>
            <label className="settings-row">
              <span>{t("sync.email")}</span>
              <input
                className="settings-input"
                type="email"
                autoComplete="username"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="settings-row">
              <span>{t("sync.password")}</span>
              <input
                className="settings-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="settings-row">
              <span>{t("sync.signedOutHint")}</span>
              <span className="settings-inline">
                <button type="button" className="settings-button" disabled={!canSubmit} onClick={() => void signIn("sign_up")}>
                  {t("sync.signUp")}
                </button>
                <button type="submit" className="settings-button is-primary" disabled={!canSubmit}>
                  {t("sync.signIn")}
                </button>
              </span>
            </div>
          </form>
        )}
      </div>
      {status.phase === "not_configured" && <p className="settings-footnote">{t("sync.notConfiguredHint")}</p>}
      {footnote && <p className={footnote.kind === "error" ? "settings-footnote is-error" : "settings-footnote"}>{footnote.text}</p>}
    </section>
  );
}

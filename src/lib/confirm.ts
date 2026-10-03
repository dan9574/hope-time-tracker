import type { TFunction } from "i18next";
import { commands } from "./bindings";

/** Native warning sheet before anything that loses data. Resolves `true` if the user confirmed. */
export function confirmDelete(t: TFunction, message: string, confirmLabel = t("common.delete")): Promise<boolean> {
  return commands.dialogConfirm(t("confirm.title"), message, confirmLabel, t("common.cancel"));
}

export function alertInfo(t: TFunction, title: string, message: string): Promise<void> {
  return commands.dialogAlert(title, message, t("common.ok"));
}

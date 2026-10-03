import type { TFunction } from "i18next";
import type { CommandError } from "./bindings";

/** A user-facing message for a command error: localized when the code is known, the raw message otherwise. */
export function errorMessage(err: CommandError, t: TFunction): string {
  switch (err.code) {
    case "overlap":
    case "in_use":
    case "not_found":
      return t(`errors.${err.code}`);
    default:
      return t("errors.generic", { message: err.message });
  }
}

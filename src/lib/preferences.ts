import { useEffect } from "react";
import { useSetting } from "./data";
import i18n, { detectLocale, SUPPORTED_LOCALES, type Locale } from "./i18n";

/** Local settings keys for preferences (not synced). */
export const PREF = {
  locale: "locale",
  wake: "wake_hm",
  sleep: "sleep_hm",
  tint: "theme.tint",
  accent: "theme.accent",
  ring: "theme.ring",
} as const;

export const TINTS = ["clear", "warm", "cool"] as const;
export type Tint = (typeof TINTS)[number];
export const RING_WIDTHS = [10, 16] as const;

export const DEFAULT_WAKE = "07:00";
export const DEFAULT_SLEEP = "23:00";

/** Follows the "locale" setting ("system" or unset = detect from the OS). */
export function useLocalePreference() {
  const stored = useSetting(PREF.locale);
  useEffect(() => {
    if (stored === undefined) return; // still loading
    const target = SUPPORTED_LOCALES.includes(stored as Locale) ? (stored as Locale) : detectLocale();
    if (i18n.language !== target) void i18n.changeLanguage(target);
  }, [stored]);
}

/** Applies accent and material tint to the document so tokens.css can switch variables. */
export function useThemePreference() {
  const accent = useSetting(PREF.accent);
  const tint = useSetting(PREF.tint);
  useEffect(() => {
    const root = document.documentElement;
    if (accent && accent !== "blue") root.dataset.accent = accent;
    else delete root.dataset.accent;
    if (tint && tint !== "clear") root.dataset.tint = tint;
    else delete root.dataset.tint;
  }, [accent, tint]);
}

export function useRingWidth(): number {
  return useSetting(PREF.ring) === "16" ? 16 : 10;
}

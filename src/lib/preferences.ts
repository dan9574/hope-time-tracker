import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  appearance: "theme.appearance",
  wakeButtonUntil: "wake_button_until_hm",
  sleepButtonFrom: "sleep_button_from_hm",
  /** "1" = timetable records count towards totals; unset / "0" = they don't (rebuild-plan 13.4). */
  includeSchedule: "stats.include_schedule",
  /** Unset / "1" = the desktop shows a break reminder every 90 minutes of running time; "0" = off (rebuild-plan 15.4). */
  breakReminder: "break.enabled",
} as const;

export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];

export const TINTS = ["clear", "warm", "cool"] as const;
export type Tint = (typeof TINTS)[number];
export const RING_WIDTHS = [10, 16] as const;

export const DEFAULT_WAKE = "07:00";
export const DEFAULT_SLEEP = "23:00";
/** The wake-up button disappears after this, the sleep button appears after that (rebuild-plan 10 E). */
export const DEFAULT_WAKE_BUTTON_UNTIL = "08:30";
export const DEFAULT_SLEEP_BUTTON_FROM = "21:00";

/** Follows the "locale" setting ("system" or unset = detect from the OS). */
export function useLocalePreference() {
  const stored = useSetting(PREF.locale);
  useEffect(() => {
    if (stored === undefined) return; // still loading
    const target = SUPPORTED_LOCALES.includes(stored as Locale) ? (stored as Locale) : detectLocale();
    if (i18n.language !== target) void i18n.changeLanguage(target);
  }, [stored]);
}

/** Applies accent, material tint and light/dark to the document so tokens.css can switch variables. */
export function useThemePreference() {
  const accent = useSetting(PREF.accent);
  const tint = useSetting(PREF.tint);
  const appearance = useSetting(PREF.appearance);
  useEffect(() => {
    const root = document.documentElement;
    if (accent && accent !== "blue") root.dataset.accent = accent;
    else delete root.dataset.accent;
    if (tint && tint !== "clear") root.dataset.tint = tint;
    else delete root.dataset.tint;
  }, [accent, tint]);
  useEffect(() => {
    if (appearance === undefined) return; // still loading
    const theme = appearance === "light" || appearance === "dark" ? appearance : null;
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    // The native window appearance drives the vibrancy materials behind the page.
    void getCurrentWindow().setTheme(theme);
  }, [appearance]);
}

export function useRingWidth(): number {
  return useSetting(PREF.ring) === "16" ? 16 : 10;
}

/** Whether time logged under the timetable group counts towards totals (default: no). */
export function useIncludeSchedule(): boolean {
  return useSetting(PREF.includeSchedule) === "1";
}

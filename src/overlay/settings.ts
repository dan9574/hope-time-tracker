/** Overlay preferences, stored as local settings (not synced). */
export const OVERLAY_ENABLED = "overlay.enabled";
export const OVERLAY_CARDS = "overlay.cards";
export const OVERLAY_OPACITY = "overlay.opacity";
/** "Size": a factor on the 320px design width (clamped again in src-tauri/src/overlay.rs). */
export const OVERLAY_SCALE = "overlay.scale";

export const CARDS = ["now", "today", "week"] as const;
export type CardId = (typeof CARDS)[number];

export const OPACITY_MIN = 0.6;
export const OPACITY_MAX = 1;
const OPACITY_DEFAULT = 1;

export const SCALES = ["1", "1.25", "1.5"] as const;
export type Scale = (typeof SCALES)[number];
const SCALE_MIN = 1;
const SCALE_MAX = 2;

/** Stored as a comma list; missing means all cards. */
export function parseCards(value: string | null | undefined): Set<CardId> {
  if (value == null) return new Set(CARDS);
  return new Set(CARDS.filter((c) => value.split(",").includes(c)));
}

export function parseOpacity(value: string | null | undefined): number {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return OPACITY_DEFAULT;
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, n));
}

export function parseScale(value: string | null | undefined): number {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, n));
}

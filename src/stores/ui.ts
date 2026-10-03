import { create } from "zustand";

export const VIEWS = ["today", "week", "month", "schedule", "activities", "settings"] as const;
export type View = (typeof VIEWS)[number];

interface UiState {
  view: View;
  /** 0 = the current week/month, -1 = the previous one, … */
  weekOffset: number;
  monthOffset: number;
  /** What the pointer (or keyboard focus) is on, shared by charts and lists (rebuild-plan 11.2). */
  hoverKey: string | null;
  /**
   * Further keys lit by the same hover. A capsule on the Today ring can stand for several timeline
   * rows (rebuild-plan 11.3 merged drawing); hovering it lights all of them.
   */
  hoverAlso: string[];
  setView: (view: View) => void;
  setHoverKey: (key: string | null, also?: string[]) => void;
  setWeekOffset: (offset: number) => void;
  setMonthOffset: (offset: number) => void;
}

export const useUi = create<UiState>((set) => ({
  view: "today",
  weekOffset: 0,
  monthOffset: 0,
  hoverKey: null,
  hoverAlso: [],
  setView: (view) => set({ view, hoverKey: null, hoverAlso: [] }),
  setHoverKey: (hoverKey, also = []) => set({ hoverKey, hoverAlso: hoverKey === null ? [] : also }),
  setWeekOffset: (weekOffset) => set({ weekOffset: Math.min(0, weekOffset) }),
  setMonthOffset: (monthOffset) => set({ monthOffset: Math.min(0, monthOffset) }),
}));

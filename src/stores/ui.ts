import { create } from "zustand";

export const VIEWS = ["today", "week", "month", "schedule", "activities", "settings"] as const;
export type View = (typeof VIEWS)[number];

interface UiState {
  view: View;
  /** 0 = the current week/month, -1 = the previous one, … */
  weekOffset: number;
  monthOffset: number;
  setView: (view: View) => void;
  setWeekOffset: (offset: number) => void;
  setMonthOffset: (offset: number) => void;
}

export const useUi = create<UiState>((set) => ({
  view: "today",
  weekOffset: 0,
  monthOffset: 0,
  setView: (view) => set({ view }),
  setWeekOffset: (weekOffset) => set({ weekOffset: Math.min(0, weekOffset) }),
  setMonthOffset: (monthOffset) => set({ monthOffset: Math.min(0, monthOffset) }),
}));

import { create } from "zustand";

export const VIEWS = ["today", "week", "month", "activities", "settings"] as const;
export type View = (typeof VIEWS)[number];

interface UiState {
  view: View;
  setView: (view: View) => void;
}

export const useUi = create<UiState>((set) => ({
  view: "today",
  setView: (view) => set({ view }),
}));

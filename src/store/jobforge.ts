"use client";

import { create } from "zustand";

export type ViewKey =
  | "overview"
  | "activity"
  | "jobs"
  | "companies"
  | "contacts"
  | "sources"
  | "runs"
  | "deliveries"
  | "errors"
  | "settings";

interface JobForgeState {
  view: ViewKey;
  live: boolean;
  setView: (v: ViewKey) => void;
  toggleLive: () => void;
}

export const useJobForgeStore = create<JobForgeState>((set) => ({
  view: "overview",
  live: true,
  setView: (view) => set({ view }),
  toggleLive: () => set((s) => ({ live: !s.live })),
}));

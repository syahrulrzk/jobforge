"use client";

import { create } from "zustand";

export type ViewKey =
  | "overview"
  | "search"
  | "search-email"
  | "search-people"
  | "activity"
  | "jobs"
  | "companies"
  | "warehouse"
  | "contacts"
  | "sources"
  | "runs"
  | "deliveries"
  | "errors"
  | "api"
  | "settings";

const VIEW_STORAGE_KEY = "jobforge.view";

const VALID_VIEWS: ViewKey[] = [
  "overview",
  "search",
  "search-email",
  "search-people",
  "activity",
  "jobs",
  "companies",
  "warehouse",
  "contacts",
  "sources",
  "runs",
  "deliveries",
  "errors",
  "api",
  "settings",
];

/** baca view terakhir dari localStorage (client-only, aman untuk SSR) */
function loadInitialView(): ViewKey {
  if (typeof window === "undefined") return "overview";
  try {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY) as ViewKey | null;
    // validasi — kalau isinya aneh, fallback ke dashboard
    if (saved && VALID_VIEWS.includes(saved)) return saved;
  } catch {
    /* localStorage bisa keblokir (private mode) — fallback dashboard */
  }
  return "overview";
}

/** simpan view terakhir (silent fail di private mode) */
function persistView(view: ViewKey): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* skip */
  }
}

interface JobForgeState {
  view: ViewKey;
  live: boolean;
  /** id company yang diminta buka modal detailnya dari view lain (contoh: Top Companies di dashboard) — dikonsumsi & dikosongkan oleh CompaniesView (buka modal) atau JobsView (filter company) */
  focusCompanyId: string | null;
  /** nama company yang menemani focusCompanyId — buat label chip filter di JobsView */
  focusCompanyName: string | null;
  /** id job yang diminta buka modal detailnya dari view lain (contoh: Active Jobs di modal company) — dikonsumsi & dikosongkan oleh JobsView */
  focusJobId: string | null;
  /** setView dengan opsional focus: pindah view sekaligus buka modal company/job / set filter */
  setView: (v: ViewKey, opts?: { focusCompany?: string; focusCompanyName?: string; focusJob?: string }) => void;
  clearCompanyFocus: () => void;
  clearJobFocus: () => void;
  toggleLive: () => void;
  /** restore view terakhir dari localStorage — WAJIB dipanggil dari useEffect (client) biar hydration aman */
  hydrateView: () => void;
}

export const useJobForgeStore = create<JobForgeState>((set) => ({
  // init selalu "overview" — sama dengan server render (anti hydration mismatch).
  // View tersimpan di-restore via hydrateView() setelah mount.
  view: "overview",
  live: true,
  focusCompanyId: null,
  focusCompanyName: null,
  focusJobId: null,
  setView: (view, opts) => {
    persistView(view);
    const patch: Partial<JobForgeState> = { view };
    if (opts?.focusCompany) {
      patch.focusCompanyId = opts.focusCompany;
      patch.focusCompanyName = opts.focusCompanyName ?? null;
    }
    if (opts?.focusJob) patch.focusJobId = opts.focusJob;
    set(patch);
  },
  clearCompanyFocus: () => set({ focusCompanyId: null }),
  clearJobFocus: () => set({ focusJobId: null }),
  toggleLive: () => set((s) => ({ live: !s.live })),
  hydrateView: () => set({ view: loadInitialView() }),
}));

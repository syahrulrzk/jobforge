"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { useJobForgeStore, type ViewKey } from "@/store/jobforge";
import { OverviewView } from "./overview";
import { SearchView } from "./search";
import { SearchEmailView } from "./search-email";
import { SearchPeopleView } from "./search-people";
import { ActivityView } from "./activity";
import { JobsView } from "./jobs";
import { CompaniesView } from "./companies";
import { WarehouseView } from "./warehouse";
import { ContactsView } from "./contacts";
import { SourcesView } from "./sources";
import { RunsView } from "./runs";
import { DeliveriesView } from "./deliveries";
import { ErrorsView } from "./errors";
import { ApiView } from "./api";
import { SettingsView } from "./settings";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Anvil,
  Building2,
  FileText,
  Gauge,
  Mail,
  MailCheck,
  LogOut,
  Play,
  Radio,
  Search,
  Send,
  Server,
  KeyRound,
  Save,
  Settings2,
  Sun,
  Moon,
  TerminalSquare,
  Users,
  Workflow,
} from "lucide-react";

const NAV: { key: ViewKey; label: string; icon: React.ReactNode; group: string }[] = [
  { key: "overview", label: "Dashboard", icon: <Gauge className="h-4 w-4" />, group: "Monitoring" },
  { key: "activity", label: "Activity Console", icon: <TerminalSquare className="h-4 w-4" />, group: "Monitoring" },
  { key: "search", label: "Cari LokerBase", icon: <Search className="h-4 w-4" />, group: "Tools" },
  { key: "search-email", label: "Cari Email", icon: <MailCheck className="h-4 w-4" />, group: "Tools" },
  { key: "search-people", label: "Cari Orang & Jabatan", icon: <Users className="h-4 w-4" />, group: "Tools" },
  { key: "jobs", label: "Jobs", icon: <FileText className="h-4 w-4" />, group: "Data" },
  { key: "companies", label: "Companies", icon: <Building2 className="h-4 w-4" />, group: "Data" },
  { key: "warehouse", label: "Email", icon: <Save className="h-4 w-4" />, group: "Data" },
  { key: "contacts", label: "HR Contacts", icon: <Mail className="h-4 w-4" />, group: "Data" },
  { key: "sources", label: "Sources", icon: <Server className="h-4 w-4" />, group: "Pipeline" },
  { key: "runs", label: "Scraping Runs", icon: <Workflow className="h-4 w-4" />, group: "Pipeline" },
  { key: "deliveries", label: "API Deliveries", icon: <Send className="h-4 w-4" />, group: "Pipeline" },
  { key: "errors", label: "Errors", icon: <AlertTriangle className="h-4 w-4" />, group: "Pipeline" },
  { key: "api", label: "API & Integrasi", icon: <KeyRound className="h-4 w-4" />, group: "System" },
  { key: "settings", label: "Settings", icon: <Settings2 className="h-4 w-4" />, group: "System" },
];

const VIEW_TITLES: Record<ViewKey, { title: string; sub: string }> = {
  overview: { title: "Dashboard", sub: "Ringkasan pipeline — Collect. Enrich. Deliver." },
  search: { title: "Cari LokerBase", sub: "Temukan lowongan dari database & scrape live — wajib ada email HR" },
  "search-email": { title: "Cari Email", sub: "Domain Search ala hunter.io — semua email publik perusahaan dari satu domain, auto masuk gudang data" },
  "search-people": { title: "Cari Orang & Jabatan", sub: "Kontak HR per jabatan & perusahaan — dari email karir ter-publish" },
  activity: { title: "Activity Console", sub: "Log terstruktur lengkap seluruh pipeline — filter, streaming, export" },
  jobs: { title: "Jobs", sub: "Semua lowongan hasil scraping dengan status lifecycle" },
  companies: { title: "Companies", sub: "Perusahaan hasil enrichment dan deduplication" },
  warehouse: { title: "Email", sub: "Gudang data — semua email publik terkumpul dari Domain Search & harvest" },
  contacts: { title: "HR Contacts", sub: "Email HR/recruitment dari sumber publik terverifikasi" },
  sources: { title: "Sources", sub: "Kelola source adapter, schedule, dan scraper" },
  runs: { title: "Scraping Runs", sub: "Histori setiap eksekusi scraping per source" },
  deliveries: { title: "API Deliveries", sub: "Tracking pengiriman job ke Job Portal via REST API" },
  errors: { title: "Errors", sub: "Monitoring error terpusat seluruh pipeline" },
  api: { title: "API & Integrasi", sub: "Dokumentasi pull API, token consumer, dan riwayat konsumsi data" },
  settings: { title: "Settings", sub: "Konfigurasi integrasi, worker engine, dan environment" },
};

export function JobForgeShell() {
  const { view, setView, live, toggleLive, hydrateView } = useJobForgeStore();
  const [running, setRunning] = useState(false);
  const [clock, setClock] = useState<string>("");
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // restore menu terakhir dari localStorage SETELAH mount —
    // server & client render pertama harus identik (anti hydration mismatch)
    hydrateView();
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString("id-ID", { hour12: false }));
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAll = async () => {
    setRunning(true);
    toast.info("Pipeline manual dijalankan untuk semua source aktif…");
    try {
      const res = await fetch("/api/pipeline", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(json.message ?? "Pipeline selesai dijalankan");
    } catch {
      toast.error("Pipeline gagal dijalankan");
    } finally {
      setRunning(false);
    }
  };

  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border/60 bg-card/40 md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-border/60 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg shadow-amber-500/20">
            <Anvil className="h-5 w-5 text-amber-950" />
          </div>
          <div className="flex min-w-0 flex-col justify-center">
            <p className="text-sm font-bold leading-tight tracking-wide text-foreground">JOBFORGE</p>
            <p className="whitespace-nowrap text-[10px] leading-tight tracking-wide text-muted-foreground uppercase">Collect · Enrich · Deliver</p>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group}>
              <p className="mb-1.5 px-2 text-[10px] font-semibold tracking-widest text-muted-foreground/70 uppercase">{group}</p>
              <div className="space-y-0.5">
                {NAV.filter((n) => n.group === group).map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setView(item.key)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      view === item.key
                        ? "bg-amber-500/15 font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <span className={view === item.key ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>{item.icon}</span>
                    {item.label}
                    {item.key === "errors" && (
                      <span className="ml-auto rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] tabular-nums text-rose-600 dark:text-rose-400">live</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-card/40 px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-amber-400 to-amber-600">
              <Anvil className="h-4 w-4 text-amber-950" />
            </div>
            <p className="text-sm font-bold">JOBFORGE</p>
          </div>
          <div className="hidden min-w-0 md:block">
            <h1 className="text-sm font-semibold text-foreground">{VIEW_TITLES[view].title}</h1>
            <p className="truncate text-[11px] text-muted-foreground">{VIEW_TITLES[view].sub}</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* mobile nav */}
            <select
              value={view}
              onChange={(e) => setView(e.target.value as ViewKey)}
              className="rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground md:hidden"
            >
              {NAV.map((n) => (
                <option key={n.key} value={n.key}>{n.label}</option>
              ))}
            </select>

            <span className="hidden items-center gap-1.5 rounded-md border border-border bg-card/70 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-muted-foreground lg:flex">
              {clock} WIB
            </span>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="h-8 w-8 p-0"
              title={mounted && resolvedTheme === "dark" ? "Ganti ke mode light" : "Ganti ke mode dark"}
            >
              {mounted && resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <Button
              size="sm"
              variant={live ? "default" : "outline"}
              onClick={toggleLive}
              className={cn(
                "h-8 gap-1.5",
                live
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                  : "text-muted-foreground"
              )}
              title={live ? "Live polling aktif" : "Live polling mati"}
            >
              <Radio className={cn("h-3.5 w-3.5", live && "animate-pulse")} />
              <span className="hidden sm:inline">{live ? "LIVE" : "PAUSED"}</span>
            </Button>

            <Button
              size="sm"
              onClick={() => void runAll()}
              disabled={running}
              className="h-8 gap-1.5 bg-amber-500 text-amber-950 hover:bg-amber-400 dark:text-zinc-950"
            >
              <Play className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{running ? "Menjalankan…" : "Run Pipeline"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/login";
              }}
              className="h-8 w-8 p-0"
              title="Keluar (logout)"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </header>

        {/* View container */}
        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          {view === "overview" && <OverviewView live={live} />}
          {view === "search" && <SearchView />}
          {view === "search-email" && <SearchEmailView />}
          {view === "search-people" && <SearchPeopleView />}
          {view === "activity" && <ActivityView live={live} />}
          {view === "jobs" && <JobsView live={live} />}
          {view === "companies" && <CompaniesView live={live} />}
          {view === "warehouse" && <WarehouseView />}
          {view === "contacts" && <ContactsView live={live} />}
          {view === "sources" && <SourcesView live={live} />}
          {view === "runs" && <RunsView live={live} />}
          {view === "deliveries" && <DeliveriesView live={live} />}
          {view === "errors" && <ErrorsView live={live} />}
          {view === "api" && <ApiView live={live} />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

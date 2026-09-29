"use client";

// Cari LokerBase (PRD §29 search) — dua mode pencarian:
//
//   1. Cari Database  — instan, filter job yang sudah ada di DB
//   2. Scrape Live    — pilih board dari Data Sources, engine jalan
//                       scraping on-demand untuk kata kunci posisi;
//                       engine tiap board ngikutin setting source
//                       (§9.3 multi-engine), hasil masuk DB
//                       (fingerprint dedup) lalu ditampilkan dari DB
//
// Aturan enrichment (direktif user): SEMUA lowongan masuk DB. Yang punya
// email HR langsung jalan di pipeline (SCRAPED); yang belum ada emailnya
// disimpan ber-status NEEDS_ENRICHMENT (badge kuning di Jobs view) dan
// di-recovery worker / scrape berikutnya untuk pencarian email lanjutan.
//
// Hasil kartu membuka detail lengkap via JobDetailSheet.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, BriefcaseBusiness, Building2, ChevronLeft, ChevronRight, Database, Globe, Layers, Loader2, MapPin, Search, Sparkles, X, Zap } from "lucide-react";
import { CompanyAvatar, EmptyState, StatusBadge, formatIDR, timeAgo } from "./ui-bits";
import { JobDetailSheet } from "./job-detail-sheet";
import { ENGINES, type EngineKey } from "@/lib/jobforge/engines";
import { useApi } from "@/hooks/use-api";
import { gridColumns } from "@/hooks/use-dynamic-page-size";

interface JobRow {
  id: string;
  title: string;
  company: { id: string; name: string; logoUrl: string; website: string | null } | null;
  source: { slug: string; name: string; url: string } | null;
  location: string | null;
  workplaceType: string | null;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  status: string;
  scrapedAt: string;
}

interface JobsResponse {
  total: number;
  page: number;
  pageSize: number;
  jobs: JobRow[];
}

interface LiveEngineAttempt {
  engine: EngineKey;
  status: "success" | "failed";
  httpStatus?: number;
  durationMs: number;
  note?: string;
}

interface LiveBoardResult {
  board: string;
  slug: string;
  engine: EngineKey;
  engines: EngineKey[];
  attempts: LiveEngineAttempt[];
  status: "success" | "failed";
  found: number;
  created: number;
  duplicate: number;
  needsEnrichment: number;
  enriched: number;
  skipped: number;
  durationMs: number;
  error?: string;
}

interface LiveSearchResponse {
  q: string;
  durationMs: number;
  boards: LiveBoardResult[];
  totalFound: number;
  totalCreated: number;
  totalDuplicate: number;
  totalNeedsEnrichment: number;
  totalEnriched: number;
  totalSkipped: number;
}

// Source dari Data Sources — dipakai sebagai picker board di mode live
interface SourceRow {
  slug: string;
  name: string;
  status: string;
  engine: string;
  engines: string;
}

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-emerald-400",
  ERROR: "bg-rose-400",
  INACTIVE: "bg-zinc-600",
};

function primaryEngine(s: SourceRow): string {
  return (s.engines || s.engine || "cheerio").split(",")[0].trim();
}

function engineChainLabel(s: SourceRow): string {
  return (s.engines || s.engine || "cheerio")
    .split(",")
    .map((e) => ENGINES[e.trim() as EngineKey]?.name ?? e.trim())
    .join(" → ");
}

// Kota populer Indonesia — chip cepat buat filter lokasi (contains,
// jadi "Jakarta" mencakup Jakarta Selatan/Utara/Barat/Pusat).
const POPULAR_CITIES = ["Jakarta", "Surabaya", "Bandung", "Bekasi", "Makassar"];

// Kategori pekerjaan — chips filter (§ PRD: employmentType + workplaceType)
const EMPLOYMENT_CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: "FULL_TIME", label: "Full-time", hint: "Pekerjaan tetap / karyawan penuh waktu" },
  { key: "PART_TIME", label: "Part-time", hint: "Kerja paruh waktu" },
  { key: "FREELANCE", label: "Freelance", hint: "Proyek lepas / per-job" },
  { key: "CONTRACT", label: "Kontrak", hint: "Kontrak kerja berjangka waktu" },
  { key: "INTERNSHIP", label: "Internship", hint: "Magang / fresh graduate program" },
];

const WORKPLACE_CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: "ONSITE", label: "WFO", hint: "Work From Office — kerja di kantor" },
  { key: "HYBRID", label: "Hybrid", hint: "Campuran kantor & rumah" },
  { key: "REMOTE", label: "Remote", hint: "Kerja dari mana saja" },
];

type Mode = "db" | "live";

interface Applied {
  q: string;
  loc: string;
  company: string; // nama ATAU domain perusahaan ("sim group" / "simgroup.co.id")
  employment: string; // FULL_TIME | PART_TIME | FREELANCE | CONTRACT | INTERNSHIP | ""
  workplace: string; // ONSITE | HYBRID | REMOTE | ""
}

export function SearchView() {
  const [mode, setMode] = useState<Mode>("db");
  const [input, setInput] = useState("");
  const [locInput, setLocInput] = useState("");
  const [applied, setApplied] = useState<Applied>({ q: "", loc: "", company: "", employment: "", workplace: "" });
  const [page, setPage] = useState(1);
  const [companyInput, setCompanyInput] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // chip kategori — employment & workplace (draft sebelum apply)
  const [employment, setEmployment] = useState("");
  const [workplace, setWorkplace] = useState("");

  const [liveRunning, setLiveRunning] = useState(false);
  const [liveResult, setLiveResult] = useState<LiveSearchResponse | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [showEnrichBanner, setShowEnrichBanner] = useState(false);

  // Board picker — daftar source dari Data Sources (DB), bukan hardcode.
  // Default terpilih: semua source ACTIVE.
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [selectedBoards, setSelectedBoards] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/sources", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { sources?: SourceRow[] };
        const rows = json.sources ?? [];
        setSources(rows);
        setSelectedBoards(new Set(rows.filter((s) => s.status === "ACTIVE").map((s) => s.slug)));
      } catch {
        // picker tetap kosong — mode live pakai default semua ACTIVE
      }
    })();
  }, []);

  const toggleBoard = (slug: string) => {
    setSelectedBoards((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const applyNow = (q = input, loc = locInput, comp = companyInput, emp = employment, wp = workplace) => {
    setApplied({ q: q.trim(), loc: loc.trim(), company: comp.trim(), employment: emp, workplace: wp });
    setPage(1);
  };

  // debounce 350ms — instant search as you type (database mode only)
  useEffect(() => {
    if (mode !== "db") return;
    const t = setTimeout(
      () => setApplied({ q: input.trim(), loc: locInput.trim(), company: companyInput.trim(), employment, workplace }),
      350,
    );
    return () => clearTimeout(t);
  }, [input, locInput, companyInput, employment, workplace, mode]);

  // pageSize fix 4 BARIS kartu per halaman (konsisten Companies) — total = 4 × kolom
  // aktif (2 @sm / 3 @lg / 4 @xl, sinkron dgn class grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4)
  // lazy init langsung baca window → fetch pertama sudah benar, tanpa lompatan
  const [cols, setCols] = useState(() =>
    typeof window === "undefined" ? 1 : gridColumns(window.innerWidth, [2, 3, 4]),
  );
  useEffect(() => {
    const sync = () => setCols(gridColumns(window.innerWidth, [2, 3, 4]));
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  const pageSize = 4 * cols;

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize), withEmail: "1" });
    if (applied.q) sp.set("title", applied.q);
    if (applied.loc) sp.set("location", applied.loc);
    if (applied.employment) sp.set("employment", applied.employment);
    if (applied.workplace) sp.set("workplace", applied.workplace);
    if (applied.company) {
      // domain (mengandung titik) → companyDomain; nama bebas → companyName
      if (applied.company.includes(".")) sp.set("companyDomain", applied.company);
      else sp.set("companyName", applied.company);
    }
    return `/api/jobs?${sp.toString()}`;
  }, [applied, page, pageSize]);

  const { data, loading } = useApi<JobsResponse>(url);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasQuery = applied.q || applied.loc || applied.company || applied.employment || applied.workplace;

  // ── Live scrape flow (mode "live") ──
  const runLiveSearch = async (q = input) => {
    let keyword = q.trim();
    // Kalau user cuma isi company domain tanpa posisi, pakai company sebagai keyword
    if (keyword.length < 2 && companyInput.trim().length >= 2) {
      keyword = companyInput.trim();
    }
    if (keyword.length < 2) {
      toast.error("Ketik posisi atau nama perusahaan yang mau dicari (min. 2 karakter)");
      return;
    }
    if (sources.length > 0 && selectedBoards.size === 0) {
      toast.error("Pilih minimal 1 board sumber dulu");
      return;
    }
    setLiveRunning(true);
    setLiveResult(null);
    toast.info(`Mohon ditunggu, sedang mencari “${keyword}”…`);
    try {
      const res = await fetch("/api/search/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: keyword,
          sources: [...selectedBoards],
          company: companyInput.trim() || undefined,
        }),
      });
      const json = (await res.json()) as LiveSearchResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Live scrape gagal");
      setLiveResult(json);
      // Tampilkan banner enrichment kalau scrape gagal total dan ada company input
      setShowEnrichBanner(json.totalFound === 0 && companyInput.trim().length > 0);
      applyNow(keyword, locInput);
      if (json.totalCreated > 0) {
        toast.success(`Scrape selesai ${(json.durationMs / 1000).toFixed(1)}s — ${json.totalCreated} job baru tersimpan${json.totalNeedsEnrichment > 0 ? `, ${json.totalNeedsEnrichment} ditandai NEEDS_ENRICHMENT (no email HR)` : ""}${json.totalEnriched > 0 ? `, ${json.totalEnriched} lama dienrichment ulang` : ""}`);
      } else {
        toast.info(`Scrape selesai — ${json.totalFound} hasil, semua sudah ada di database`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Live scrape gagal");
    } finally {
      setLiveRunning(false);
    }
  };

  // Chip kota — toggle: klik chip aktif = hapus filter lokasi.
  // Dipakai di kedua mode (db filter instan, live filter grid hasil scrape).
  const pickCity = (c: string) => {
    const next = applied.loc.toLowerCase() === c.toLowerCase() ? "" : c;
    setLocInput(next);
    if (mode === "db") applyNow(input, next);
    else {
      setApplied((prev) => ({ ...prev, loc: next }));
      setPage(1);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    if (m === "db") applyNow(); // instant db search with current keywords
  };

  // Company enrichment — scrape website perusahaan jika tidak ada di job portal
  const enrichCompany = async () => {
    if (!companyInput.trim()) {
      toast.error("Masukkan nama atau domain perusahaan dulu");
      return;
    }
    setEnriching(true);
    try {
      const res = await fetch("/api/companies/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: companyInput.includes(".") ? "" : companyInput.trim(),
          website: companyInput.includes(".") ? companyInput.trim() : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Enrichment gagal");
      toast.success(`Profil perusahaan berhasil dienrichment dari ${json.company.source || "website"}`);
      // Refresh search results
      applyNow(input, locInput, companyInput);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Company enrichment gagal");
    } finally {
      setEnriching(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Hero search */}
      <section className="rounded-xl border border-border bg-gradient-to-br from-card via-card/60 to-card/20 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15">
              <BriefcaseBusiness className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Cari LokerBase</h2>
              <p className="text-xs text-muted-foreground">
                {mode === "db"
                  ? "Filter instan dari database job hasil scraping pipeline"
                  : "Pilih board dari Data Sources — engine scrape ngikutin setting engine di tiap source"}
              </p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="inline-flex rounded-lg border border-border bg-background dark:bg-zinc-950 p-0.5">
            <button
              onClick={() => switchMode("db")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "db" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "text-muted-foreground hover:text-foreground/90"
              }`}
            >
              <Database className="h-3.5 w-3.5" /> Cari Database
            </button>
            <button
              onClick={() => switchMode("live")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "live" ? "bg-teal-500/15 text-teal-700 dark:text-teal-300" : "text-muted-foreground hover:text-foreground/90"
              }`}
            >
              <Zap className="h-3.5 w-3.5" /> Scrape Live (Engine)
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder={mode === "db" ? "Posisi yang dicari — mis. frontend, data analyst…" : "Posisi buat di-scrape live — mis. business analyst…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (mode === "db" ? applyNow() : void runLiveSearch())}
              disabled={liveRunning}
              className="h-11 border-border bg-background dark:bg-zinc-950 pl-9 text-sm"
            />
          </div>
          <div className="relative sm:w-56">
            <MapPin className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Lokasi (opsional)"
              value={locInput}
              onChange={(e) => setLocInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (mode === "db" ? applyNow() : void runLiveSearch())}
              disabled={liveRunning}
              className="h-11 border-border bg-background dark:bg-zinc-950 pl-9 text-sm"
            />
          </div>
          <div className="relative sm:w-60">
            <Building2 className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="example.com"
              value={companyInput}
              onChange={(e) => setCompanyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (mode === "db" ? applyNow() : void runLiveSearch())}
              disabled={liveRunning}
              className="h-11 border-border bg-background dark:bg-zinc-950 pl-9 pr-24 text-sm"
            />
            {companyInput && (
              <button
                onClick={() => {
                  setCompanyInput("");
                  if (mode === "db") applyNow(input, locInput, "");
                }}
                className="absolute top-1/2 right-12 -translate-y-1/2 text-muted-foreground hover:text-foreground/90"
                title="Hapus filter perusahaan"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => void enrichCompany()}
              disabled={enriching || liveRunning || !companyInput.trim()}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:text-amber-300 disabled:opacity-30 disabled:text-muted-foreground/80"
              title="Enrich profil perusahaan dari website"
            >
              {enriching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            </button>
          </div>
          {mode === "db" ? (
            <Button className="h-11 bg-amber-500 px-5 text-zinc-950 hover:bg-amber-400" onClick={() => applyNow()}>
              <Search className="h-4 w-4" /> Cari
            </Button>
          ) : (
            <Button
              className="h-11 bg-teal-500 px-5 text-zinc-950 hover:bg-teal-400"
              onClick={() => void runLiveSearch()}
              disabled={liveRunning}
            >
              {liveRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {liveRunning ? "Scraping…" : "Scrape Sekarang"}
            </Button>
          )}
        </div>

        {/* Board picker (live mode) — sumber = Data Sources yang sudah ditambahkan */}
        {mode === "live" && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Layers className="h-3.5 w-3.5" /> Board sumber:
            </span>
            {sources.map((s) => {
              const on = selectedBoards.has(s.slug);
              const pe = ENGINES[primaryEngine(s) as EngineKey];
              return (
                <button
                  key={s.slug}
                  type="button"
                  disabled={liveRunning}
                  onClick={() => toggleBoard(s.slug)}
                  title={`${s.name} · ${s.status} · engine: ${engineChainLabel(s)}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                    on
                      ? "border-teal-500/50 bg-teal-500/15 text-teal-800 dark:text-teal-200"
                      : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground/90"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s.status] ?? "bg-zinc-600"}`} />
                  {s.name}
                  <span className={`rounded px-1 text-[9px] font-semibold ${on && pe ? pe.badge : "bg-accent text-muted-foreground"}`}>
                    {pe?.name ?? primaryEngine(s)}
                  </span>
                </button>
              );
            })}
            {sources.length === 0 && (
              <span className="text-[11px] text-muted-foreground/80">
                Belum ada source — tambahkan dulu di menu Data Sources
              </span>
            )}
            {sources.length > 0 && selectedBoards.size < sources.length && (
              <button
                type="button"
                disabled={liveRunning}
                onClick={() => setSelectedBoards(new Set(sources.filter((s) => s.status === "ACTIVE").map((s) => s.slug)))}
                className="rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-zinc-600 hover:text-foreground/90 disabled:opacity-50"
              >
                Reset ke semua aktif
              </button>
            )}
          </div>
        )}

        {/* Kategori pekerjaan — chips employment + workplace (toggle) */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 flex items-center gap-1 text-[11px] text-muted-foreground/80">
            <Layers className="h-3 w-3" /> Kategori:
          </span>
          {EMPLOYMENT_CATEGORIES.map((c) => {
            const active = employment === c.key;
            return (
              <button
                key={c.key}
                type="button"
                disabled={liveRunning}
                onClick={() => {
                  const next = active ? "" : c.key;
                  setEmployment(next);
                  if (mode === "db") applyNow(input, locInput, companyInput, next, workplace);
                }}
                title={c.hint}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                  active
                    ? "border-amber-500/50 bg-amber-500/15 font-medium text-amber-700 dark:text-amber-300"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-border" />
          {WORKPLACE_CATEGORIES.map((c) => {
            const active = workplace === c.key;
            return (
              <button
                key={c.key}
                type="button"
                disabled={liveRunning}
                onClick={() => {
                  const next = active ? "" : c.key;
                  setWorkplace(next);
                  if (mode === "db") applyNow(input, locInput, companyInput, employment, next);
                }}
                title={c.hint}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                  active
                    ? "border-teal-500/50 bg-teal-500/15 font-medium text-teal-700 dark:text-teal-300"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Chip kota populer — filter lokasi sekali klik (toggle) */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 flex items-center gap-1 text-[11px] text-muted-foreground/80">
            <MapPin className="h-3 w-3" /> Kota:
          </span>
          {POPULAR_CITIES.map((c) => {
            const active = applied.loc.toLowerCase() === c.toLowerCase();
            return (
              <button
                key={c}
                disabled={liveRunning}
                onClick={() => pickCity(c)}
                title={active ? `Hapus filter ${c}` : `Filter lowongan di ${c} + sekitarnya`}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                  active
                    ? mode === "live"
                      ? "border-teal-500/50 bg-teal-500/15 text-teal-700 dark:text-teal-300"
                      : "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                <MapPin className="h-2.5 w-2.5" />
                {c}
                {active && <span aria-hidden>×</span>}
              </button>
            );
          })}
        </div>

        {mode === "live" && liveRunning && (
          <p className="mt-3 flex items-center gap-2 rounded-lg border border-teal-500/20 bg-teal-500/5 px-3 py-2 text-xs text-teal-700 dark:text-teal-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Mohon ditunggu, sedang mencari lowongan “{input}”…
          </p>
        )}

        {/* Live scrape breakdown per board */}
        {mode === "live" && liveResult && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Selesai dalam <span className="font-semibold tabular-nums text-foreground/90">{(liveResult.durationMs / 1000).toFixed(1)}s</span> —{" "}
              <span className="font-semibold text-teal-700 dark:text-teal-300">{liveResult.totalCreated} job baru</span> tersimpan,{" "}
              {liveResult.totalDuplicate} duplikat dilewati{" "}
              {liveResult.totalNeedsEnrichment > 0 && (
                <>
                  · <span className="font-medium text-yellow-700 dark:text-yellow-300">{liveResult.totalNeedsEnrichment} NEEDS_ENRICHMENT (no email HR)</span>{" "}
                </>
              )}
              {liveResult.totalEnriched > 0 && (
                <>
                  · <span className="font-medium text-emerald-700 dark:text-emerald-300">{liveResult.totalEnriched} lama dienrichment ulang</span>{" "}
                </>
              )}
              · {liveResult.totalFound} hasil ditemukan
            </p>

            {/* Fallback ke company enrichment kalau scrape gagal total */}
            {showEnrichBanner && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="flex-1 text-xs text-amber-700 dark:text-amber-300">
                  Tidak ada lowongan ditemukan di job portal. Coba enrich profil perusahaan dari website?
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                  onClick={() => void enrichCompany()}
                  disabled={enriching}
                >
                  {enriching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Enrich dari Website
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {liveResult.boards.map((b) => {
                const attemptDetail = (b.attempts ?? []).length
                  ? (b.attempts as LiveEngineAttempt[])
                      .map((a) => `${ENGINES[a.engine as EngineKey]?.name ?? a.engine}: ${a.status === "success" ? "sukses" : "gagal"}${a.httpStatus ? ` HTTP ${a.httpStatus}` : ""} (${a.durationMs}ms)${a.note ? ` — ${a.note}` : ""}`)
                      .join("  |  ")
                  : null;
                return (
                  <span
                    key={b.slug}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                      b.status === "success"
                        ? "border-border bg-card text-foreground/90"
                        : "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300"
                    }`}
                    title={attemptDetail ?? b.error ?? `${b.board} — ${b.durationMs}ms`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${b.status === "success" ? "bg-emerald-400" : "bg-rose-400"}`} />
                    {b.board}
                    {/* seluruh engine yang dicoba — failover chain terlihat, bukan cuma 1 */}
                    {(b.attempts ?? [{ engine: b.engine, status: b.status, durationMs: b.durationMs }]).map((a, ai) => {
                      const m = ENGINES[a.engine as EngineKey];
                      const fail = a.status !== "success";
                      return (
                        <span
                          key={`${b.slug}-${ai}`}
                          className={`rounded px-1 text-[9px] font-semibold ${
                            fail ? "bg-accent text-muted-foreground line-through decoration-zinc-600" : m?.badge ?? "bg-accent text-muted-foreground"
                          }`}
                        >
                          {m?.name ?? a.engine}
                        </span>
                      );
                    })}
                    {b.status === "success" ? (
                      <span className="tabular-nums">
                        <span className="font-semibold text-teal-700 dark:text-teal-300">{b.created}</span> baru / {b.found} found
                        {b.needsEnrichment > 0 && <span className="text-yellow-700 dark:text-yellow-300/80"> · {b.needsEnrichment} no-email</span>}
                        {b.enriched > 0 && <span className="text-emerald-700 dark:text-emerald-300/80"> · {b.enriched} enriched</span>}
                      </span>
                    ) : (
                      <span>
                        gagal
                        {(b.attempts?.length ?? 0) > 1 && <span className="text-muted-foreground"> · {b.attempts.length} engine</span>}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
            {/* Alasan gagal ditulis LANGSUNG di sini — bukan cuma di tooltip */}
            {liveResult.boards.some((b) => b.status === "failed" && b.error) && (
              <div className="space-y-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2">
                {liveResult.boards
                  .filter((b) => b.status === "failed" && b.error)
                  .map((b) => (
                    <p key={b.slug} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        <span className="font-semibold">{b.board}</span> — {b.error}
                      </span>
                    </p>
                  ))}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Portal yang memblokir scraper anonim butuh akses resmi atau proxy — board publik lain tetap bisa dipakai untuk mencari.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Result count */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {loading && !data ? (
            "Mencari…"
          ) : !data ? (
            "—"
          ) : hasQuery ? (
            <>
              <span className="font-semibold tabular-nums text-foreground/90">{data.total.toLocaleString("id-ID")}</span> lowongan ditemukan
              {applied.q && <> untuk <span className={mode === "live" ? "text-teal-700 dark:text-teal-300" : "text-amber-700 dark:text-amber-300"}>“{applied.q}”</span></>}
              {applied.loc && <> di <span className={mode === "live" ? "text-teal-700 dark:text-teal-300" : "text-amber-700 dark:text-amber-300"}>“{applied.loc}”</span></>}
              {applied.employment && (
                <>
                  {" · "}
                  <span className="text-amber-700 dark:text-amber-300">
                    {EMPLOYMENT_CATEGORIES.find((c) => c.key === applied.employment)?.label ?? applied.employment}
                  </span>
                </>
              )}
              {applied.workplace && (
                <>
                  {" · "}
                  <span className="text-teal-700 dark:text-teal-300">
                    {WORKPLACE_CATEGORIES.find((c) => c.key === applied.workplace)?.label ?? applied.workplace}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <span className="font-semibold tabular-nums text-foreground/90">{data.total.toLocaleString("id-ID")}</span> lowongan tersedia — masukkan kata kunci untuk menyaring
            </>
          )}
        </p>
        <div className="flex gap-1.5">
          {mode === "live" && liveResult && !liveRunning && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-teal-500/30 bg-teal-500/10 text-xs text-teal-700 dark:text-teal-300 hover:bg-teal-500/20"
              onClick={() => void runLiveSearch()}
            >
              <Zap className="h-3 w-3" /> Scrape ulang
            </Button>
          )}
          {hasQuery && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-border bg-card text-xs text-muted-foreground"
              onClick={() => {
                setInput("");
                setLocInput("");
                setCompanyInput("");
                setEmployment("");
                setWorkplace("");
                setApplied({ q: "", loc: "", company: "", employment: "", workplace: "" });
                setPage(1);
              }}
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Results grid */}
      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-[132px] animate-pulse rounded-xl border border-border bg-card/60" />
          ))}
        </div>
      ) : data.jobs.length === 0 ? (
        <EmptyState
          title="Tidak ada lowongan yang cocok"
          hint={
            mode === "live"
              ? "Coba kata kunci lain, scrape ulang, atau pilih board lain di picker Board sumber — engine butuh board yang punya posisi tersebut"
              : "Coba kata kunci lain, kurangi filter, atau pakai mode Scrape Live untuk mencari dari board langsung"
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.jobs.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedId(j.id)}
              className="group flex h-full flex-col gap-2.5 rounded-xl border border-border bg-card/60 p-4 text-left transition-colors hover:border-amber-500/40 hover:bg-card"
            >
              <div className="flex items-start gap-3">
                <CompanyAvatar name={j.company?.name ?? j.title} logoUrl={j.company?.logoUrl} website={j.company?.website} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-snug font-semibold text-foreground group-hover:text-amber-800 dark:text-amber-200">{j.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{j.company?.name ?? "Perusahaan belum terpetakan"}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {j.workplaceType === "REMOTE" && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300">
                    <Globe className="h-3 w-3" /> Remote
                  </span>
                )}
                {j.workplaceType === "HYBRID" && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                    <Globe className="h-3 w-3" /> Hybrid
                  </span>
                )}
                {j.employmentType && (
                  <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {EMPLOYMENT_CATEGORIES.find((c) => c.key === j.employmentType)?.label ?? j.employmentType.replace("_", "-").toLowerCase()}
                  </span>
                )}
                {j.location && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{j.location}</span>
                  </span>
                )}
              </div>

              <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                <span className="font-mono text-xs tabular-nums text-emerald-700 dark:text-emerald-300">{formatIDR(j.salaryMin, j.salaryMax, j.currency)}</span>
                <div className="flex items-center gap-1.5">
                  {j.source && <Badge variant="outline" className="border-border bg-accent/60 px-1.5 py-0 text-[10px] text-muted-foreground">{j.source.name}</Badge>}
                  <StatusBadge status={j.status} />
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground/80">{timeAgo(j.scrapedAt)}</p>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.jobs.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Halaman {data.page} dari {totalPages}
          </p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-7 border-border bg-card" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Button>
            <Button variant="outline" size="sm" className="h-7 border-border bg-card" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <JobDetailSheet selectedId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

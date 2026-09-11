"use client";

// Cari Lowongan (PRD §29 search) — dua mode pencarian:
//
//   1. Cari Database  — instan, filter job yang sudah ada di DB
//   2. Scrape Live    — engine pool jalan scraping on-demand ke semua real
//                       board untuk kata kunci posisi, hasil masuk DB
//                       (fingerprint dedup) lalu ditampilkan dari DB
//
// Hasil kartu membuka detail lengkap via JobDetailSheet.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { BriefcaseBusiness, ChevronLeft, ChevronRight, Database, Globe, Loader2, MapPin, Search, Zap } from "lucide-react";
import { CompanyAvatar, EmptyState, StatusBadge, formatIDR, timeAgo } from "./ui-bits";
import { JobDetailSheet } from "./job-detail-sheet";
import { ENGINES, type EngineKey } from "@/lib/jobforge/engines";
import { useApi } from "@/hooks/use-api";

interface JobRow {
  id: string;
  title: string;
  company: { id: string; name: string; logoUrl: string; website: string | null } | null;
  source: { slug: string; name: string; url: string } | null;
  location: string | null;
  workplaceType: string | null;
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

interface LiveBoardResult {
  board: string;
  slug: string;
  engine: EngineKey;
  status: "success" | "failed";
  found: number;
  created: number;
  duplicate: number;
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
}

const POPULAR_POSITIONS = [
  "Frontend Developer",
  "Backend Developer",
  "Fullstack Developer",
  "Data Analyst",
  "DevOps Engineer",
  "UI/UX Designer",
  "Product Manager",
  "Business Analyst",
];

type Mode = "db" | "live";

interface Applied {
  q: string;
  loc: string;
  remote: boolean;
}

export function SearchView() {
  const [mode, setMode] = useState<Mode>("db");
  const [input, setInput] = useState("");
  const [locInput, setLocInput] = useState("");
  const [remote, setRemote] = useState(false);
  const [applied, setApplied] = useState<Applied>({ q: "", loc: "", remote: false });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [liveRunning, setLiveRunning] = useState(false);
  const [liveResult, setLiveResult] = useState<LiveSearchResponse | null>(null);

  const applyNow = (q = input, loc = locInput, rem = remote) => {
    setApplied({ q: q.trim(), loc: loc.trim(), remote: rem });
    setPage(1);
  };

  // debounce 350ms — instant search as you type (database mode only)
  useEffect(() => {
    if (mode !== "db") return;
    const t = setTimeout(() => setApplied({ q: input.trim(), loc: locInput.trim(), remote }), 350);
    return () => clearTimeout(t);
  }, [input, locInput, remote, mode]);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: "18" });
    if (applied.q) sp.set("title", applied.q);
    if (applied.loc) sp.set("location", applied.loc);
    if (applied.remote) sp.set("remote", "true");
    return `/api/jobs?${sp.toString()}`;
  }, [applied, page]);

  const { data, loading } = useApi<JobsResponse>(url);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasQuery = applied.q || applied.loc || applied.remote;

  // ── Live scrape flow (mode "live") ──
  const runLiveSearch = async (q = input) => {
    const keyword = q.trim();
    if (keyword.length < 2) {
      toast.error("Ketik posisi yang mau dicari (min. 2 karakter)");
      return;
    }
    setLiveRunning(true);
    setLiveResult(null);
    toast.info(`Engine menjalankan scrape live ke 5 board untuk “${keyword}”…`);
    try {
      const res = await fetch("/api/search/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: keyword }),
      });
      const json = (await res.json()) as LiveSearchResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Live scrape gagal");
      setLiveResult(json);
      applyNow(keyword, locInput, remote);
      if (json.totalCreated > 0) {
        toast.success(`Scrape selesai ${(json.durationMs / 1000).toFixed(1)}s — ${json.totalCreated} job baru tersimpan, ${json.totalDuplicate} duplikat dilewati`);
      } else {
        toast.info(`Scrape selesai — ${json.totalFound} hasil, semua sudah ada di database`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Live scrape gagal");
    } finally {
      setLiveRunning(false);
    }
  };

  const pickPosition = (p: string) => {
    setInput(p);
    if (mode === "db") applyNow(p, locInput, remote);
    else void runLiveSearch(p);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    if (m === "db") applyNow(); // instant db search with current keywords
  };

  return (
    <div className="space-y-4">
      {/* Hero search */}
      <section className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900/60 to-zinc-900/20 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15">
              <BriefcaseBusiness className="h-4.5 w-4.5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-100">Cari Lowongan</h2>
              <p className="text-xs text-zinc-500">
                {mode === "db"
                  ? "Filter instan dari database job hasil scraping pipeline"
                  : "Engine jalan scraping live ke semua board untuk posisi yang kamu mau"}
              </p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            <button
              onClick={() => switchMode("db")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "db" ? "bg-amber-500/15 text-amber-300" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Database className="h-3.5 w-3.5" /> Cari Database
            </button>
            <button
              onClick={() => switchMode("live")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "live" ? "bg-teal-500/15 text-teal-300" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Zap className="h-3.5 w-3.5" /> Scrape Live (Engine)
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              autoFocus
              placeholder={mode === "db" ? "Posisi yang dicari — mis. frontend developer, data analyst…" : "Posisi buat di-scrape live — mis. business analyst…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (mode === "db" ? applyNow() : void runLiveSearch())}
              disabled={liveRunning}
              className="h-11 border-zinc-800 bg-zinc-950 pl-9 text-sm"
            />
          </div>
          <div className="relative sm:w-56">
            <MapPin className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              placeholder="Lokasi (opsional)"
              value={locInput}
              onChange={(e) => setLocInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (mode === "db" ? applyNow() : void runLiveSearch())}
              disabled={liveRunning}
              className="h-11 border-zinc-800 bg-zinc-950 pl-9 text-sm"
            />
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

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-zinc-600">{mode === "db" ? "Populer:" : "Coba scrape:"}</span>
          {POPULAR_POSITIONS.map((p) => (
            <button
              key={p}
              disabled={liveRunning}
              onClick={() => pickPosition(p)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                applied.q.toLowerCase() === p.toLowerCase()
                  ? mode === "live"
                    ? "border-teal-500/50 bg-teal-500/15 text-teal-300"
                    : "border-amber-500/50 bg-amber-500/15 text-amber-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              {p}
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-[11px] text-zinc-400">
            <Globe className="h-3.5 w-3.5 text-teal-400" /> Hanya remote
            <Switch checked={remote} onCheckedChange={(v) => setRemote(v)} className="data-[state=checked]:bg-teal-500" />
          </label>
        </div>

        {mode === "live" && liveRunning && (
          <p className="mt-3 flex items-center gap-2 rounded-lg border border-teal-500/20 bg-teal-500/5 px-3 py-2 text-xs text-teal-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Engine pool menjalankan scrape live ke Remotive, Jobicy, Arbeitnow, RemoteOK & Himalayas… (±10 detik)
          </p>
        )}

        {/* Live scrape breakdown per board */}
        {mode === "live" && liveResult && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">
              Selesai dalam <span className="font-semibold tabular-nums text-zinc-300">{(liveResult.durationMs / 1000).toFixed(1)}s</span> —{" "}
              <span className="font-semibold text-teal-300">{liveResult.totalCreated} job baru</span> tersimpan,{" "}
              {liveResult.totalDuplicate} duplikat dilewati, {liveResult.totalFound} hasil ditemukan
            </p>
            <div className="flex flex-wrap gap-1.5">
              {liveResult.boards.map((b) => {
                const meta = ENGINES[b.engine as EngineKey];
                return (
                  <span
                    key={b.slug}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                      b.status === "success"
                        ? "border-zinc-800 bg-zinc-900 text-zinc-300"
                        : "border-rose-500/30 bg-rose-500/5 text-rose-300"
                    }`}
                    title={b.error ?? `${b.board} via ${meta?.name ?? b.engine} — ${b.durationMs}ms`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${b.status === "success" ? meta?.dot ?? "bg-zinc-400" : "bg-rose-400"}`} />
                    {b.board}
                    <span className={`rounded px-1 text-[9px] font-semibold ${meta?.badge ?? "bg-zinc-800 text-zinc-400"}`}>{meta?.name ?? b.engine}</span>
                    {b.status === "success" ? (
                      <span className="tabular-nums">
                        <span className="font-semibold text-teal-300">{b.created}</span> baru / {b.found} found
                      </span>
                    ) : (
                      <span>gagal</span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Result count */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          {loading && !data ? (
            "Mencari…"
          ) : !data ? (
            "—"
          ) : hasQuery ? (
            <>
              <span className="font-semibold tabular-nums text-zinc-300">{data.total.toLocaleString("id-ID")}</span> lowongan ditemukan
              {applied.q && <> untuk <span className={mode === "live" ? "text-teal-300" : "text-amber-300"}>“{applied.q}”</span></>}
              {applied.loc && <> di <span className={mode === "live" ? "text-teal-300" : "text-amber-300"}>“{applied.loc}”</span></>}
              {applied.remote && <> · <span className="text-teal-300">remote only</span></>}
            </>
          ) : (
            <>
              <span className="font-semibold tabular-nums text-zinc-300">{data.total.toLocaleString("id-ID")}</span> lowongan tersedia — masukkan kata kunci untuk menyaring
            </>
          )}
        </p>
        <div className="flex gap-1.5">
          {mode === "live" && liveResult && !liveRunning && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-teal-500/30 bg-teal-500/10 text-xs text-teal-300 hover:bg-teal-500/20"
              onClick={() => void runLiveSearch()}
            >
              <Zap className="h-3 w-3" /> Scrape ulang
            </Button>
          )}
          {hasQuery && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-zinc-800 bg-zinc-900 text-xs text-zinc-400"
              onClick={() => {
                setInput("");
                setLocInput("");
                setRemote(false);
                setApplied({ q: "", loc: "", remote: false });
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
            <div key={i} className="h-[132px] animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60" />
          ))}
        </div>
      ) : data.jobs.length === 0 ? (
        <EmptyState
          title="Tidak ada lowongan yang cocok"
          hint={
            mode === "live"
              ? "Coba kata kunci lain atau scrape ulang — engine butuh board yang punya posisi tersebut"
              : "Coba kata kunci lain, kurangi filter, atau pakai mode Scrape Live untuk mencari dari board langsung"
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.jobs.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedId(j.id)}
              className="group flex h-full flex-col gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left transition-colors hover:border-amber-500/40 hover:bg-zinc-900"
            >
              <div className="flex items-start gap-3">
                <CompanyAvatar name={j.company?.name ?? j.title} logoUrl={j.company?.logoUrl} website={j.company?.website} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-snug font-semibold text-zinc-100 group-hover:text-amber-200">{j.title}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-400">{j.company?.name ?? "Perusahaan belum terpetakan"}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                {j.workplaceType === "REMOTE" && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-300">
                    <Globe className="h-3 w-3" /> Remote
                  </span>
                )}
                {j.location && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{j.location}</span>
                  </span>
                )}
              </div>

              <div className="mt-auto flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-2.5">
                <span className="font-mono text-xs tabular-nums text-emerald-300">{formatIDR(j.salaryMin, j.salaryMax, j.currency)}</span>
                <div className="flex items-center gap-1.5">
                  {j.source && <Badge variant="outline" className="border-zinc-700 bg-zinc-800/60 px-1.5 py-0 text-[10px] text-zinc-400">{j.source.name}</Badge>}
                  <StatusBadge status={j.status} />
                </div>
              </div>

              <p className="text-[10px] text-zinc-600">{timeAgo(j.scrapedAt)}</p>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.jobs.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            Halaman {data.page} dari {totalPages}
          </p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-7 border-zinc-800 bg-zinc-900" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Button>
            <Button variant="outline" size="sm" className="h-7 border-zinc-800 bg-zinc-900" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <JobDetailSheet selectedId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

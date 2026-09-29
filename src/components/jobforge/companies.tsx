"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight, ExternalLink, Globe, Mail, Search } from "lucide-react";
import { CompanyAvatar, EmptyState, StatusBadge, timeAgo } from "./ui-bits";
import { useApi } from "@/hooks/use-api";
import { gridColumns } from "@/hooks/use-dynamic-page-size";
import { useJobForgeStore } from "@/store/jobforge";

interface CompanyRow {
  id: string;
  name: string;
  logoUrl: string;
  website: string | null;
  industry: string | null;
  size: string | null;
  profile: string;
  jobCount: number;
  activeJobs: number;
  hrContacts: { hrEmail: string; emailStatus: string }[];
  harvestEmailCount: number;
  lastJob: { scrapedAt: string; title: string } | null;
  enrichedAt: string | null;
}

interface CompaniesResponse {
  total: number;
  page: number;
  pageSize: number;
  companies: CompanyRow[];
}

interface CompanyDetail {
  company: CompanyRow & { normalizedName: string; createdAt: string };
  jobs: { id: string; title: string; status: string; location: string | null; scrapedAt: string }[];
  contacts: { hrEmail: string; emailStatus: string; emailVerified: boolean; jobTitle: string }[];
  harvested: { email: string; kind: string; category: string | null; via: string; sourceUrl: string | null; createdAt: string }[];
  sources: { name: string; slug: string }[];
}

export function CompaniesView({ live }: { live: boolean }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // default: tampilkan hanya perusahaan yang punya email (lengkap)
  const [hasEmailOnly, setHasEmailOnly] = useState(true);
  // pageSize fix 4 BARIS kartu per halaman (permintaan user) — total = 4 × kolom
  // aktif (2 @sm / 3 @lg+ / 3 @xl+, sinkron dgn class grid sm:grid-cols-2 lg:grid-cols-3)
  // lazy init langsung baca window → fetch pertama sudah pakai pageSize benar (tanpa lompatan)
  const [cols, setCols] = useState(() =>
    typeof window === "undefined" ? 1 : gridColumns(window.innerWidth, [2, 3, 3]),
  );
  useEffect(() => {
    const sync = () => setCols(gridColumns(window.innerWidth, [2, 3, 3]));
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  const pageSize = 4 * cols;

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) sp.set("q", q);
    if (!hasEmailOnly) sp.set("hasEmail", "false");
    return `/api/companies?${sp.toString()}`;
  }, [q, page, hasEmailOnly, pageSize]);

  const { data } = useApi<CompaniesResponse>(url, { intervalMs: live ? 8000 : null });
  const { data: detailData } = useApi<CompanyDetail>(selectedId ? `/api/companies/${selectedId}` : null);
  const detail = detailData;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // fokus dari view lain (contoh: klik Top Companies di dashboard) → langsung buka modal detail company
  const setView = useJobForgeStore((s) => s.setView);
  const focusCompanyId = useJobForgeStore((s) => s.focusCompanyId);
  const clearCompanyFocus = useJobForgeStore((s) => s.clearCompanyFocus);
  useEffect(() => {
    if (focusCompanyId) {
      setSelectedId(focusCompanyId);
      clearCompanyFocus();
    }
  }, [focusCompanyId, clearCompanyFocus]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari perusahaan…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="h-8 border-border bg-card pl-8 text-sm"
          />
        </div>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{data ? `${data.total.toLocaleString("id-ID")} perusahaan` : "…"}</span>
        <button
          onClick={() => {
            setHasEmailOnly(!hasEmailOnly);
            setPage(1);
          }}
          title={hasEmailOnly ? "Hanya perusahaan dengan email — klik untuk lihat semua" : "Menampilkan semua perusahaan — klik untuk filter yang punya email"}
          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
            hasEmailOnly
              ? "border-emerald-500/50 bg-emerald-500/15 font-medium text-emerald-700 dark:text-emerald-300"
              : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
          }`}
        >
          Punya Email
        </button>
      </div>

      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-card/60" />
          ))}
        </div>
      ) : data.companies.length === 0 ? (
        <EmptyState title={hasEmailOnly ? "Tidak ada perusahaan dengan email" : "Tidak ada perusahaan"} hint={hasEmailOnly ? "Jalankan Domain Search atau pipeline untuk mengumpulkan email — atau klik filter Punya Email untuk lihat semua." : "Coba kata kunci lain"} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.companies.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="rounded-xl border border-border bg-card/60 p-4 text-left transition-colors hover:border-zinc-600"
            >
              <div className="flex items-start gap-3">
                <CompanyAvatar name={c.name} logoUrl={c.logoUrl} website={c.website} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {c.industry ?? "Industri belum diketahui"}
                    {c.size && <span className="text-muted-foreground/80"> · {c.size} karyawan</span>}
                  </p>
                </div>
              </div>
              <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{c.profile}</p>
              <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="tabular-nums"><b className="text-foreground/90">{c.jobCount}</b> jobs</span>
                {(() => {
                  const emails = c.harvestEmailCount + new Set(c.hrContacts.map((h) => h.hrEmail)).size;
                  return emails > 0 ? (
                    <span className="tabular-nums inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-300">
                      <Mail className="h-3 w-3" /> <b>{emails}</b> email
                    </span>
                  ) : (
                    <span className="text-muted-foreground/60">tanpa email</span>
                  );
                })()}
                {c.website && <span className="ml-auto inline-flex items-center gap-0.5 truncate"><Globe className="h-3 w-3" /> domain</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Halaman {data?.page ?? 1} dari {totalPages}</p>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-7 border-border bg-card" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <Button variant="outline" size="sm" className="h-7 border-border bg-card" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto border-border bg-background dark:bg-zinc-950 p-0 sm:max-w-lg" side="right">
          {detail ? (
            <div>
              <SheetHeader className="border-b border-border bg-card/50 p-5">
                <div className="flex items-center gap-3">
                  <CompanyAvatar name={detail.company.name} logoUrl={detail.company.logoUrl} website={detail.company.website} size={48} />
                  <div className="min-w-0">
                    <SheetTitle className="text-lg text-foreground">{detail.company.name}</SheetTitle>
                    {detail.company.website && (
                      <a href={detail.company.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-teal-700 dark:text-teal-300 hover:underline">
                        {detail.company.website} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-foreground/90">{detail.company.profile}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {detail.company.industry && <Badge variant="outline" className="border-border text-[10px] text-foreground/90">{detail.company.industry}</Badge>}
                  {detail.company.size && <Badge variant="outline" className="border-border text-[10px] text-foreground/90">{detail.company.size} karyawan</Badge>}
                </div>
              </SheetHeader>
              <div className="space-y-5 p-5">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-border bg-card/60 p-2.5">
                    <p className="text-lg font-bold tabular-nums text-foreground">{detail.jobs.length}+</p>
                    <p className="text-[10px] text-muted-foreground uppercase">Total jobs</p>
                  </div>
                  <div className="rounded-lg border border-border bg-card/60 p-2.5">
                    <p className="text-lg font-bold tabular-nums text-foreground">{detail.contacts.length}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">HR contacts</p>
                  </div>
                  <div className="rounded-lg border border-border bg-card/60 p-2.5">
                    <p className="text-lg font-bold tabular-nums text-foreground">{detail.contacts.length + detail.harvested.length}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">Total email</p>
                  </div>
                </div>

                <section>
                  <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">HR Contacts</h4>
                  {detail.contacts.length === 0 ? (
                    <p className="text-xs text-muted-foreground/80 italic">Belum ada kontak HR yang ditemukan</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.contacts.slice(0, 8).map((c, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-foreground">{c.hrEmail}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{c.jobTitle}</p>
                          </div>
                          <StatusBadge status={c.emailStatus} />
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Email harvest (Domain Search) — company bisa punya email tanpa job */}
                {detail.harvested.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Email Harvest ({detail.harvested.length})
                    </h4>
                    <div className="space-y-1.5">
                      {detail.harvested.slice(0, 12).map((h) => (
                        <div key={h.email} className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-[11px] text-foreground" title={h.email}>{h.email}</p>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {h.category ?? h.kind} · via {h.via}{h.sourceUrl ? " · " : ""}
                              {h.sourceUrl && (
                                <a href={h.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground/90">
                                  sumber <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              )}
                            </p>
                          </div>
                          <a
                            href={`mailto:${h.email}`}
                            className="shrink-0 rounded-md bg-violet-500/10 px-2 py-1 text-[10px] font-medium text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"
                          >
                            Email
                          </a>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Active Jobs</h4>
                    {detail.jobs.length > 8 && (
                      <button
                        onClick={() => {
                          setSelectedId(null);
                          setView("jobs", { focusCompany: detail.company.id, focusCompanyName: detail.company.name });
                        }}
                        className="text-[11px] font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                      >
                        Lihat semua ({detail.jobs.length})
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {detail.jobs.slice(0, 8).map((j) => (
                      <button
                        key={j.id}
                        onClick={() => {
                          setSelectedId(null);
                          setView("jobs", { focusJob: j.id });
                        }}
                        className="flex w-full items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-foreground">{j.title}</p>
                          <p className="text-[11px] text-muted-foreground">{j.location ?? "—"} · {timeAgo(j.scrapedAt)}</p>
                        </div>
                        <StatusBadge status={j.status} />
                      </button>
                    ))}
                  </div>
                </section>

                {detail.sources.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sources</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.sources.map((s, i) => (
                        <Badge key={i} variant="outline" className="border-border bg-accent/60 text-[11px] text-foreground/90">{s.name}</Badge>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 p-6">
              {/* a11y: Radix Dialog requires a Title even while detail is loading */}
              <SheetHeader className="sr-only">
                <SheetTitle>Detail Perusahaan</SheetTitle>
              </SheetHeader>
              <div className="h-8 w-1/2 animate-pulse rounded bg-accent" />
              <div className="h-24 animate-pulse rounded bg-accent/60" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

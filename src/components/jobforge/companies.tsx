"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight, ExternalLink, Globe, Search } from "lucide-react";
import { CompanyAvatar, EmptyState, StatusBadge, timeAgo } from "./ui-bits";
import { useApi } from "@/hooks/use-api";

interface CompanyRow {
  id: string;
  name: string;
  logoUrl: string;
  website: string | null;
  industry: string | null;
  profile: string;
  jobCount: number;
  activeJobs: number;
  hrContacts: { hrEmail: string; emailStatus: string }[];
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
  sources: { name: string; slug: string }[];
}

export function CompaniesView({ live }: { live: boolean }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: "12" });
    if (q) sp.set("q", q);
    return `/api/companies?${sp.toString()}`;
  }, [q, page]);

  const { data } = useApi<CompaniesResponse>(url, { intervalMs: live ? 8000 : null });
  const { data: detailData } = useApi<CompanyDetail>(selectedId ? `/api/companies/${selectedId}` : null);
  const detail = detailData;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Cari perusahaan…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="h-8 border-zinc-800 bg-zinc-900 pl-8 text-sm"
          />
        </div>
        <span className="ml-auto text-xs text-zinc-500 tabular-nums">{data ? `${data.total.toLocaleString("id-ID")} perusahaan` : "…"}</span>
      </div>

      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60" />
          ))}
        </div>
      ) : data.companies.length === 0 ? (
        <EmptyState title="Tidak ada perusahaan" hint="Coba kata kunci lain" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.companies.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left transition-colors hover:border-zinc-600"
            >
              <div className="flex items-start gap-3">
                <CompanyAvatar name={c.name} logoUrl={c.logoUrl} website={c.website} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-100">{c.name}</p>
                  <p className="truncate text-[11px] text-zinc-500">{c.industry ?? "Industri belum diketahui"}</p>
                </div>
              </div>
              <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-zinc-400">{c.profile}</p>
              <div className="mt-3 flex items-center gap-3 text-[11px] text-zinc-500">
                <span className="tabular-nums"><b className="text-zinc-300">{c.jobCount}</b> jobs</span>
                <span className="tabular-nums"><b className="text-zinc-300">{c.hrContacts.length}</b> kontak</span>
                {c.website && <span className="ml-auto inline-flex items-center gap-0.5 truncate"><Globe className="h-3 w-3" /> domain</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">Halaman {data?.page ?? 1} dari {totalPages}</p>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-7 border-zinc-800 bg-zinc-900" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <Button variant="outline" size="sm" className="h-7 border-zinc-800 bg-zinc-900" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto border-zinc-800 bg-zinc-950 p-0 sm:max-w-lg" side="right">
          {detail ? (
            <div>
              <SheetHeader className="border-b border-zinc-800 bg-zinc-900/50 p-5">
                <div className="flex items-center gap-3">
                  <CompanyAvatar name={detail.company.name} logoUrl={detail.company.logoUrl} website={detail.company.website} size={48} />
                  <div className="min-w-0">
                    <SheetTitle className="text-lg text-zinc-100">{detail.company.name}</SheetTitle>
                    {detail.company.website && (
                      <a href={detail.company.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-teal-300 hover:underline">
                        {detail.company.website} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-zinc-300">{detail.company.profile}</p>
              </SheetHeader>
              <div className="space-y-5 p-5">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
                    <p className="text-lg font-bold tabular-nums text-zinc-100">{detail.jobs.length}+</p>
                    <p className="text-[10px] text-zinc-500 uppercase">Total jobs</p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
                    <p className="text-lg font-bold tabular-nums text-zinc-100">{detail.contacts.length}</p>
                    <p className="text-[10px] text-zinc-500 uppercase">HR contacts</p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
                    <p className="text-lg font-bold tabular-nums text-zinc-100">{detail.sources.length}</p>
                    <p className="text-[10px] text-zinc-500 uppercase">Sources</p>
                  </div>
                </div>

                <section>
                  <h4 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">HR Contacts</h4>
                  {detail.contacts.length === 0 ? (
                    <p className="text-xs text-zinc-600 italic">Belum ada kontak HR yang ditemukan</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.contacts.slice(0, 8).map((c, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-zinc-200">{c.hrEmail}</p>
                            <p className="truncate text-[11px] text-zinc-500">{c.jobTitle}</p>
                          </div>
                          <StatusBadge status={c.emailStatus} />
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <h4 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Active Jobs</h4>
                  <div className="space-y-1.5">
                    {detail.jobs.slice(0, 8).map((j) => (
                      <div key={j.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-zinc-200">{j.title}</p>
                          <p className="text-[11px] text-zinc-500">{j.location ?? "—"} · {timeAgo(j.scrapedAt)}</p>
                        </div>
                        <StatusBadge status={j.status} />
                      </div>
                    ))}
                  </div>
                </section>

                {detail.sources.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Sources</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.sources.map((s, i) => (
                        <Badge key={i} variant="outline" className="border-zinc-700 bg-zinc-800/60 text-[11px] text-zinc-300">{s.name}</Badge>
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
              <div className="h-8 w-1/2 animate-pulse rounded bg-zinc-800" />
              <div className="h-24 animate-pulse rounded bg-zinc-800/60" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

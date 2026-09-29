"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { CompanyAvatar, EmptyState, PreflightBadge, StatusBadge, formatIDR, isPreflightHeld, timeAgo } from "./ui-bits";
import { JobDetailSheet } from "./job-detail-sheet";
import { useJobForgeStore } from "@/store/jobforge";
import { useApi } from "@/hooks/use-api";

interface JobRow {
  id: string;
  code: string | null;
  pulledAt: string | null;
  title: string;
  company: { id: string; name: string; logoUrl: string; website: string | null } | null;
  companyName: string | null;
  source: { slug: string; name: string; url: string } | null;
  location: string | null;
  workplaceType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  status: string;
  statusReason: string | null;
  hrEmail: string | null;
  emailStatus: string | null;
  scrapedAt: string;
  deliveryStatus: string | null;
}

interface JobsResponse {
  total: number;
  page: number;
  pageSize: number;
  jobs: JobRow[];
}

interface SourcesResponse {
  sources: { id: string; name: string }[];
}

export function JobsView({ live }: { live: boolean }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [date, setDate] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // filter company (dari "Lihat semua" di modal detail company) — null = semua
  const [companyFilter, setCompanyFilter] = useState<{ id: string; name: string } | null>(null);

  // fokus dari view lain (klik job di modal detail company → buka modal detail job; "Lihat semua" → set filter company)
  const focusJobId = useJobForgeStore((s) => s.focusJobId);
  const focusCompanyId = useJobForgeStore((s) => s.focusCompanyId);
  const focusCompanyName = useJobForgeStore((s) => s.focusCompanyName);
  const clearJobFocus = useJobForgeStore((s) => s.clearJobFocus);
  const clearCompanyFocus = useJobForgeStore((s) => s.clearCompanyFocus);
  useEffect(() => {
    if (focusJobId) {
      setSelectedId(focusJobId);
      clearJobFocus();
    }
  }, [focusJobId, clearJobFocus]);
  useEffect(() => {
    if (focusCompanyId) {
      setCompanyFilter({ id: focusCompanyId, name: focusCompanyName ?? "" });
      setPage(1);
      clearCompanyFocus();
    }
  }, [focusCompanyId, focusCompanyName, clearCompanyFocus]);
  // pageSize tetap 15 per halaman (permintaan user) — tidak dinamis
  const pageSize = 15;

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) sp.set("q", q);
    if (source !== "all") sp.set("source", source);
    if (status !== "all") sp.set("status", status);
    if (date !== "all") sp.set("date", date);
    if (companyFilter) sp.set("company", companyFilter.id);
    return `/api/jobs?${sp.toString()}`;
  }, [q, source, status, date, page, pageSize, companyFilter]);

  const { data, loading } = useApi<JobsResponse>(url, { intervalMs: live ? 5000 : null });
  const { data: sourcesData } = useApi<SourcesResponse>("/api/sources");

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Filters (PRD §29) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari judul, perusahaan, lokasi…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="h-8 border-border bg-card pl-8 text-sm"
          />
        </div>
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[150px] border-border bg-card text-sm"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent className="border-border bg-card">
            <SelectItem value="all">Semua source</SelectItem>
            {sourcesData?.sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[170px] border-border bg-card text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent className="border-border bg-card">
            {["all", "SCRAPED", "PROCESSING", "ENRICHING", "VALIDATING", "READY", "SENT", "PUBLISHED", "NEEDS_ENRICHMENT", "REJECTED", "FAILED"].map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "Semua status" : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={date} onValueChange={(v) => { setDate(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[140px] border-border bg-card text-sm"><SelectValue placeholder="Tanggal" /></SelectTrigger>
          <SelectContent className="border-border bg-card">
            <SelectItem value="all">Sepanjang waktu</SelectItem>
            <SelectItem value="24h">24 jam terakhir</SelectItem>
            <SelectItem value="7d">7 hari terakhir</SelectItem>
            <SelectItem value="30d">30 hari terakhir</SelectItem>
          </SelectContent>
        </Select>
        {companyFilter && (
          <button
            onClick={() => { setCompanyFilter(null); setPage(1); }}
            title="Hapus filter perusahaan"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-300"
          >
            <X className="h-3 w-3" />
            <span className="max-w-[180px] truncate">{companyFilter.name}</span>
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {data ? `${data.total.toLocaleString("id-ID")} job` : "…"}
        </span>
      </div>

      {/* Table — flex-1: kartu mengisi sisa tinggi viewport, pagination nempel di bawah */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card/60">
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Kode</TableHead>
                <TableHead className="text-muted-foreground">Posisi</TableHead>
                <TableHead className="text-muted-foreground">Perusahaan</TableHead>
                <TableHead className="text-muted-foreground">Source</TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">Lokasi</TableHead>
                <TableHead className="hidden text-muted-foreground lg:table-cell">Salary</TableHead>
                <TableHead className="hidden text-muted-foreground xl:table-cell">HR Email</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="hidden text-right text-muted-foreground sm:table-cell">Scraped</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-border/60">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <TableCell key={j}><div className="h-4 w-full animate-pulse rounded bg-accent" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data || data.jobs.length === 0 ? (
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableCell colSpan={9}>
                    <EmptyState title="Tidak ada job yang cocok" hint="Coba ubah filter atau kata kunci pencarian" />
                  </TableCell>
                </TableRow>
              ) : (
                data.jobs.map((j) => (
                  <TableRow
                    key={j.id}
                    className="cursor-pointer border-border/60 hover:bg-accent/30"
                    onClick={() => setSelectedId(j.id)}
                  >
                    <TableCell className="whitespace-nowrap">
                      <code className="rounded bg-card/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90">{j.code ?? "—"}</code>
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      <p className="truncate font-medium text-foreground">{j.title}</p>
                    </TableCell>
                    <TableCell>
                      {j.company ? (
                        <div className="flex items-center gap-2">
                          <CompanyAvatar name={j.company.name} logoUrl={j.company.logoUrl} website={j.company.website} size={24} />
                          <span className="hidden max-w-[140px] truncate text-sm text-foreground/90 lg:inline">{j.company.name}</span>
                        </div>
                      ) : j.companyName ? (
                        // payload scrape punya nama, belum ter-link ke Company (enrichment pending)
                        <span className="hidden max-w-[140px] truncate text-sm text-foreground/70 lg:inline">{j.companyName}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/80 italic">—</span>
                      )}
                    </TableCell>
                    <TableCell>{j.source && <Badge variant="outline" className="border-border bg-accent/60 text-[10px] text-foreground/90">{j.source.name}</Badge>}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{j.location ?? "—"}</TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-muted-foreground lg:table-cell">{formatIDR(j.salaryMin, j.salaryMax, j.currency)}</TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {j.hrEmail ? (
                        <span className="text-xs text-foreground/90">{j.hrEmail}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/80">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={j.status} />
                        {j.statusReason && isPreflightHeld(j.statusReason) && <PreflightBadge statusReason={j.statusReason} />}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">{timeAgo(j.scrapedAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Halaman {data?.page ?? 1} dari {totalPages}
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

      {/* Detail sheet (PRD §29) — shared component */}
      <JobDetailSheet selectedId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

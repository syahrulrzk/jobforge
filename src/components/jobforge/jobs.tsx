"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { CompanyAvatar, EmptyState, StatusBadge, formatIDR, timeAgo } from "./ui-bits";
import { JobDetailSheet } from "./job-detail-sheet";
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

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (q) sp.set("q", q);
    if (source !== "all") sp.set("source", source);
    if (status !== "all") sp.set("status", status);
    if (date !== "all") sp.set("date", date);
    return `/api/jobs?${sp.toString()}`;
  }, [q, source, status, date, page]);

  const { data, loading } = useApi<JobsResponse>(url, { intervalMs: live ? 5000 : null });
  const { data: sourcesData } = useApi<SourcesResponse>("/api/sources");

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      {/* Filters (PRD §29) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Cari judul, perusahaan, lokasi…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="h-8 border-zinc-800 bg-zinc-900 pl-8 text-sm"
          />
        </div>
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[150px] border-zinc-800 bg-zinc-900 text-sm"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900">
            <SelectItem value="all">Semua source</SelectItem>
            {sourcesData?.sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[170px] border-zinc-800 bg-zinc-900 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900">
            {["all", "SCRAPED", "PROCESSING", "ENRICHING", "VALIDATING", "READY", "SENT", "PUBLISHED", "NEEDS_ENRICHMENT", "REJECTED", "FAILED"].map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "Semua status" : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={date} onValueChange={(v) => { setDate(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[140px] border-zinc-800 bg-zinc-900 text-sm"><SelectValue placeholder="Tanggal" /></SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900">
            <SelectItem value="all">Sepanjang waktu</SelectItem>
            <SelectItem value="24h">24 jam terakhir</SelectItem>
            <SelectItem value="7d">7 hari terakhir</SelectItem>
            <SelectItem value="30d">30 hari terakhir</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-zinc-500 tabular-nums">
          {data ? `${data.total.toLocaleString("id-ID")} job` : "…"}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
        <ScrollArea className="max-h-[62vh]">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-zinc-900">
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Posisi</TableHead>
                <TableHead className="text-zinc-400">Perusahaan</TableHead>
                <TableHead className="text-zinc-400">Source</TableHead>
                <TableHead className="hidden text-zinc-400 md:table-cell">Lokasi</TableHead>
                <TableHead className="hidden text-zinc-400 lg:table-cell">Salary</TableHead>
                <TableHead className="hidden text-zinc-400 xl:table-cell">HR Email</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="hidden text-right text-zinc-400 sm:table-cell">Scraped</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-800/60">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><div className="h-4 w-full animate-pulse rounded bg-zinc-800" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data || data.jobs.length === 0 ? (
                <TableRow className="border-zinc-800/60 hover:bg-transparent">
                  <TableCell colSpan={8}>
                    <EmptyState title="Tidak ada job yang cocok" hint="Coba ubah filter atau kata kunci pencarian" />
                  </TableCell>
                </TableRow>
              ) : (
                data.jobs.map((j) => (
                  <TableRow
                    key={j.id}
                    className="cursor-pointer border-zinc-800/60 hover:bg-zinc-800/30"
                    onClick={() => setSelectedId(j.id)}
                  >
                    <TableCell className="max-w-[240px]">
                      <p className="truncate font-medium text-zinc-100">{j.title}</p>
                    </TableCell>
                    <TableCell>
                      {j.company ? (
                        <div className="flex items-center gap-2">
                          <CompanyAvatar name={j.company.name} logoUrl={j.company.logoUrl} website={j.company.website} size={24} />
                          <span className="hidden max-w-[140px] truncate text-sm text-zinc-300 lg:inline">{j.company.name}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-600 italic">unmapped</span>
                      )}
                    </TableCell>
                    <TableCell>{j.source && <Badge variant="outline" className="border-zinc-700 bg-zinc-800/60 text-[10px] text-zinc-300">{j.source.name}</Badge>}</TableCell>
                    <TableCell className="hidden text-sm text-zinc-400 md:table-cell">{j.location ?? "—"}</TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-zinc-400 lg:table-cell">{formatIDR(j.salaryMin, j.salaryMax, j.currency)}</TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {j.hrEmail ? (
                        <span className="text-xs text-zinc-300">{j.hrEmail}</span>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </TableCell>
                    <TableCell><StatusBadge status={j.status} /></TableCell>
                    <TableCell className="hidden text-right text-xs text-zinc-500 sm:table-cell">{timeAgo(j.scrapedAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Halaman {data?.page ?? 1} dari {totalPages}
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

      {/* Detail sheet (PRD §29) — shared component */}
      <JobDetailSheet selectedId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

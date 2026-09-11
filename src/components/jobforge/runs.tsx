"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState, StatusBadge, duration, timeAgo } from "./ui-bits";
import { useApi } from "@/hooks/use-api";

interface RunRow {
  id: string;
  source: { id: string; name: string; slug: string; scraperType: string };
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  pagesScraped: number;
  jobsFound: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsRejected: number;
  jobsDuplicate: number;
  errorCount: number;
  status: string;
}

interface RunsResponse {
  total: number;
  page: number;
  pageSize: number;
  runs: RunRow[];
}

interface SourcesResponse {
  sources: { id: string; name: string }[];
}

export function RunsView({ live }: { live: boolean }) {
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (source !== "all") sp.set("source", source);
    if (status !== "all") sp.set("status", status);
    return `/api/runs?${sp.toString()}`;
  }, [source, status, page]);

  const { data } = useApi<RunsResponse>(url, { intervalMs: live ? 5000 : null });
  const { data: sourcesData } = useApi<SourcesResponse>("/api/sources");
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[160px] border-zinc-800 bg-zinc-900 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900">
            <SelectItem value="all">Semua source</SelectItem>
            {sourcesData?.sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[140px] border-zinc-800 bg-zinc-900 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900">
            <SelectItem value="all">Semua status</SelectItem>
            <SelectItem value="RUNNING">RUNNING</SelectItem>
            <SelectItem value="SUCCESS">SUCCESS</SelectItem>
            <SelectItem value="FAILED">FAILED</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-zinc-500 tabular-nums">{data ? `${data.total.toLocaleString("id-ID")} run` : "…"}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="max-h-[62vh] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-zinc-900">
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Source</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="hidden text-zinc-400 md:table-cell">Mulai</TableHead>
                <TableHead className="hidden text-zinc-400 md:table-cell">Durasi</TableHead>
                <TableHead className="hidden text-right text-zinc-400 lg:table-cell">Pages</TableHead>
                <TableHead className="text-right text-zinc-400">Found</TableHead>
                <TableHead className="text-right text-emerald-400/80">Created</TableHead>
                <TableHead className="hidden text-right text-teal-400/70 sm:table-cell">Updated</TableHead>
                <TableHead className="hidden text-right text-yellow-400/70 sm:table-cell">Dup</TableHead>
                <TableHead className="hidden text-right text-rose-400/70 sm:table-cell">Rej</TableHead>
                <TableHead className="hidden text-right text-rose-400/70 md:table-cell">Err</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-800/60">
                    {Array.from({ length: 11 }).map((__, j) => (
                      <TableCell key={j}><div className="h-4 w-full animate-pulse rounded bg-zinc-800" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.runs.length === 0 ? (
                <TableRow className="border-zinc-800/60 hover:bg-transparent">
                  <TableCell colSpan={11}><EmptyState title="Belum ada scrape run" /></TableCell>
                </TableRow>
              ) : (
                data.runs.map((r) => (
                  <TableRow key={r.id} className="border-zinc-800/60 hover:bg-zinc-800/30">
                    <TableCell>
                      <p className="font-medium text-zinc-100">{r.source.name}</p>
                      <p className="text-[11px] text-zinc-500">{r.source.scraperType}</p>
                    </TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="hidden text-sm text-zinc-400 md:table-cell">{timeAgo(r.startedAt)}</TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-zinc-400 md:table-cell">
                      {r.status === "RUNNING" ? <span className="animate-pulse text-amber-300">berjalan…</span> : duration(r.durationMs)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums text-zinc-400 lg:table-cell">{r.pagesScraped}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-zinc-200">{r.jobsFound}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-300">{r.jobsCreated}</TableCell>
                    <TableCell className="hidden text-right tabular-nums text-teal-300/80 sm:table-cell">{r.jobsUpdated}</TableCell>
                    <TableCell className="hidden text-right tabular-nums text-yellow-300/80 sm:table-cell">{r.jobsDuplicate}</TableCell>
                    <TableCell className="hidden text-right tabular-nums text-rose-300/80 sm:table-cell">{r.jobsRejected}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      <span className={r.errorCount > 0 ? "text-rose-400" : "text-zinc-600"}>{r.errorCount}</span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

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
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState, StatusBadge, timeAgo } from "./ui-bits";
import { useApi } from "@/hooks/use-api";

interface ErrorRow {
  id: string;
  errorType: string;
  message: string;
  stack: string | null;
  retryCount: number;
  status: string;
  firstSeen: string;
  lastSeen: string;
  source: { name: string; slug: string } | null;
}

interface ErrorsResponse {
  total: number;
  page: number;
  pageSize: number;
  openCount: number;
  byType: { type: string; count: number }[];
  errors: ErrorRow[];
}

export function ErrorsView({ live }: { live: boolean }) {
  const [type, setType] = useState("all");
  const [page, setPage] = useState(1);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (type !== "all") sp.set("type", type);
    return `/api/errors?${sp.toString()}`;
  }, [type, page]);

  const { data, reload } = useApi<ErrorsResponse>(url, { intervalMs: live ? 5000 : null });

  const resolve = async (id: string) => {
    const res = await fetch("/api/errors", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      toast.success("Error ditandai resolved");
      void reload();
    } else {
      toast.error("Gagal meng-update error");
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      {/* error type filter chips (PRD §34) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => { setType("all"); setPage(1); }}
          className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
            type === "all" ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"
          }`}
        >
          Semua tipe
        </button>
        {(data?.byType ?? []).map((t) => (
          <button
            key={t.type}
            onClick={() => { setType(t.type); setPage(1); }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] transition-colors ${
              type === t.type ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"
            }`}
          >
            {t.type} <span className="rounded bg-zinc-800 px-1 tabular-nums">{t.count}</span>
          </button>
        ))}
        <span className="ml-auto text-xs text-rose-400/90">{data?.openCount ?? 0} open</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="max-h-[62vh] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-zinc-900">
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Source</TableHead>
                <TableHead className="text-zinc-400">Error Type</TableHead>
                <TableHead className="text-zinc-400">Message</TableHead>
                <TableHead className="hidden text-right text-zinc-400 sm:table-cell">Retry</TableHead>
                <TableHead className="hidden text-zinc-400 md:table-cell">First / Last Seen</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-800/60">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><div className="h-4 w-full animate-pulse rounded bg-zinc-800" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.errors.length === 0 ? (
                <TableRow className="border-zinc-800/60 hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <EmptyState title="Tidak ada error 🎉" hint="Semua pipeline berjalan lancar" />
                  </TableCell>
                </TableRow>
              ) : (
                data.errors.map((e) => (
                  <TableRow key={e.id} className="border-zinc-800/60 hover:bg-zinc-800/30">
                    <TableCell className="text-sm text-zinc-300">{e.source?.name ?? "system"}</TableCell>
                    <TableCell>
                      <code className="rounded border border-rose-500/20 bg-rose-500/5 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">{e.errorType}</code>
                    </TableCell>
                    <TableCell className="max-w-[320px]">
                      <p className="truncate text-sm text-zinc-300" title={e.message}>{e.message}</p>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums text-zinc-400 sm:table-cell">{e.retryCount}</TableCell>
                    <TableCell className="hidden text-xs text-zinc-500 md:table-cell">
                      {timeAgo(e.firstSeen)} / {timeAgo(e.lastSeen)}
                    </TableCell>
                    <TableCell><StatusBadge status={e.status} /></TableCell>
                    <TableCell>
                      {e.status === "OPEN" && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-400 hover:bg-emerald-500/10" title="Resolve" onClick={() => void resolve(e.id)}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 tabular-nums">{data?.total.toLocaleString("id-ID") ?? 0} error · Halaman {data?.page ?? 1} dari {totalPages}</p>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-7 border-zinc-800 bg-zinc-900" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <Button variant="outline" size="sm" className="h-7 border-zinc-800 bg-zinc-900" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

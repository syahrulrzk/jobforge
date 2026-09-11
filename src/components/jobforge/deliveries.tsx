"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RefreshCcw } from "lucide-react";
import { EmptyState, StatusBadge, dateTime, timeAgo } from "./ui-bits";
import { useApi } from "@/hooks/use-api";

interface DeliveryRow {
  id: string;
  requestId: string;
  job: { id: string; title: string; status: string; company: { name: string } | null } | null;
  endpoint: string;
  attempt: number;
  maxAttempts: number;
  status: string;
  responseCode: number | null;
  responseBody: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

interface DeliveriesResponse {
  total: number;
  page: number;
  pageSize: number;
  stats: { SUCCESS: number; FAILED: number; PENDING: number; SENDING: number };
  deliveries: DeliveryRow[];
}

const TABS = ["all", "SUCCESS", "FAILED", "PENDING", "SENDING"] as const;

export function DeliveriesView({ live }: { live: boolean }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("all");
  const [page, setPage] = useState(1);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (tab !== "all") sp.set("status", tab);
    return `/api/deliveries?${sp.toString()}`;
  }, [tab, page]);

  const { data, reload } = useApi<DeliveriesResponse>(url, { intervalMs: live ? 4000 : null });

  const retry = async (id: string) => {
    const res = await fetch("/api/deliveries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      toast.success("Delivery dijadwalkan ulang");
      void reload();
    } else {
      toast.error("Gagal menjadwalkan retry");
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      {/* Status filter tabs (PRD §33) */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              tab === t ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"
            }`}
          >
            {t === "all" ? "Semua" : <StatusBadge status={t} />}
            {t !== "all" && <span className="tabular-nums">{data?.stats[t] ?? 0}</span>}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="max-h-[62vh] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-zinc-900">
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Request ID</TableHead>
                <TableHead className="text-zinc-400">Job</TableHead>
                <TableHead className="hidden text-zinc-400 md:table-cell">Endpoint</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="hidden text-center text-zinc-400 sm:table-cell">Attempt</TableHead>
                <TableHead className="hidden text-center text-zinc-400 md:table-cell">HTTP</TableHead>
                <TableHead className="hidden text-right text-zinc-400 lg:table-cell">Waktu</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-800/60">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><div className="h-4 w-full animate-pulse rounded bg-zinc-800" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.deliveries.length === 0 ? (
                <TableRow className="border-zinc-800/60 hover:bg-transparent">
                  <TableCell colSpan={8}><EmptyState title="Belum ada delivery" hint="Job berstatus READY akan otomatis dikirim ke Job Portal" /></TableCell>
                </TableRow>
              ) : (
                data.deliveries.map((d) => (
                  <TableRow key={d.id} className="border-zinc-800/60 hover:bg-zinc-800/30">
                    <TableCell><code className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">{d.requestId}</code></TableCell>
                    <TableCell className="max-w-[220px]">
                      <p className="truncate text-sm text-zinc-200">{d.job?.title ?? "—"}</p>
                      <p className="truncate text-[11px] text-zinc-500">{d.job?.company?.name ?? ""}</p>
                    </TableCell>
                    <TableCell className="hidden font-mono text-[11px] text-zinc-400 md:table-cell">{d.endpoint}</TableCell>
                    <TableCell><StatusBadge status={d.status} /></TableCell>
                    <TableCell className="hidden text-center sm:table-cell">
                      <span className={`text-sm tabular-nums ${d.attempt > 1 ? "text-amber-300" : "text-zinc-400"}`}>{d.attempt}/{d.maxAttempts}</span>
                    </TableCell>
                    <TableCell className="hidden text-center md:table-cell">
                      {d.responseCode ? (
                        <Badge variant="outline" className={`font-mono text-[10px] ${d.responseCode < 400 ? "border-emerald-500/30 text-emerald-300" : "border-rose-500/30 text-rose-300"}`}>
                          {d.responseCode}
                        </Badge>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right text-xs text-zinc-500 lg:table-cell">{d.status === "SUCCESS" ? dateTime(d.deliveredAt) : timeAgo(d.createdAt)}</TableCell>
                    <TableCell>
                      {d.status === "FAILED" && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-amber-400 hover:bg-amber-500/10" title="Retry" onClick={() => void retry(d.id)}>
                          <RefreshCcw className="h-3.5 w-3.5" />
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
        <p className="text-xs text-zinc-500 tabular-nums">{data?.total.toLocaleString("id-ID") ?? 0} delivery · Halaman {data?.page ?? 1} dari {totalPages}</p>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-7 border-zinc-800 bg-zinc-900" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <Button variant="outline" size="sm" className="h-7 border-zinc-800 bg-zinc-900" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

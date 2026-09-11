"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, ExternalLink, Mail, Search } from "lucide-react";
import { CompanyAvatar, EmptyState, StatusBadge, timeAgo } from "./ui-bits";
import { useApi } from "@/hooks/use-api";

interface ContactRow {
  id: string;
  hrEmail: string;
  emailSourceUrl: string | null;
  emailVerified: boolean;
  emailStatus: string;
  job: {
    id: string;
    title: string;
    status: string;
    company: { id: string; name: string; logoUrl: string; website: string | null } | null;
  };
}

interface ContactsResponse {
  total: number;
  page: number;
  pageSize: number;
  stats: { VALID: number; INVALID: number; UNKNOWN: number };
  contacts: ContactRow[];
}

export function ContactsView({ live }: { live: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (q) sp.set("q", q);
    if (status !== "all") sp.set("status", status);
    return `/api/contacts?${sp.toString()}`;
  }, [q, status, page]);

  const { data } = useApi<ContactsResponse>(url, { intervalMs: live ? 6000 : null });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2">
          {(["VALID", "INVALID", "UNKNOWN"] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(status === s ? "all" : s); setPage(1); }}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                status === s ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              <StatusBadge status={s} /> <span className="tabular-nums">{data?.stats[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[200px] sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Cari email…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="h-8 border-zinc-800 bg-zinc-900 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="max-h-[62vh] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-zinc-900">
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Email HR/Recruitment</TableHead>
                <TableHead className="text-zinc-400">Perusahaan</TableHead>
                <TableHead className="hidden text-zinc-400 md:table-cell">Job</TableHead>
                <TableHead className="hidden text-zinc-400 lg:table-cell">Email Source</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="hidden text-right text-zinc-400 sm:table-cell">Ditemukan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-800/60">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}><div className="h-4 w-full animate-pulse rounded bg-zinc-800" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.contacts.length === 0 ? (
                <TableRow className="border-zinc-800/60 hover:bg-transparent">
                  <TableCell colSpan={6}>
                    <EmptyState title="Tidak ada kontak HR" hint="Email ditemukan hanya dari sumber publik — sistem tidak menebak email (PRD §12.4)" />
                  </TableCell>
                </TableRow>
              ) : (
                data.contacts.map((c) => (
                  <TableRow key={c.id} className="border-zinc-800/60 hover:bg-zinc-800/30">
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm text-zinc-200">
                        <Mail className="h-3.5 w-3.5 text-teal-400" /> {c.hrEmail}
                      </span>
                      {c.emailVerified && <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">verified</span>}
                    </TableCell>
                    <TableCell>
                      {c.job.company ? (
                        <div className="flex items-center gap-2">
                          <CompanyAvatar name={c.job.company.name} logoUrl={c.job.company.logoUrl} size={22} />
                          <span className="hidden max-w-[140px] truncate text-sm text-zinc-300 md:inline">{c.job.company.name}</span>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="hidden max-w-[180px] truncate text-sm text-zinc-400 md:table-cell">{c.job.title}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {c.emailSourceUrl ? (
                        <a href={c.emailSourceUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[220px] items-center gap-1 truncate text-xs text-zinc-400 hover:text-teal-300">
                          {c.emailSourceUrl.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell><StatusBadge status={c.emailStatus} /></TableCell>
                    <TableCell className="hidden text-right text-xs text-zinc-500 sm:table-cell">—</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 tabular-nums">{data?.total.toLocaleString("id-ID") ?? 0} kontak · Halaman {data?.page ?? 1} dari {totalPages}</p>
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

"use client";

// Data — Email (Gudang Data)
//
// Seluruh email publik yang terkumpul dari Domain Search & harvest —
// satu tabel dengan search, filter kind, dan pagination. Stats di hero
// (total email · total domain · top domain) plus quick-filter per domain.
//
// Sumber: GET /api/warehouse/emails

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, ExternalLink, Globe, Mail, Search } from "lucide-react";
import { EmptyState } from "./ui-bits";
import { useApi } from "@/hooks/use-api";

interface WarehouseEmail {
  email: string;
  kind: string;
  category: string | null;
  via: string;
  domain: string;
  sourceUrl: string | null;
  sourcesCount: number;
  companyName: string | null;
  companyWebsite: string | null;
  isHr: boolean;
  createdAt: string;
}

interface WarehouseResponse {
  total: number;
  page: number;
  pageSize: number;
  warehouse: {
    totalEmails: number;
    totalDomains: number;
    totalHr: number;
  };
  emails: WarehouseEmail[];
  error?: string;
}

const KIND_BADGE: Record<string, string> = {
  hr: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  role: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  personal: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  unknown: "bg-zinc-500/10 text-muted-foreground",
};

const KIND_FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Semua" },
  { key: "hr", label: "Email HR" },
  { key: "role", label: "Role" },
  { key: "personal", label: "Personal" },
  { key: "unknown", label: "Unknown" },
];

export function WarehouseView() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [domain, setDomain] = useState("");
  const [page, setPage] = useState(1);
  // pageSize tetap 15 per halaman (konsisten menu tabel lain) — tidak dinamis
  const pageSize = 15;

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) sp.set("q", q);
    if (kind) sp.set("kind", kind);
    if (domain) sp.set("domain", domain);
    return `/api/warehouse/emails?${sp.toString()}`;
  }, [q, kind, domain, page, pageSize]);

  const { data, loading } = useApi<WarehouseResponse>(url, { intervalMs: 15000 });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Hero stats */}
      <section className="rounded-xl border border-border bg-gradient-to-br from-card via-card/60 to-card/20 p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card/60 p-3">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Total Email</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
              {data ? data.warehouse.totalEmails.toLocaleString("id-ID") : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card/60 p-3">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Total Domain</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
              {data ? data.warehouse.totalDomains.toLocaleString("id-ID") : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card/60 p-3">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Hasil Filter</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{data ? data.total.toLocaleString("id-ID") : "—"}</p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Email HR</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300">
              {data ? data.warehouse.totalHr.toLocaleString("id-ID") : "—"}
            </p>
          </div>
        </div>

      </section>

      {/* Toolbar: search + kind filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari email / domain / perusahaan…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="h-8 border-border bg-card pl-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          {KIND_FILTERS.map((k) => (
            <button
              key={k.key}
              onClick={() => {
                setKind(k.key);
                setPage(1);
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                kind === k.key
                  ? "border-violet-500/50 bg-violet-500/15 font-medium text-violet-700 dark:text-violet-300"
                  : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {data ? `${data.total.toLocaleString("id-ID")} email` : loading ? "…" : ""}
        </span>
      </div>

      {/* Tabel */}
      {!loading && (!data || data.emails.length === 0) ? (
        <EmptyState
          title={q || kind || domain ? "Tidak ada hasil untuk filter ini" : "Gudang masih kosong"}
          hint={
            q || kind || domain
              ? "Coba reset filter atau kata kunci lain."
              : "Jalankan Domain Search — semua email yang ditemukan otomatis masuk ke sini."
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card/60">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-card text-[10px] tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Kategori</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">Perusahaan</th>
                <th className="hidden px-3 py-2 font-semibold lg:table-cell">Domain</th>
                <th className="hidden px-3 py-2 font-semibold xl:table-cell">Sumber</th>
                <th className="hidden px-3 py-2 font-semibold lg:table-cell">Dikumpulkan</th>
                <th className="px-3 py-2 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {(data?.emails ?? []).map((h) => (
                <tr key={h.email} className="border-t border-border/60 hover:bg-accent/30">
                  <td className="max-w-[240px] px-3 py-2">
                    <p className="truncate font-mono text-[11px] font-medium text-foreground" title={h.email}>
                      {h.email}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[h.kind] ?? KIND_BADGE.unknown}`}>
                      {h.category ?? h.kind}
                    </span>
                    {h.isHr && h.category !== "Email HR" && (
                      <span className="ml-1 rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300" title="Email HR dari pipeline">
                        HR
                      </span>
                    )}
                  </td>
                  <td className="hidden max-w-[160px] px-3 py-2 md:table-cell">
                    {h.companyName ? (
                      <span className="flex min-w-0 items-center gap-1 truncate" title={h.companyName}>
                        <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{h.companyName}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 font-mono text-[10px] text-muted-foreground lg:table-cell">@{h.domain}</td>
                  <td className="hidden max-w-[200px] px-3 py-2 xl:table-cell">
                    {h.sourceUrl ? (
                      <>
                        <a
                          href={h.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-w-0 items-center gap-1 truncate text-muted-foreground hover:text-foreground/90"
                          title={h.sourceUrl}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{h.sourceUrl.replace(/^https?:\/\//, "")}</span>
                        </a>
                        {h.sourcesCount > 1 && <span className="text-[10px] text-muted-foreground/60">+{h.sourcesCount - 1} lain</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-[10px] whitespace-nowrap text-muted-foreground lg:table-cell">
                    {new Date(h.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })} · via {h.via}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <a
                      href={`mailto:${h.email}`}
                      className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-2 py-1 text-[10px] font-medium text-violet-700 transition-colors hover:bg-violet-500/20 dark:text-violet-300"
                    >
                      <Mail className="h-3 w-3" /> Email
                    </a>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-7 w-7 p-0">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {page} / {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-7 w-7 p-0">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

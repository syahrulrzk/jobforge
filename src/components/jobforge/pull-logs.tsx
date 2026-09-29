"use client";

// ─────────────────────────────────────────────────────────────
// Riwayat Konsumsi API (§19b) — satu baris per aksi pull API
// per job: LEASE (diambil sementara), ACK (final), RELEASE
// (dikembalikan ke pool). Snapshot job → riwayat tetap terbaca
// walau job sudah terhapus.
// ─────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, Search } from "lucide-react";
import { EmptyState, dateTime, timeAgo } from "./ui-bits";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

interface PullLogRow {
  id: string;
  tokenId: string;
  tokenName: string;
  tokenPrefix: string;
  tokenRevoked: boolean;
  jobId: string;
  jobCode: string;
  jobTitle: string;
  action: string;
  leaseMin: number | null;
  meta: { platform?: string | null; url?: string | null };
  createdAt: string;
}

interface DailyPoint {
  date: string;
  label: string;
  LEASE: number;
  ACK: number;
  RELEASE: number;
}

interface PullLogsResponse {
  total: number;
  page: number;
  pageSize: number;
  activeTokens: number;
  stats: { LEASE: number; ACK: number; RELEASE: number };
  daily: DailyPoint[];
  logs: PullLogRow[];
}

const TABS = ["all", "LEASE", "ACK", "RELEASE"] as const;

// warna aksi — emerald final, amber lease, zinc release
const ACTION_STYLES: Record<string, string> = {
  LEASE: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  ACK: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  RELEASE: "bg-zinc-500/10 text-muted-foreground border-zinc-500/30",
};

const ACTION_LABELS: Record<string, string> = {
  LEASE: "Diambil (lease)",
  ACK: "Final (ack)",
  RELEASE: "Dikembalikan",
};

// warna seri chart = palet badge aksi (amber/emerald/zinc) biar konsisten
const ACTION_CHART_COLORS: Record<string, string> = {
  LEASE: "#f59e0b",
  ACK: "#34d399",
  RELEASE: "#a1a1aa",
};

// Tooltip chart ikut tema (pola ChartTooltip di overview.tsx)
function PullChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; fill?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-popover-foreground/90">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? p.fill }} />
          {p.name}: <span className="font-semibold tabular-nums">{(p.value ?? 0).toLocaleString("id-ID")}</span>
        </p>
      ))}
    </div>
  );
}

export function PullLogsView({ live }: { live?: boolean }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  // rentang grafik aktivitas — 7/14/30 hari
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const pageSize = 15;

  const url = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize), days: String(days) });
    if (tab !== "all") sp.set("action", tab);
    if (q.trim()) sp.set("q", q.trim());
    return `/api/pull-logs?${sp.toString()}`;
  }, [tab, page, q, days]);

  const { data } = useApi<PullLogsResponse>(url, { intervalMs: live ? 5000 : null });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* filter chips + pencarian */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setPage(1);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors",
              tab === t
                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-border bg-card/60 text-muted-foreground hover:border-border"
            )}
          >
            {t === "all" ? "Semua" : ACTION_LABELS[t]}
            {t !== "all" && <span className="tabular-nums">{data?.stats[t] ?? 0}</span>}
          </button>
        ))}
        <div className="relative ml-auto w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari kode, judul, token…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="h-8 border-border bg-card pl-8 text-sm"
          />
        </div>
      </div>

      {/* grafik aktivitas — stacked per aksi, rentang 7/14/30 hari */}
      <div className="shrink-0 rounded-xl border border-border bg-card/60 p-3">
        <div className="mb-1 flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold text-foreground">Aktivitas Pull</h3>
          <div className="flex gap-0.5 rounded-lg border border-border bg-background/60 p-0.5">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
                  days === d
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {d} hari
              </button>
            ))}
          </div>
        </div>
        <div className="h-36">
        {!data ? (
          <div className="h-full animate-pulse rounded bg-accent/60" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.daily} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: "#71717a", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={18}
              />
              <YAxis allowDecimals={false} tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip content={<PullChartTooltip />} cursor={{ fill: "var(--accent)" }} />
              {(Object.keys(ACTION_CHART_COLORS) as (keyof typeof ACTION_CHART_COLORS)[]).map((action, idx, arr) => (
                <Bar
                  key={action}
                  dataKey={action}
                  name={ACTION_LABELS[action]}
                  stackId="a"
                  fill={ACTION_CHART_COLORS[action]}
                  radius={idx === arr.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                  maxBarSize={22}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
        </div>
      </div>

      {/* tabel riwayat */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card/60">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Waktu</TableHead>
                <TableHead className="text-muted-foreground">Aksi</TableHead>
                <TableHead className="text-muted-foreground">Kode Job</TableHead>
                <TableHead className="text-muted-foreground">Posisi</TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">Token</TableHead>
                <TableHead className="hidden text-muted-foreground lg:table-cell">Source</TableHead>
                <TableHead className="hidden text-right text-muted-foreground xl:table-cell">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-border/60">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <div className="h-4 w-full animate-pulse rounded bg-accent" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.logs.length === 0 ? (
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <EmptyState
                      title="Belum ada aktivitas pull"
                      hint="Setiap GET/ack/release dari consumer via /api/v1/jobs/pull tercatat di sini"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                data.logs.map((l) => (
                  <TableRow key={l.id} className="border-border/60 hover:bg-accent/30">
                    <TableCell className="whitespace-nowrap">
                      <p className="text-xs text-foreground/90">{timeAgo(l.createdAt)}</p>
                      <p className="text-[10px] text-muted-foreground">{dateTime(l.createdAt)}</p>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium",
                          ACTION_STYLES[l.action] ?? ACTION_STYLES.RELEASE
                        )}
                      >
                        {ACTION_LABELS[l.action] ?? l.action}
                        {l.action === "LEASE" && l.leaseMin ? ` · ${l.leaseMin}m` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <code className="rounded bg-card/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90">{l.jobCode}</code>
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <p className="truncate text-sm text-foreground/90">{l.jobTitle}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-foreground/90">{l.tokenName}</span>
                        {l.tokenRevoked && (
                          <span className="rounded bg-rose-500/10 px-1 py-0.5 text-[9px] text-rose-600 dark:text-rose-400">revoked</span>
                        )}
                      </div>
                      <code className="font-mono text-[10px] text-muted-foreground">{l.tokenPrefix}…</code>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {l.meta.platform ? (
                        <span className="text-xs text-muted-foreground">{l.meta.platform}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/80">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right xl:table-cell">
                      {l.meta.url ? (
                        <a
                          href={l.meta.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-amber-700 hover:underline dark:text-amber-300"
                        >
                          sumber <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground/80">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground tabular-nums">
          {data?.total.toLocaleString("id-ID") ?? 0} aksi · Halaman {data?.page ?? 1} dari {totalPages}
        </p>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-7 border-border bg-card" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-border bg-card"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, FileText, Mail, Rocket, Send, XCircle } from "lucide-react";
import { StatCard, StatusBadge, LogActionColor, timeAgo, EmptyState, CompanyAvatar } from "./ui-bits";
import { useApi } from "@/hooks/use-api";
import { useJobForgeStore } from "@/store/jobforge";
import { cn } from "@/lib/utils";

interface DashboardData {
  stats: {
    totalJobs: number;
    totalCompanies: number;
    hrEmailsFound: number;
    validEmails: number;
    activeSources: number;
    totalSources: number;
    successfulScrapes: number;
    failedScrapes: number;
    successRate: number;
    jobsSent: number;
    jobsPublished: number;
    needsEnrichment: number;
    rejected: number;
    pendingDeliveries: number;
    failedDeliveries: number;
    openErrors: number;
  };
  activity: { date: string; created: number; published: number }[];
  statusDist: { status: string; count: number }[];
  sourceHealth: {
    id: string;
    slug: string;
    name: string;
    status: string;
    scraperType: string;
    jobCount: number;
    lastRunAt: string | null;
    successRate: number | null;
  }[];
  topCompanies: { id: string; name: string; logoUrl: string; website: string | null; industry: string | null; jobCount: number }[];
  recentActivity: { id: string; ts: string; source: string | null; action: string; status: string; message: string; durationMs: number | null }[];
}


const Y_AXIS_W = 88;

// warna bar per-status — ngikutin palet STATUS_STYLES di ui-bits biar konsisten sama badge
const STATUS_BAR_COLORS: Record<string, string> = {
  SCRAPED: "#a1a1aa",
  PROCESSING: "#f59e0b",
  ENRICHING: "#e879f9",
  VALIDATING: "#a78bfa",
  READY: "#34d399",
  SENT: "#2dd4bf",
  PUBLISHED: "#10b981",
  NEEDS_ENRICHMENT: "#eab308",
  FAILED: "#fb7185",
  REJECTED: "#fb7185",
};

// label status rata KIRI biar sejajar sama judul kartu —
// default recharts right-align nempel ke bar, jadi keliatan "ke tengah"
function StatusYTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  return (
    <text x={x - Y_AXIS_W + 8} y={y} fill="#a1a1aa" fontSize={9.5} textAnchor="start" dominantBaseline="middle">
      {payload?.value}
    </text>
  );
}

// tooltip ngikutin tema (dulu hardcoded gelap #18181b — item di mode light)
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; fill?: string; payload?: { label?: string; status?: string } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const p0 = payload[0];
  const title = p0?.payload?.label ?? p0?.payload?.status ?? label;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{title}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-popover-foreground/90">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? p.fill }} />
          {p.name}: <span className="font-semibold tabular-nums">{p.value?.toLocaleString("id-ID")}</span>
        </p>
      ))}
    </div>
  );
}

export function OverviewView({ live }: { live: boolean }) {
  const { data } = useApi<DashboardData>("/api/dashboard", { intervalMs: live ? 4000 : null });
  const setView = useJobForgeStore((s) => s.setView);

  if (!data) return <OverviewSkeleton />;

  const { stats, activity, sourceHealth, topCompanies, recentActivity, statusDist } = data;
  const chartData = activity.map((a) => ({
    ...a,
    label: new Date(a.date + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
  }));

  return (
    <div className="space-y-5">
      {/* Stat cards — PRD §28 (primary + delivery KPI) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Jobs" value={stats.totalJobs.toLocaleString("id-ID")} sub={`${stats.jobsPublished.toLocaleString("id-ID")} published`} icon={<FileText className="h-4 w-4" />} accent="amber" />
        <StatCard label="Companies" value={stats.totalCompanies.toLocaleString("id-ID")} sub="deduplicated profiles" icon={<Building2 className="h-4 w-4" />} accent="teal" />
        <StatCard label="HR Emails" value={stats.hrEmailsFound.toLocaleString("id-ID")} sub={`${stats.validEmails.toLocaleString("id-ID")} verified valid`} icon={<Mail className="h-4 w-4" />} accent="emerald" />
        <StatCard label="Success Rate" value={`${stats.successRate}%`} sub={`${stats.successfulScrapes} OK / ${stats.failedScrapes} failed`} icon={<CheckCircle2 className="h-4 w-4" />} accent={stats.successRate >= 90 ? "emerald" : stats.successRate >= 70 ? "amber" : "rose"} />
        <StatCard label="Jobs Sent" value={stats.jobsSent.toLocaleString("id-ID")} sub={`${stats.pendingDeliveries} delivery in flight`} icon={<Send className="h-4 w-4" />} accent="teal" />
        <StatCard label="Published" value={stats.jobsPublished.toLocaleString("id-ID")} sub="live di Job Portal" icon={<Rocket className="h-4 w-4" />} accent="emerald" />
        <StatCard label="Needs Enrichment" value={stats.needsEnrichment.toLocaleString("id-ID")} sub={`${stats.rejected} rejected`} icon={<AlertTriangle className="h-4 w-4" />} accent="amber" />
        <StatCard label="Open Issues" value={stats.openErrors.toLocaleString("id-ID")} sub={`${stats.failedDeliveries} failed deliveries`} icon={<XCircle className="h-4 w-4" />} accent="rose" />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-card/60 p-4 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Scraping Activity</h3>
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> Jobs scraped</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Published</span>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gPublished" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#3f3f46" }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
                <Area type="monotone" dataKey="created" stroke="#f59e0b" strokeWidth={2} fill="url(#gCreated)" name="Scraped" />
                <Area type="monotone" dataKey="published" stroke="#34d399" strokeWidth={2} fill="url(#gPublished)" name="Published" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/60 p-4 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Status Distribution</h3>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusDist} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="status" width={Y_AXIS_W} tick={<StatusYTick />} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--accent)" }} />
                <Bar dataKey="count" name="Jobs" radius={[0, 4, 4, 0]} barSize={12}>
                  {statusDist.map((entry) => (
                    <Cell key={entry.status} fill={STATUS_BAR_COLORS[entry.status] ?? "#a1a1aa"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top companies leaderboard — logos (§11, §28) */}
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Top Companies</h3>
          <button
            onClick={() => setView("companies")}
            className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 transition-colors hover:text-amber-700 dark:text-amber-300"
            title="Buka halaman Companies"
          >
            {stats.totalCompanies.toLocaleString("id-ID")} perusahaan
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
          {topCompanies.map((c, i) => {
            const max = topCompanies[0]?.jobCount || 1;
            return (
              <div
                key={c.id}
                onClick={() => setView("companies", { focusCompany: c.id })}
                className="cursor-pointer rounded-lg border border-transparent p-2 transition-colors hover:border-border/60 hover:bg-accent"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-4 shrink-0 text-center font-mono text-[10px] text-muted-foreground/80">{i + 1}</span>
                  <CompanyAvatar name={c.name} logoUrl={c.logoUrl} website={c.website} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{c.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{c.industry ?? "Industri belum diketahui"}</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-foreground/90">{c.jobCount}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-accent">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all"
                    style={{ width: `${Math.max(6, Math.round((c.jobCount / max) * 100))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sources health + activity console */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Sources Health</h3>
            <span className="text-[11px] text-muted-foreground">{stats.activeSources}/{stats.totalSources} active</span>
          </div>
          <div className="space-y-1">
            {sourceHealth.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", s.status === "ACTIVE" ? "bg-emerald-400" : s.status === "ERROR" ? "bg-rose-400" : "bg-zinc-600")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">{s.scraperType.split(",").map((x) => x.trim().toLowerCase()).join(" · ")} · last run {timeAgo(s.lastRunAt)}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-foreground/90">{s.jobCount.toLocaleString("id-ID")}</span>
                <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">{s.successRate === null ? "—" : `${s.successRate}%`}</span>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
        </div>

        <div className="relative rounded-xl border border-border bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Activity Console</h3>
            <button
              onClick={() => setView("activity")}
              className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 transition-colors hover:text-amber-700 dark:text-amber-300"
              title="Buka full log di Activity Console"
            >
              {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
              full log
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {recentActivity.length === 0 ? (
            <EmptyState title="Belum ada aktivitas" />
          ) : (
            <div className="absolute inset-x-4 bottom-4 top-12 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed [scrollbar-width:thin]" onClick={() => setView("activity")}>
              {recentActivity.map((log) => (
                <div key={log.id} className="flex gap-2 rounded px-1.5 py-1 hover:bg-accent">
                  <span className="shrink-0 text-muted-foreground/80">{new Date(log.ts).toLocaleTimeString("id-ID", { hour12: false })}</span>
                  <span className="w-16 shrink-0"><LogActionColor action={log.action} /></span>
                  {log.source && <span className="shrink-0 text-muted-foreground">[{log.source}]</span>}
                  <span className={cn("min-w-0 flex-1", log.status === "failed" ? "text-rose-700 dark:text-rose-300" : log.status === "warning" ? "text-yellow-700 dark:text-yellow-300" : log.status === "info" ? "text-muted-foreground" : "text-foreground/90")}>
                    {log.message}
                    {log.durationMs !== null && <span className="ml-1 text-muted-foreground/80">({(log.durationMs / 1000).toFixed(2)}s)</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      {/* 2 baris × 4 KPI — ngikutin grid stat cards final */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card/60" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="h-72 animate-pulse rounded-xl border border-border bg-card/60 lg:col-span-3" />
        <div className="h-72 animate-pulse rounded-xl border border-border bg-card/60 lg:col-span-2" />
      </div>
    </div>
  );
}

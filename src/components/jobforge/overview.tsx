"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, AlertTriangle, ArrowRight, Building2, CheckCircle2, FileText, Mail, Rocket, Send, XCircle } from "lucide-react";
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
  inFlight: { scraped: number; processing: number; enriching: number; validating: number; ready: number };
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

const PIPELINE_STEPS = [
  { key: "scraped", label: "Scraped" },
  { key: "processing", label: "Processing" },
  { key: "enriching", label: "Enriching" },
  { key: "validating", label: "Validating" },
  { key: "ready", label: "Ready" },
] as const;

export function OverviewView({ live }: { live: boolean }) {
  const { data } = useApi<DashboardData>("/api/dashboard", { intervalMs: live ? 4000 : null });
  const setView = useJobForgeStore((s) => s.setView);

  if (!data) return <OverviewSkeleton />;

  const { stats, inFlight, activity, sourceHealth, topCompanies, recentActivity, statusDist } = data;
  const chartData = activity.map((a) => ({
    ...a,
    label: new Date(a.date + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
  }));

  return (
    <div className="space-y-5">
      {/* Stat cards — PRD §28 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Jobs" value={stats.totalJobs.toLocaleString("id-ID")} sub={`${stats.jobsPublished.toLocaleString("id-ID")} published`} icon={<FileText className="h-4 w-4" />} accent="amber" />
        <StatCard label="Companies" value={stats.totalCompanies.toLocaleString("id-ID")} sub="deduplicated profiles" icon={<Building2 className="h-4 w-4" />} accent="teal" />
        <StatCard label="HR Emails" value={stats.hrEmailsFound.toLocaleString("id-ID")} sub={`${stats.validEmails.toLocaleString("id-ID")} verified valid`} icon={<Mail className="h-4 w-4" />} accent="emerald" />
        <StatCard label="Success Rate" value={`${stats.successRate}%`} sub={`${stats.successfulScrapes} OK / ${stats.failedScrapes} failed`} icon={<CheckCircle2 className="h-4 w-4" />} accent={stats.successRate >= 90 ? "emerald" : stats.successRate >= 70 ? "amber" : "rose"} />
      </div>

      {/* Live pipeline strip */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-zinc-200">Live Pipeline</h3>
          <span className="ml-auto text-[11px] text-zinc-500">job dalam proses per stage</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.key} className="flex items-center gap-2">
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-800/60 px-3 py-2 text-center min-w-[92px]">
                <p className="text-lg font-bold tabular-nums text-zinc-100">{inFlight[step.key]}</p>
                <p className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase">{step.label}</p>
              </div>
              {i < PIPELINE_STEPS.length - 1 && <span className="text-zinc-600">→</span>}
            </div>
          ))}
          <span className="text-zinc-600">→</span>
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
            <Rocket className="h-3.5 w-3.5 text-emerald-400" />
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums text-emerald-300">{stats.jobsSent}</p>
              <p className="text-[10px] font-medium tracking-wide text-emerald-500/80 uppercase">Sent</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">Scraping Activity</h3>
            <div className="flex items-center gap-4 text-[11px] text-zinc-500">
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
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#3f3f46" }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#a1a1aa" }}
                  cursor={{ stroke: "#52525b" }}
                />
                <Area type="monotone" dataKey="created" stroke="#f59e0b" strokeWidth={2} fill="url(#gCreated)" name="Scraped" />
                <Area type="monotone" dataKey="published" stroke="#34d399" strokeWidth={2} fill="url(#gPublished)" name="Published" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">Status Distribution</h3>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusDist} layout="vertical" margin={{ top: 0, right: 12, left: 30, bottom: 0 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="status" width={110} tick={{ fill: "#a1a1aa", fontSize: 9.5 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: "#27272a" }}
                />
                <Bar dataKey="count" name="Jobs" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top companies leaderboard — logos (§11, §28) */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200">Top Companies</h3>
          <button
            onClick={() => setView("companies")}
            className="flex items-center gap-1 text-[11px] font-medium text-amber-400 transition-colors hover:text-amber-300"
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
                onClick={() => setView("companies")}
                className="cursor-pointer rounded-lg border border-transparent p-2 transition-colors hover:border-zinc-700/70 hover:bg-zinc-800/40"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-4 shrink-0 text-center font-mono text-[10px] text-zinc-600">{i + 1}</span>
                  <CompanyAvatar name={c.name} logoUrl={c.logoUrl} website={c.website} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-zinc-200">{c.name}</p>
                    <p className="truncate text-[11px] text-zinc-500">{c.industry ?? "Industri belum diketahui"}</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-zinc-300">{c.jobCount}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
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
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">Sources Health</h3>
            <span className="text-[11px] text-zinc-500">{stats.activeSources}/{stats.totalSources} active</span>
          </div>
          <div className="space-y-1">
            {sourceHealth.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-zinc-800/40">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", s.status === "ACTIVE" ? "bg-emerald-400" : s.status === "ERROR" ? "bg-rose-400" : "bg-zinc-600")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-200">{s.name}</p>
                  <p className="text-[11px] text-zinc-500">{s.scraperType.split(",").map((x) => x.trim().toLowerCase()).join(" · ")} · last run {timeAgo(s.lastRunAt)}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-zinc-300">{s.jobCount.toLocaleString("id-ID")}</span>
                <span className="w-10 text-right text-[11px] tabular-nums text-zinc-500">{s.successRate === null ? "—" : `${s.successRate}%`}</span>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
        </div>

        <div className="relative rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">Activity Console</h3>
            <button
              onClick={() => setView("activity")}
              className="flex items-center gap-1 text-[11px] font-medium text-amber-400 transition-colors hover:text-amber-300"
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
                <div key={log.id} className="flex gap-2 rounded px-1.5 py-1 hover:bg-zinc-800/40">
                  <span className="shrink-0 text-zinc-600">{new Date(log.ts).toLocaleTimeString("id-ID", { hour12: false })}</span>
                  <span className="w-16 shrink-0"><LogActionColor action={log.action} /></span>
                  {log.source && <span className="shrink-0 text-zinc-500">[{log.source}]</span>}
                  <span className={cn("min-w-0 flex-1", log.status === "failed" ? "text-rose-300" : log.status === "warning" ? "text-yellow-300" : log.status === "info" ? "text-zinc-400" : "text-zinc-300")}>
                    {log.message}
                    {log.durationMs !== null && <span className="ml-1 text-zinc-600">({(log.durationMs / 1000).toFixed(2)}s)</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Jobs Sent" value={stats.jobsSent.toLocaleString("id-ID")} sub={`${stats.pendingDeliveries} delivery in flight`} icon={<Send className="h-4 w-4" />} accent="teal" />
        <StatCard label="Published" value={stats.jobsPublished.toLocaleString("id-ID")} sub="live di Job Portal" icon={<Rocket className="h-4 w-4" />} accent="emerald" />
        <StatCard label="Needs Enrichment" value={stats.needsEnrichment.toLocaleString("id-ID")} sub={`${stats.rejected} rejected`} icon={<AlertTriangle className="h-4 w-4" />} accent="amber" />
        <StatCard label="Open Issues" value={stats.openErrors.toLocaleString("id-ID")} sub={`${stats.failedDeliveries} failed deliveries`} icon={<XCircle className="h-4 w-4" />} accent="rose" />
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60" />
        ))}
      </div>
      <div className="h-28 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60" />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="h-72 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60 lg:col-span-3" />
        <div className="h-72 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60 lg:col-span-2" />
      </div>
    </div>
  );
}

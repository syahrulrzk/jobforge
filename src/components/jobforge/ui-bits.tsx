"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { extractDomain } from "@/lib/jobforge/logo";

// ─────────────────────────────────────────────────────────────
// JOBFORCE — shared UI bits: status badges, stat cards, helpers
// ─────────────────────────────────────────────────────────────

export const STATUS_STYLES: Record<string, string> = {
  // job lifecycle (§16)
  SCRAPED: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  PROCESSING: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  ENRICHING: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
  VALIDATING: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  READY: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  SENT: "bg-teal-500/10 text-teal-300 border-teal-500/30",
  PUBLISHED: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40 font-semibold",
  FAILED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  REJECTED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  NEEDS_ENRICHMENT: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
  // source status (§8)
  ACTIVE: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  INACTIVE: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  ERROR: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  // delivery status (§20)
  PENDING: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  SENDING: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  SUCCESS: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  // email status (§13)
  VALID: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  INVALID: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  UNKNOWN: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  // run status (§24)
  RUNNING: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  // error status (§25)
  OPEN: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  RESOLVED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const style = STATUS_STYLES[status] ?? "bg-zinc-500/10 text-zinc-300 border-zinc-500/30";
  const dot =
    status === "ACTIVE" || status === "SUCCESS" || status === "PUBLISHED" || status === "READY"
      ? "bg-emerald-400"
      : status === "ERROR" || status === "FAILED" || status === "REJECTED" || status === "INVALID" || status === "OPEN"
        ? "bg-rose-400"
        : status === "RUNNING" || status === "SENDING" || status === "PROCESSING"
          ? "bg-amber-400 animate-pulse"
          : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide whitespace-nowrap",
        style,
        className
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />}
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function CompanyAvatar({
  name,
  logoUrl,
  website,
  size = 32,
}: {
  name: string;
  logoUrl?: string | null;
  website?: string | null;
  size?: number;
}) {
  const initials = name
    .replace(/^(PT|CV)\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  // fallback chain: stored logoUrl → logo proxy (Clearbit → Google → DuckDuckGo) → initials
  const candidates: string[] = [];
  if (logoUrl && !logoUrl.endsWith("/assets/logo.png")) candidates.push(logoUrl);
  const domain = extractDomain(website);
  if (domain) candidates.push(`/api/logo/${domain}`);

  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [logoUrl, website]);

  const cls = "rounded-md border border-zinc-700/60 bg-zinc-800 object-contain";
  if (idx < candidates.length) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={candidates[idx]}
        alt={`Logo ${name}`}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={cls}
        loading="lazy"
        onError={() => setIdx((i) => i + 1)}
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className={cn(cls, "flex shrink-0 items-center justify-center bg-gradient-to-br from-amber-500/80 to-amber-700/80 text-[10px] font-bold text-zinc-950")}
    >
      {initials || "?"}
    </div>
  );
}

export function formatIDR(min?: number | null, max?: number | null, currency?: string | null): string {
  if (!min && !max) return "—";
  const fmt = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1).replace(".", ",")}jt`;
    if (v >= 1_000) return `${Math.round(v / 1_000)}rb`;
    return String(v);
  };
  const cur = currency ?? "IDR";
  if (min && max && min !== max) return `${cur} ${fmt(min)} – ${fmt(max)}`;
  return `${cur} ${fmt(min ?? max ?? 0)}`;
}

export function timeAgo(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  const diff = Date.now() - date.getTime();
  if (diff < 0) return "baru saja";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}h lalu`;
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = "amber",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  accent?: "amber" | "emerald" | "rose" | "zinc" | "teal" | "violet";
}) {
  const accents: Record<string, string> = {
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    rose: "text-rose-400 bg-rose-500/10 border-rose-500/20",
    teal: "text-teal-400 bg-teal-500/10 border-teal-500/20",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    zinc: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
  };
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-100 tabular-nums">{value}</p>
          {sub && <p className="mt-0.5 truncate text-xs text-zinc-500">{sub}</p>}
        </div>
        {icon && (
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", accents[accent])}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 py-14 text-center">
      <p className="text-sm font-medium text-zinc-400">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

export function LogActionColor({ action }: { action: string }) {
  const map: Record<string, string> = {
    scrape: "text-amber-400",
    parse: "text-zinc-300",
    normalize: "text-zinc-300",
    enrich: "text-fuchsia-400",
    validate: "text-violet-400",
    dedup: "text-yellow-400",
    deliver: "text-teal-400",
    import: "text-emerald-400",
    error: "text-rose-400",
  };
  return <span className={cn("font-semibold lowercase", map[action] ?? "text-zinc-300")}>{action}</span>;
}

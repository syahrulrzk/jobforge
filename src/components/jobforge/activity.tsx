"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Download, Search, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogActionColor } from "./ui-bits";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

interface LogRow {
  id: string;
  ts: string;
  source: string | null;
  jobId: string | null;
  action: string;
  status: string;
  message: string;
  durationMs: number | null;
}

interface ActivityResponse {
  logs: LogRow[];
  total: number;
  limit: number;
  offset: number;
  byAction: { action: string; count: number }[];
  sources: (string | null)[];
}

const PAGE = 200;

const STATUS_DOT: Record<string, string> = {
  success: "bg-emerald-400",
  failed: "bg-rose-400",
  warning: "bg-yellow-400",
  info: "bg-zinc-500",
};

const STATUS_TEXT: Record<string, string> = {
  failed: "text-rose-300",
  warning: "text-yellow-300",
  info: "text-zinc-400",
  success: "text-zinc-300",
};

function stamp(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("id-ID", { hour12: false });
  if (sameDay) return time;
  return `${d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" })} ${time}`;
}

export function ActivityView({ live }: { live: boolean }) {
  const [action, setAction] = useState("all");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [follow, setFollow] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ limit: String(limit) });
    if (action !== "all") sp.set("action", action);
    if (status !== "all") sp.set("status", status);
    if (source !== "all") sp.set("source", source);
    if (q.trim()) sp.set("q", q.trim());
    return `/api/activity?${sp.toString()}`;
  }, [limit, action, status, source, q]);

  const { data, loading } = useApi<ActivityResponse>(url, { intervalMs: live ? 3000 : null });

  // terminal order: oldest on top, newest at bottom
  const rows = useMemo(() => (data ? [...data.logs].reverse() : []), [data]);

  // follow mode: keep pinned to bottom when new logs stream in
  useEffect(() => {
    if (followRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows.length, data]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearBottom !== followRef.current) {
      followRef.current = nearBottom;
      setFollow(nearBottom);
    }
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = true;
    setFollow(true);
    el.scrollTop = el.scrollHeight;
  };

  const resetAnd = (fn: () => void) => {
    fn();
    setLimit(PAGE);
    followRef.current = true;
    setFollow(true);
  };

  const download = () => {
    if (!data) return;
    const text = rows
      .map(
        (l) =>
          `[${new Date(l.ts).toISOString()}] ${l.status.toUpperCase().padEnd(7)} ${l.action.padEnd(9)} ${
            l.source ?? "system"
          } — ${l.message}${l.durationMs !== null ? ` (${l.durationMs}ms)` : ""}`
      )
      .join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jobforge-console-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const hasOlder = data !== undefined && data !== null && data.logs.length < data.total;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => resetAnd(() => setAction("all"))}
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
              action === "all"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"
            )}
          >
            Semua
          </button>
          {(data?.byAction ?? []).map((a) => (
            <button
              key={a.action}
              onClick={() => resetAnd(() => setAction(a.action))}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 font-mono text-[11px] lowercase transition-colors",
                action === a.action
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"
              )}
            >
              {a.action} <span className="rounded bg-zinc-800 px-1 tabular-nums">{a.count}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => resetAnd(() => setStatus(e.target.value))}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 [&>option]:bg-zinc-900"
          >
            <option value="all">Semua status</option>
            <option value="success">success</option>
            <option value="warning">warning</option>
            <option value="failed">failed</option>
            <option value="info">info</option>
          </select>
          <select
            value={source}
            onChange={(e) => resetAnd(() => setSource(e.target.value))}
            className="max-w-[160px] rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 [&>option]:bg-zinc-900"
          >
            <option value="all">Semua source</option>
            <option value="system">system</option>
            {(data?.sources ?? [])
              .filter((s): s is string => s !== null)
              .map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              value={q}
              onChange={(e) => resetAnd(() => setQ(e.target.value))}
              placeholder="Cari pesan log…"
              className="h-8 w-44 border-zinc-800 bg-zinc-900 pl-7 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={download}
            disabled={!data || rows.length === 0}
            className="h-8 gap-1.5 border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            title="Download log yang sedang tampil sebagai .log"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Terminal */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-inner">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/70 px-4 py-2">
          <TerminalSquare className="h-4 w-4 text-amber-400" />
          <p className="font-mono text-xs font-semibold text-zinc-300">activity.log</p>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500">
            {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
            {live ? "streaming…" : "paused"}
          </span>
          <span className="ml-auto font-mono text-[10px] tabular-nums text-zinc-500">
            {loading ? "sync…" : `${rows.length.toLocaleString("id-ID")} / ${data?.total.toLocaleString("id-ID") ?? 0} log`}
          </span>
        </div>

        {/* load older */}
        {hasOlder && (
          <div className="flex justify-center border-b border-zinc-800/60 bg-zinc-900/30 py-1.5">
            <button
              onClick={() => setLimit((l) => l + PAGE)}
              className="flex items-center gap-1.5 rounded px-3 py-1 font-mono text-[11px] text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300"
            >
              <ArrowUpToLine className="h-3 w-3" />
              load older logs ({(data!.total - data!.logs.length).toLocaleString("id-ID")} tersisa)
            </button>
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-[calc(100vh-320px)] min-h-[320px] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed [scrollbar-width:thin]"
        >
          {rows.length === 0 ? (
            <p className="py-10 text-center text-zinc-600">
              {loading ? "memuat log…" : "Tidak ada log yang cocok dengan filter"}
            </p>
          ) : (
            rows.map((log) => (
              <div key={log.id} className="flex gap-2 rounded px-1.5 py-[3px] hover:bg-zinc-900/70">
                <span className={cn("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[log.status] ?? "bg-zinc-500")} />
                <span className="shrink-0 tabular-nums text-zinc-600">{stamp(log.ts)}</span>
                <span className="w-16 shrink-0">
                  <LogActionColor action={log.action} />
                </span>
                <span className="shrink-0 text-zinc-500">[{log.source ?? "system"}]</span>
                <span className={cn("min-w-0 flex-1 break-words", STATUS_TEXT[log.status] ?? "text-zinc-300")}>
                  {log.message}
                  {log.durationMs !== null && <span className="ml-1 text-zinc-600">({(log.durationMs / 1000).toFixed(2)}s)</span>}
                </span>
              </div>
            ))
          )}
        </div>

        {/* footer / follow bar */}
        <div className="flex items-center gap-2 border-t border-zinc-800/80 bg-zinc-900/70 px-4 py-1.5">
          <span className="font-mono text-[10px] text-zinc-600">
            {action !== "all" && `action:${action} `}
            {status !== "all" && `status:${status} `}
            {source !== "all" && `source:${source} `}
            {q.trim() && `q:"${q.trim()}"`}
            {action === "all" && status === "all" && source === "all" && !q.trim() && "tanpa filter"}
          </span>
          <div className="ml-auto">
            {follow ? (
              <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-500">
                <ArrowDownToLine className="h-3 w-3" /> following
              </span>
            ) : (
              <button
                onClick={jumpToLatest}
                className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-300 transition-colors hover:border-zinc-600"
              >
                <ArrowDownToLine className="h-3 w-3" /> jump to latest
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

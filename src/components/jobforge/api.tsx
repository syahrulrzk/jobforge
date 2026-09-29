"use client";

// ─────────────────────────────────────────────────────────────
// API & Integrasi (§19b) — satu menu untuk semua hal consumer &
// integrasi keluar:
//   · Dokumentasi  — referensi pull API siap dibagikan
//   · Token        — CRUD token consumer
//   · Riwayat      — history aksi LEASE/ACK/RELEASE per job
//   · Konfigurasi  — Job Portal Integration (pindahan dari Settings)
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { BookOpen, History, KeyRound, Server } from "lucide-react";
import { ApiDocsView } from "./api-docs";
import { TokensView } from "./tokens";
import { PullLogsView } from "./pull-logs";
import { PortalIntegrationSettings } from "./portal-settings";
import { cn } from "@/lib/utils";

type ApiTab = "docs" | "tokens" | "logs" | "config";

const TABS: { key: ApiTab; label: string; icon: React.ReactNode; hint: string }[] = [
  { key: "docs", label: "Dokumentasi", icon: <BookOpen className="h-3.5 w-3.5" />, hint: "Referensi API untuk consumer" },
  { key: "tokens", label: "Token", icon: <KeyRound className="h-3.5 w-3.5" />, hint: "Buat, edit, revoke token" },
  { key: "logs", label: "Riwayat", icon: <History className="h-3.5 w-3.5" />, hint: "History data yang diambil consumer" },
  { key: "config", label: "Konfigurasi", icon: <Server className="h-3.5 w-3.5" />, hint: "Job Portal Integration (URL, key, batch)" },
];

export function ApiView({ live }: { live: boolean }) {
  const [tab, setTab] = useState<ApiTab>("docs");

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* tab bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            title={t.hint}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors",
              tab === t.key
                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-border bg-card/60 text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* konten tab — flex-1 biar mengisi sisa viewport */}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "docs" && <ApiDocsView />}
        {tab === "tokens" && <TokensView />}
        {tab === "logs" && <PullLogsView live={live} />}
        {tab === "config" && <PortalIntegrationSettings />}
      </div>
    </div>
  );
}

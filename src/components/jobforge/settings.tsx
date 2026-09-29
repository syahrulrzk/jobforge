"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Database, Play, Save, Settings2 } from "lucide-react";
import { SecuritySettings } from "./security-settings";

interface SettingsData {
  settings: {
    portalApiUrl: string;
    portalApiKeyMasked: string;
    batchSize: string;
    maxAttempts: string;
    autoScrape: boolean;
    autoDelivery: boolean;
    tickIntervalMs: string;
    demoJobCap: string;
    dataMode: string;
    enginePool: string;
  };
}

export function SettingsView() {
  const [data, setData] = useState<SettingsData["settings"] | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((j: SettingsData) => setData(j.settings));
  }, []);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portalApiUrl: data.portalApiUrl,
          portalApiKey: apiKey || undefined,
          batchSize: data.batchSize,
          maxAttempts: data.maxAttempts,
          autoScrape: data.autoScrape,
          autoDelivery: data.autoDelivery,
          tickIntervalMs: data.tickIntervalMs,
          demoJobCap: data.demoJobCap,
          dataMode: data.dataMode,
        }),
      });
      if (!res.ok) throw new Error("Gagal menyimpan");
      toast.success("Pengaturan disimpan — engine akan memakai nilai baru pada tick berikutnya");
      setApiKey("");
    } catch {
      toast.error("Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  };

  const runPipeline = async () => {
    setRunning(true);
    toast.info("Menjalankan pipeline manual untuk semua source aktif…");
    try {
      const res = await fetch("/api/pipeline", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(json.message ?? "Pipeline selesai");
    } catch {
      toast.error("Pipeline gagal dijalankan");
    } finally {
      setRunning(false);
    }
  };

  if (!data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-72 animate-pulse rounded-xl border border-border bg-card/60" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Job Portal integration pindah ke menu API & Integrasi (§19b) */}

      {/* Worker engine (§22, §23) */}
      <section className="rounded-xl border border-border bg-card/60 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <h3 className="text-sm font-semibold text-foreground">Worker Engine</h3>
        </div>
        <div className="space-y-5">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-3">
            <p className="text-sm font-medium text-foreground">Mode Data</p>
            <p className="mb-2.5 text-[11px] text-muted-foreground">REAL menarik lowongan live dari API publik board — MOCK memakai generator simulasi</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: "real", label: "REAL — Live API", hint: "Remotive · Jobicy · Arbeitnow · RemoteOK" },
                { v: "mock", label: "MOCK — Generator", hint: "Data simulasi untuk demo pipeline" },
              ].map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => setData({ ...data, dataMode: opt.v })}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    data.dataMode === opt.v
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                      : "border-border bg-card/50 text-muted-foreground hover:border-border"
                  }`}
                >
                  <p className="text-xs font-semibold">{opt.label}</p>
                  <p className="mt-0.5 text-[10px] leading-snug opacity-70">{opt.hint}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card/50 px-3.5 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Auto Scrape</p>
              <p className="text-[11px] text-muted-foreground">Scheduler menjalankan scraper per source secara berkala</p>
            </div>
            <Switch checked={data.autoScrape} onCheckedChange={(v) => setData({ ...data, autoScrape: v })} className="data-[state=checked]:bg-amber-500" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card/50 px-3.5 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Auto Delivery</p>
              <p className="text-[11px] text-muted-foreground">Delivery worker mengirim job READY ke Job Portal (bulk + retry)</p>
            </div>
            <Switch checked={data.autoDelivery} onCheckedChange={(v) => setData({ ...data, autoDelivery: v })} className="data-[state=checked]:bg-amber-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tick Interval (ms)</Label>
              <Input
                type="number"
                value={data.tickIntervalMs}
                onChange={(e) => setData({ ...data, tickIntervalMs: e.target.value })}
                className="border-border bg-card tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Demo Job Cap</Label>
              <Input
                type="number"
                value={data.demoJobCap}
                onChange={(e) => setData({ ...data, demoJobCap: e.target.value })}
                className="border-border bg-card tabular-nums"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button className="flex-1 bg-amber-500 text-zinc-950 hover:bg-amber-400" onClick={() => void save()} disabled={saving}>
              <Save className="mr-1.5 h-3.5 w-3.5" /> {saving ? "Menyimpan…" : "Simpan Pengaturan"}
            </Button>
            <Button variant="outline" className="flex-1 border-border bg-card" onClick={() => void runPipeline()} disabled={running}>
              <Play className="mr-1.5 h-3.5 w-3.5" /> {running ? "Menjalankan…" : "Run Pipeline Now"}
            </Button>
          </div>
        </div>
      </section>

      {/* Keamanan dashboard — ganti password */}
      <SecuritySettings />

      {/* Stack info (§47) */}
      <section className="rounded-xl border border-border bg-card/60 p-5 lg:col-span-2">
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <h3 className="text-sm font-semibold text-foreground">Environment</h3>
        </div>
        <div className="grid gap-2 font-mono text-[11px] sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Runtime", "Bun"],
            ["Language", "TypeScript"],
            ["Framework", "Next.js 16 (App Router)"],
            ["ORM", "Prisma"],
            ["Database (sandbox)", "SQLite — PostgreSQL-ready"],
            ["Queue (sandbox)", "in-process worker"],
            ["Validation", "Zod — canonical schema §7"],
            ["Deploy target", "Docker + Nginx (lihat /deploy)"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-card/50 px-3 py-2">
              <p className="text-muted-foreground/80">{k}</p>
              <p className="mt-0.5 text-foreground/90">{v}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">
          Sandbox preview menjalankan stack Next.js + SQLite agar dapat langsung di-preview. File deployment
          Docker Compose (PostgreSQL + Redis + BullMQ) dan Nginx tersedia di folder <code className="rounded bg-accent px-1 text-muted-foreground">deploy/</code> untuk production sesuai PRD §4.1.
        </p>
      </section>
    </div>
  );
}

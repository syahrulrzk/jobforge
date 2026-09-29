"use client";

// ─────────────────────────────────────────────────────────────
// Job Portal Integration (§19, §37) — pindahan dari Settings ke
// menu API & Integrasi (tab Konfigurasi). Form self-contained:
// fetch data sendiri + simpan sendiri via /api/settings.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, Server, PlugZap, CheckCircle2, XCircle, Send } from "lucide-react";

interface SettingsData {
  settings: {
    portalApiUrl: string;
    portalApiKeyMasked: string;
    batchSize: string;
    maxAttempts: string;
  };
}

interface TestConnectionResult {
  ok: boolean;
  code: number | null;
  latencyMs: number;
  body: string;
}

interface SendNowResult {
  ok: boolean;
  queued: number;
  sent: number;
  failed: number;
  held: number;
  errors: string[];
}

// Payload dummy yang dikirim saat Test Connection — bentuknya persis
// CanonicalJob (§7) yang dipakai delivery worker, jadi test = uji kontrak penuh.
const TEST_CONNECTION_NOTE =
  "Test mengirim 1 payload dummy ke endpoint portal. Di Karivia, job test akan muncul sebagai 1 record pending di menu Hasil Scrape (bisa dihapus dari sana).";

export function PortalIntegrationSettings() {
  const [data, setData] = useState<SettingsData["settings"] | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [savedUrl, setSavedUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendNowResult | null>(null);
  const [readyCount, setReadyCount] = useState<number | null>(null);

  const refetchReadyCount = () =>
    fetch("/api/portal/send-now")
      .then((r) => r.json())
      .then((j: { ready?: number }) => setReadyCount(j.ready ?? 0))
      .catch(() => setReadyCount(null));

  useEffect(() => {
    void refetchReadyCount();
  }, []);

  const sendToPortal = async () => {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/portal/send-now", { method: "POST" });
      const j = (await res.json()) as SendNowResult & { error?: string };
      if (!res.ok || j.error) {
        toast.error(`Gagal kirim ke portal — ${j.error ?? "server error"}`);
        return;
      }
      setSendResult(j);
      void refetchReadyCount();
      if (j.sent > 0 && j.failed === 0) {
        toast.success(`${j.sent} job terkirim ke portal`);
      } else if (j.sent > 0) {
        toast.warning(`${j.sent} terkirim, ${j.failed} gagal — cek detail di bawah`);
      } else if (j.queued === 0 && j.held === 0) {
        toast.info("Tidak ada job READY yang siap dikirim");
      } else {
        toast.warning(`${j.queued} diantrekan tapi belum terkirim, ${j.held} ditahan pre-flight — cek detail di bawah`);
      }
    } catch {
      toast.error("Gagal menjalankan kirim ke portal");
    } finally {
      setSending(false);
    }
  };

  const testConnection = async () => {
    // Test memakai nilai yang TERSIMPAN (DB), bukan isi form — kalau ada
    // perubahan form yang belum disimpan, kasih tahu dulu lewat toast.
    if (data && data.portalApiUrl !== savedUrl) {
      toast.warning("URL di form belum disimpan — test memakai URL yang tersimpan");
    }
    if (apiKey) {
      toast.warning("API key baru belum disimpan — test memakai key yang tersimpan");
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/portal/test-connection", { method: "POST" });
      const j = (await res.json()) as TestConnectionResult;
      setTestResult(j);
      if (j.ok) {
        toast.success(`Koneksi portal OK — HTTP ${j.code} dalam ${j.latencyMs}ms`);
      } else {
        toast.error(`Koneksi portal gagal — ${j.code !== null ? `HTTP ${j.code}` : "network/timeout"}`);
      }
    } catch {
      toast.error("Gagal menjalankan test connection");
    } finally {
      setTesting(false);
    }
  };

  const refetch = () => {
    return fetch("/api/settings")
      .then((r) => r.json())
      .then((j: SettingsData) => {
        setData(j.settings);
        setSavedUrl(j.settings.portalApiUrl);
      });
  };

  useEffect(() => {
    void refetch();
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
        }),
      });
      if (!res.ok) throw new Error("Gagal menyimpan");
      toast.success("Job Portal Integration disimpan — delivery worker memakai nilai baru pada tick berikutnya");
      setApiKey("");
    } catch {
      toast.error("Gagal menyimpan konfigurasi portal");
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return (
      <div className="h-72 animate-pulse rounded-xl border border-border bg-card/60" />
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Server className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-foreground">Job Portal Integration</h3>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">JOB_PORTAL_API_URL</Label>
          <Input
            value={data.portalApiUrl}
            onChange={(e) => setData({ ...data, portalApiUrl: e.target.value })}
            className="border-border bg-card font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground/80">Endpoint tujuan bulk import — POST /api/v1/jobs/import</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">JOB_PORTAL_API_KEY</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={data.portalApiKeyMasked}
            className="border-border bg-card font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground/80">Secret disimpan di environment — tidak pernah di-hardcode (PRD §37). Kosongkan bila tidak diubah.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Batch Size (50–500 disarankan)</Label>
            <Input
              type="number"
              value={data.batchSize}
              onChange={(e) => setData({ ...data, batchSize: e.target.value })}
              className="border-border bg-card tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Max Attempts (retry backoff)</Label>
            <Input
              type="number"
              value={data.maxAttempts}
              onChange={(e) => setData({ ...data, maxAttempts: e.target.value })}
              className="border-border bg-card tabular-nums"
            />
          </div>
        </div>
        <Button className="w-full bg-amber-500 text-zinc-950 hover:bg-amber-400" onClick={() => void save()} disabled={saving}>
          <Save className="mr-1.5 h-3.5 w-3.5" /> {saving ? "Menyimpan…" : "Simpan konfigurasi portal"}
        </Button>
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">Test Connection</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{TEST_CONNECTION_NOTE}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void testConnection()}
              disabled={testing}
            >
              <PlugZap className="mr-1.5 h-3.5 w-3.5" /> {testing ? "Mengirim…" : "Test"}
            </Button>
          </div>
          {testResult && (
            <div
              className={`mt-3 rounded-md border p-3 text-xs ${
                testResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {testResult.ok
                  ? `Berhasil — HTTP ${testResult.code} (${testResult.latencyMs}ms)`
                  : `Gagal — ${testResult.code !== null ? `HTTP ${testResult.code}` : "network error / timeout"} (${testResult.latencyMs}ms)`}
              </div>
              {testResult.body && (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[10px] leading-snug text-foreground/80">
                  {testResult.body}
                </pre>
              )}
            </div>
            )}
        </div>

        {/* Kirim manual — antrekan semua job READY lolos pre-flight lalu flush
            ke portal tanpa nunggu tick otomatis (§31 dashboard actions). */}
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">
                Kirim data ke portal{" "}
                {readyCount !== null && (
                  <span
                    className={`ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      readyCount > 0
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {readyCount} siap kirim
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
                Antrekan semua job READY yang lolos pre-flight, lalu kirim sekarang — tanpa menunggu tick otomatis. Menggunakan jalur delivery yang sama dengan worker.
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={() => void sendToPortal()}
              disabled={sending}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" /> {sending ? "Mengirim…" : "Kirim ke portal"}
            </Button>
          </div>
          {sendResult && (
            <div
              className={`mt-3 rounded-md border p-3 text-xs ${
                sendResult.sent > 0 && sendResult.failed === 0
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {sendResult.sent > 0 && sendResult.failed === 0 ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {sendResult.sent} terkirim · {sendResult.failed} gagal · {sendResult.queued} diantrekan · {sendResult.held} ditahan
              </div>
              {sendResult.errors.length > 0 && (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[10px] leading-snug text-foreground/80">
                  {sendResult.errors.join("\n")}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

"use client";

// Tools — Domain Search (ala hunter.io)
//
// Satu search bar, satu input: DOMAIN perusahaan. Tidak ada pilihan
// "database vs internet" — keduanya digabung mulus:
//   1. Email yang sudah tersimpan di gudang muncul instan saat mengetik
//      (GET /api/search/domain).
//   2. Tombol "Cari Email" menjalankan live harvest ke internet:
//      deep crawl situs (max 25 halaman) → search @domain → BBOT opsional.
//      Hasil auto masuk gudang data (bukan ke job).
//
// API khusus: /api/search/domain — terpisah dari pipeline job.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useJobForgeStore } from "@/store/jobforge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  Save,
  Search,
  X,
} from "lucide-react";
import { EmptyState } from "./ui-bits";

// ── Types ────────────────────────────────────────────────────────
interface StoredEmail {
  email: string;
  kind: string;
  category: string | null;
  via: string;
  domain: string;
  sourceUrl: string | null;
  sources: string[];
  companyName: string | null;
  companyWebsite: string | null;
  createdAt: string;
}

interface StoredResponse {
  query: { domain: string };
  total: number;
  warehouse: { totalEmails: number; totalDomains: number };
  emails: StoredEmail[];
  error?: string;
}

interface HarvestStep {
  source: "CRAWL" | "SEARCH" | "BBOT" | "PROXY";
  status: "success" | "failed";
  durationMs: number;
  note: string;
}

interface HarvestEmail {
  email: string;
  kind: "role" | "personal" | "unknown";
  category: string | null;
  sourceUrl: string;
  via: string;
  sources: string[];
  saved?: boolean;
}

interface HarvestResponse {
  domain: string;
  emails: HarvestEmail[];
  pagesCrawled: number;
  steps: HarvestStep[];
  durationMs: number;
  autoSaved?: { created: number; duplicate: number; companyName: string | null } | null;
  error?: string;
}

const KIND_BADGE: Record<string, string> = {
  role: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  personal: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  unknown: "bg-zinc-500/10 text-muted-foreground",
};

const POPULAR_DOMAINS = ["gojek.com", "tokopedia.com", "traveloka.com", "bukalapak.com", "ovo.id"];

export function SearchEmailView() {
  const { setView } = useJobForgeStore();
  const [input, setInput] = useState("");
  const [appliedDomain, setAppliedDomain] = useState("");

  const [stored, setStored] = useState<StoredResponse | null>(null);
  const [loadingStored, setLoadingStored] = useState(false);

  const [harvest, setHarvest] = useState<HarvestResponse | null>(null);
  const [harvesting, setHarvesting] = useState(false);

  // debounce 400ms — email tersimpan muncul instan saat mengetik domain
  useEffect(() => {
    const t = setTimeout(() => {
      const raw = input.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
      if (raw.includes(".") && raw.length >= 3) {
        setAppliedDomain(raw);
      } else {
        setAppliedDomain("");
        setStored(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [input]);

  const loadStored = async (domain: string) => {
    setLoadingStored(true);
    try {
      const res = await fetch(`/api/search/domain?domain=${encodeURIComponent(domain)}`, { cache: "no-store" });
      const json = (await res.json()) as StoredResponse;
      if (!res.ok) throw new Error(json.error ?? "Gagal memuat");
      setStored(json);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat email tersimpan");
    } finally {
      setLoadingStored(false);
    }
  };

  useEffect(() => {
    if (appliedDomain) void loadStored(appliedDomain);
  }, [appliedDomain]);

  // Live harvest — deep crawl situs + search @domain (+ BBOT opsional)
  const runSearch = async () => {
    const raw = input.trim();
    if (!raw) return;
    setHarvesting(true);
    setHarvest(null);
    try {
      // server yang pilih engine & proxy otomatis — pakai semua tool yang ada
      const res = await fetch("/api/search/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: raw }),
      });
      const json = (await res.json()) as HarvestResponse;
      if (!res.ok) throw new Error(json.error ?? "Pencarian gagal");
      setHarvest(json);
      const s = json.autoSaved;
      if (json.emails.length > 0) {
        toast.success(
          `${json.emails.length} email ditemukan untuk ${json.domain} (${json.pagesCrawled} halaman)${s ? ` — gudang: +${s.created} baru${s.duplicate > 0 ? `, ${s.duplicate} sudah ada` : ""}${s.companyName ? ` · ${s.companyName}` : ""}` : ""}`,
        );
      } else {
        toast.info(`Tidak ada email publik ditemukan untuk ${json.domain}`);
      }
      // hasil auto-terimpan — refresh daftar tersimpan
      const domain = json.domain;
      if (domain && domain.includes(".")) {
        setInput(domain);
        void loadStored(domain);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pencarian gagal");
    } finally {
      setHarvesting(false);
    }
  };

  const hasDomain = !!appliedDomain;
  const storedEmails = stored?.emails ?? [];

  return (
    <div className="space-y-4">
      {/* ── Hero search — ala hunter.io ── */}
      <section className="rounded-xl border border-border bg-gradient-to-br from-card via-card/60 to-card/20 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15">
              <Search className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Domain Search</h2>
              <p className="text-xs text-muted-foreground">
                Temukan semua email publik perusahaan dari satu domain — langsung masuk gudang data
              </p>
            </div>
          </div>

          {/* Gudang data — total email terkumpul (klik → buka menu Email) */}
          {stored?.warehouse && (
            <button
              onClick={() => setView("warehouse")}
              className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-1.5 transition-colors hover:bg-violet-500/10"
              title="Buka gudang data — lihat semua email yang terkumpul"
            >
              <Save className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
              <div className="text-left leading-tight">
                <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Gudang Data</p>
                <p className="text-xs font-semibold tabular-nums text-violet-700 dark:text-violet-300">
                  {stored.warehouse.totalEmails.toLocaleString("id-ID")} email · {stored.warehouse.totalDomains.toLocaleString("id-ID")} domain
                </p>
              </div>
            </button>
          )}
        </div>

        {/* Search bar */}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Globe className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Domain perusahaan — mis. tokopedia.com"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runSearch()}
              className="h-11 border-border bg-background dark:bg-zinc-950 pl-9 pr-9 text-sm"
            />
            {input && (
              <button
                onClick={() => {
                  setInput("");
                  setStored(null);
                  setHarvest(null);
                }}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground/90"
                title="Bersihkan"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            className="h-11 bg-violet-500 px-5 text-zinc-950 hover:bg-violet-400"
            onClick={() => void runSearch()}
            disabled={harvesting || !input.trim()}
            title="Deep crawl situs (sampai 25 halaman) + search @domain + BBOT opsional — semua email yang ke-expose di internet"
          >
            {harvesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {harvesting ? "Mencari…" : "Cari Email"}
          </Button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-muted-foreground/80">Coba:</span>
          {POPULAR_DOMAINS.map((d) => (
            <button
              key={d}
              onClick={() => setInput(d)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                input === d
                  ? "border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-300"
                  : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {harvesting && (
          <p className="mt-3 flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-violet-700 dark:text-violet-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Mencari email dari {input.trim()}: deep crawl situs (max 25 halaman) → search @domain → BBOT — butuh 30–90 detik…
          </p>
        )}

        {/* Steps console — langkah harvest transparan */}
        {harvest && harvest.steps.length > 0 && (
          <div className="mt-3 space-y-1 rounded-lg border border-border bg-zinc-950/5 px-3 py-2 font-mono text-[11px] dark:bg-zinc-950/40">
            {harvest.steps.map((s, i) => (
              <p key={i} className="flex items-center gap-2">
                <span className={s.status === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                  {s.status === "success" ? "✓" : "✗"}
                </span>
                <span className="font-semibold text-foreground/90">{s.source}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.note}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground/60">{(s.durationMs / 1000).toFixed(1)}s</span>
              </p>
            ))}
          </div>
        )}

        {/* Hasil harvest live */}
        {harvest && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground/90">{harvest.emails.length}</span> email unik untuk{" "}
                <span className="font-mono text-foreground/90">@{harvest.domain}</span> — {harvest.pagesCrawled} halaman di-crawl dalam{" "}
                {(harvest.durationMs / 1000).toFixed(1)}s. Semua benar-benar ter-publish di internet — tidak ada yang ditebak.
              </p>
              {harvest.autoSaved && harvest.emails.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                  <Save className="h-3 w-3" />
                  Auto-terimpan ke gudang: +{harvest.autoSaved.created} baru
                  {harvest.autoSaved.duplicate > 0 ? `, ${harvest.autoSaved.duplicate} duplikat di-refresh` : ""}
                  {harvest.autoSaved.companyName ? ` · ${harvest.autoSaved.companyName}` : ""}
                </span>
              )}
            </div>
            <EmailTable emails={harvest.emails.map((e) => ({ ...e, sourceUrl: e.sourceUrl, saved: e.saved ?? false }))} />
          </div>
        )}
      </section>

      {/* ── Email tersimpan di gudang (muncul instan) ── */}
      {hasDomain && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <Save className="h-3.5 w-3.5" /> Email tersimpan — @{appliedDomain} ({storedEmails.length})
            </p>
            {loadingStored && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>

          {!loadingStored && storedEmails.length === 0 ? (
            <EmptyState
              title={stored ? "Belum ada email tersimpan untuk domain ini" : "Memuat…"}
              hint="Klik Cari Email di atas untuk scan internet: deep crawl situs perusahaan + mesin pencari. Hasilnya otomatis tersimpan di sini."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-accent/60 text-[10px] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Email</th>
                    <th className="px-3 py-2 font-semibold">Kategori</th>
                    <th className="hidden px-3 py-2 font-semibold md:table-cell">Sumber</th>
                    <th className="hidden px-3 py-2 font-semibold lg:table-cell">Ditemukan</th>
                    <th className="px-3 py-2 text-right font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {storedEmails.map((h) => (
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
                      </td>
                      <td className="hidden max-w-[220px] px-3 py-2 md:table-cell">
                        {h.sourceUrl ? (
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
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                        {h.sources.length > 1 && <span className="text-[10px] text-muted-foreground/60">+{h.sources.length - 1} sumber lain</span>}
                      </td>
                      <td className="hidden px-3 py-2 text-[10px] text-muted-foreground lg:table-cell">
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" /> via {h.via}
                        </span>
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
          )}
        </div>
      )}

      {!hasDomain && (
        <EmptyState
          title="Cari email perusahaan by domain"
          hint="Ketik domain perusahaan — email yang sudah tersimpan muncul instan dari gudang data, atau klik Cari Email untuk scan internet ala hunter.io."
        />
      )}
    </div>
  );
}

// ── Tabel hasil harvest live ─────────────────────────────────────
function EmailTable({ emails }: { emails: (HarvestEmail & { saved: boolean })[] }) {
  if (emails.length === 0) {
    return (
      <EmptyState
        title="Tidak ada email publik ditemukan"
        hint="Domain mungkin tidak meng-publish email di halaman publik. Coba aktifkan Mode OSINT (BBOT), atau mesin pencari lain."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-accent/60 text-[10px] tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 font-semibold">Email</th>
            <th className="px-3 py-2 font-semibold">Kategori</th>
            <th className="hidden px-3 py-2 font-semibold md:table-cell">Sumber</th>
            <th className="px-3 py-2 text-right font-semibold">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {emails.map((e) => (
            <tr key={e.email} className="border-t border-border/60 hover:bg-accent/30">
              <td className="max-w-[240px] px-3 py-2">
                <p className="truncate font-mono text-[11px] font-medium text-foreground" title={e.email}>
                  {e.email}
                </p>
              </td>
              <td className="px-3 py-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[e.kind]}`}>{e.category ?? e.kind}</span>
                {e.saved && (
                  <span
                    className="ml-1 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-700 dark:text-emerald-300"
                    title="Email sudah tersimpan di gudang data"
                  >
                    tersimpan
                  </span>
                )}
              </td>
              <td className="hidden max-w-[220px] px-3 py-2 md:table-cell">
                <a
                  href={e.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1 truncate text-muted-foreground hover:text-foreground/90"
                  title={e.sourceUrl}
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{e.sourceUrl.replace(/^https?:\/\//, "")}</span>
                </a>
                {e.sources.length > 1 && <span className="text-[10px] text-muted-foreground/60">+{e.sources.length - 1} sumber lain</span>}
              </td>
              <td className="px-3 py-2 text-right">
                <a
                  href={`mailto:${e.email}`}
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
  );
}

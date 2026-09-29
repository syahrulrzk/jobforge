"use client";

// Tools — Cari Orang & Jabatan
//
// Cari kontak HR per jabatan (HR, HRD, Talent Acquisition, Recruitment, dst)
// dan per perusahaan. Sumber = email HR ter-publish di JobContact (§12).
//
// Jabatan diinferensi dari prefix email (hr@, talent@, recruitment@…).
// Nama pribadi hanya muncul bila pola email jelas nama (firstname.lastname@)
// dan SELALU ditandai "inferred" — bukan hasil scrape profil (§12.4).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, ExternalLink, FileText, Globe, Linkedin, Mail, Search, Shuffle, UserRound, Users, X } from "lucide-react";
import { CompanyAvatar, EmptyState, timeAgo } from "./ui-bits";
import { useApi } from "@/hooks/use-api";
import { gridColumns } from "@/hooks/use-dynamic-page-size";

interface PersonCard {
  key: string;
  hrEmail: string;
  localPart: string;
  companyDomain: string | null;
  role: string;
  personName: string | null;
  personInferred: boolean;
  company: { id: string; name: string; logoUrl: string; website: string | null; industry: string | null } | null;
  companyName: string;
  emailStatus: string;
  emailSourceUrl: string | null;
  jobCount: number;
  sampleJobs: { id: string; title: string }[];
  lastSeen: string;
}

interface PeopleResponse {
  total: number;
  page: number;
  pageSize: number;
  stats: { role: string; count: number }[];
  people: PersonCard[];
  error?: string;
}

const POPULAR_ROLES = ["HR", "HRD", "Recruitment", "Talent Acquisition", "Careers"];

// Sumber pencarian orang
const SOURCE_MODES = [
  { key: "db", label: "Database", hint: "Kontak HR yang sudah tersimpan di gudang data pipeline (JobContact)" },
  { key: "li", label: "Internet (LinkedIn)", hint: "Public profile LinkedIn via search engine (site:linkedin.com/in) — tanpa scraping LinkedIn langsung" },
] as const;

type SourceMode = (typeof SOURCE_MODES)[number]["key"];

// Mesin pencari untuk mode Internet — sinkron dengan SearchEngineKey di lib/jobforge/email-finder
const LI_ENGINE_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: "auto", label: "Auto", hint: "Google CSE bila env tersedia → Bing — mesin pertama yang jawab menang" },
  { key: "bing", label: "Bing", hint: "Tanpa API key — paling stabil dari server" },
  { key: "duckduckgo", label: "DuckDuckGo", hint: "Tanpa API key — sering diblok dari IP datacenter" },
  { key: "google-cse", label: "Google CSE", hint: "Butuh GOOGLE_CSE_KEY + GOOGLE_CSE_CX di .env — kualitas terbaik" },
];

// Proxy — sama dengan halaman Cari Email (lib/jobforge/proxy-pool)
const PROXY_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: "direct", label: "Tanpa Proxy", hint: "Langsung dari IP server — paling cepat, paling gampang keblokir" },
  { key: "auto", label: "Gratis (Auto)", hint: "Proxy publik gratis + validasi otomatis + rotasi — gagal otomatis fallback langsung" },
  { key: "custom", label: "Custom", hint: "Pakai proxy sendiri — format http://user:pass@host:port (residensial disarankan)" },
];

interface LinkedInPerson {
  name: string | null;
  headline: string | null;
  company: string | null;
  location: string | null;
  linkedinUrl: string;
}

interface PeopleSearchStep {
  engine: "PROXY" | "SEARCH" | "FILTER";
  status: "success" | "failed" | "skipped";
  durationMs: number;
  note: string;
}

interface PeopleSearchResponse {
  found: number;
  engine: string;
  steps: PeopleSearchStep[];
  results: LinkedInPerson[];
}

/** Unduh teks sebagai file (CSV/JSON) — ekspor hasil pencarian. */
function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: LinkedInPerson[]): string {
  const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return ["Nama", "Jabatan", "Perusahaan", "Lokasi", "LinkedIn", "Headline"].join(",") + "\n" +
    rows.map((r) => [esc(r.name), esc(""), esc(r.company), esc(r.location), esc(r.linkedinUrl), esc(r.headline)].join(",")).join("\n");
}

export function SearchPeopleView() {
  const [roleInput, setRoleInput] = useState("");
  const [companyInput, setCompanyInput] = useState("");
  const [applied, setApplied] = useState<{ role: string; company: string } | null>(null);
  const [page, setPage] = useState(1);
  // pageSize fix 4 BARIS kartu per halaman (konsisten Companies) — total = 4 × kolom
  // aktif (2 @sm / 2 @lg / 3 @xl, sinkron dgn class grid sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3)
  // lazy init langsung baca window → fetch pertama sudah benar, tanpa lompatan
  const [cols, setCols] = useState(() =>
    typeof window === "undefined" ? 1 : gridColumns(window.innerWidth, [2, 2, 3]),
  );
  useEffect(() => {
    const sync = () => setCols(gridColumns(window.innerWidth, [2, 2, 3]));
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  const pageSize = 4 * cols;

  // mode Internet (LinkedIn)
  const [mode, setMode] = useState<SourceMode>("db");
  const [liEngine, setLiEngine] = useState("auto");
  const [liProxyMode, setLiProxyMode] = useState("direct");
  const [liProxyUrl, setLiProxyUrl] = useState("");
  const [liData, setLiData] = useState<PeopleSearchResponse | null>(null);
  const [liLoading, setLiLoading] = useState(false);
  const [liError, setLiError] = useState<string | null>(null);
  const [liSearched, setLiSearched] = useState(false);

  // debounce 400ms
  useEffect(() => {
    const t = setTimeout(() => {
      const role = roleInput.trim();
      const company = companyInput.trim();
      if (!role && !company) {
        setApplied(null);
        return;
      }
      setApplied({ role, company });
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [roleInput, companyInput]);

  const url = useMemo(() => {
    if (!applied || mode !== "db") return null;
    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (applied.role) sp.set("role", applied.role);
    if (applied.company) sp.set("company", applied.company);
    return `/api/search/people?${sp.toString()}`;
  }, [applied, page, mode, pageSize]);

  const { data, loading, error } = useApi<PeopleResponse>(url);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // Jalankan pencarian Internet (LinkedIn) — hanya bila mode aktif
  const liRun = async () => {
    const role = roleInput.trim();
    const company = companyInput.trim();
    if (!role && !company) {
      toast.error("Isi jabatan atau perusahaan dulu");
      return;
    }
    setLiLoading(true);
    setLiError(null);
    setLiData(null);
    setLiSearched(true);
    try {
      const sp = new URLSearchParams({ engine: liEngine, proxyMode: liProxyMode });
      if (role) sp.set("role", role);
      if (company) sp.set("company", company);
      if (liProxyMode === "custom" && liProxyUrl.trim()) sp.set("proxyUrl", liProxyUrl.trim());
      const res = await fetch(`/api/search/people/linkedin?${sp.toString()}`);
      const json = (await res.json()) as PeopleSearchResponse & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLiData(json);
    } catch (e) {
      setLiError(e instanceof Error ? e.message : "Gagal mencari");
    } finally {
      setLiLoading(false);
    }
  };

  // klik chip role = set input role (toggle: klik lagi = hapus)
  const pickRole = (r: string) => {
    setRoleInput((prev) => (prev.toLowerCase() === r.toLowerCase() ? "" : r));
  };

  const hasQuery = !!applied;

  return (
    <div className="space-y-4">
      {/* Hero search */}
      <section className="rounded-xl border border-border bg-gradient-to-br from-card via-card/60 to-card/20 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15">
              <Users className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Cari Orang & Jabatan</h2>
              <p className="text-xs text-muted-foreground">
                {mode === "li"
                  ? "Public profile LinkedIn via search engine (site:linkedin.com/in) — tanpa scraping LinkedIn langsung"
                  : "Kontak HR per jabatan & perusahaan — dari email karir yang benar-benar ter-publish"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <UserRound className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder={mode === "li" ? "Jabatan — mis. IT Manager, HR Manager, Head of IT…" : "Jabatan — mis. HR, recruitment, talent acquisition…"}
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
              className="h-11 border-border bg-background dark:bg-zinc-950 pl-9 pr-9 text-sm"
            />
            {roleInput && (
              <button
                onClick={() => setRoleInput("")}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground/90"
                title="Hapus jabatan"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="relative sm:w-64">
            <Building2 className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Perusahaan / lokasi / industri (opsional)"
              value={companyInput}
              onChange={(e) => setCompanyInput(e.target.value)}
              className="h-11 border-border bg-background dark:bg-zinc-950 pl-9 pr-9 text-sm"
            />
            {companyInput && (
              <button
                onClick={() => setCompanyInput("")}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground/90"
                title="Hapus perusahaan"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {mode === "li" ? (
            <Button
              className="h-11 bg-violet-500 px-5 text-zinc-950 hover:bg-violet-400"
              onClick={liRun}
              disabled={liLoading || (!roleInput.trim() && !companyInput.trim())}
            >
              <Linkedin className="h-4 w-4" /> {liLoading ? "Mencari…" : "Cari di Internet"}
            </Button>
          ) : (
            <Button
              className="h-11 bg-violet-500 px-5 text-zinc-950 hover:bg-violet-400"
              onClick={() => {
                setApplied({ role: roleInput.trim(), company: companyInput.trim() });
                setPage(1);
              }}
              disabled={!roleInput.trim() && !companyInput.trim()}
            >
              <Search className="h-4 w-4" /> Cari
            </Button>
          )}
        </div>

        {/* Chip jabatan populer — dari statistik DB kalau sudah ada hasil */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-muted-foreground/80">Jabatan:</span>
          {mode === "db" && (data?.stats?.length ? data.stats.slice(0, 8).map((s) => s.role) : POPULAR_ROLES).map((r) => {
            const count = data?.stats?.find((s) => s.role === r)?.count;
            return (
              <button
                key={r}
                onClick={() => pickRole(r)}
                title={count !== undefined ? `${count} kontak` : undefined}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  roleInput.toLowerCase() === r.toLowerCase()
                    ? "border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-300"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {r}
                {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Mode sumber: Database / Internet (LinkedIn) */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 flex items-center gap-1 text-[11px] text-muted-foreground/80">
            <Search className="h-3 w-3" /> Sumber:
          </span>
          {SOURCE_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              title={m.hint}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                mode === m.key
                  ? "border-violet-500/50 bg-violet-500/15 font-medium text-violet-700 dark:text-violet-300"
                  : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {m.key === "li" && <Linkedin className="h-3 w-3" />}
              {m.label}
            </button>
          ))}
        </div>

        {/* Opsi mode Internet — mesin pencari + proxy */}
        {mode === "li" && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground/80">Mesin:</span>
            {LI_ENGINE_OPTIONS.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => setLiEngine(e.key)}
                title={e.hint}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  liEngine === e.key
                    ? "border-emerald-500/50 bg-emerald-500/15 font-medium text-emerald-700 dark:text-emerald-300"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {e.label}
              </button>
            ))}
            <span className="ml-3 flex items-center gap-1 text-[11px] text-muted-foreground/80">
              <Shuffle className="h-3 w-3" /> Proxy:
            </span>
            {PROXY_OPTIONS.map((p) => (
              <button
                key={p.key}
                type="button"
                disabled={liLoading}
                onClick={() => setLiProxyMode(p.key)}
                title={p.hint}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                  liProxyMode === p.key
                    ? "border-violet-500/50 bg-violet-500/15 font-medium text-violet-700 dark:text-violet-300"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
            {liProxyMode === "custom" && (
              <Input
                value={liProxyUrl}
                onChange={(e) => setLiProxyUrl(e.target.value)}
                placeholder="http://user:pass@host:port"
                className="h-7 w-56 border-border bg-background dark:bg-zinc-950 px-2 font-mono text-[11px]"
                title="Proxy pribadi — dipakai semua fetch engine pencarian"
              />
            )}
          </div>
        )}

        {mode === "db" && (
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
            Jabatan disimpulkan dari prefix email karir yang ter-publish (hr@ → HR, talent@ → Talent Acquisition, dst).
            Nama pribadi hanya ditampilkan bila pola email jelas nama dan ditandai <em>inferred</em> — tidak ada data yang dikarang.
          </p>
        )}
        {mode === "li" && (
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
            Hanya <strong>public profile</strong> yang ter-index search engine (query <code>site:linkedin.com/in</code>) — tanpa scraping LinkedIn
            langsung, tanpa login, tanpa API LinkedIn. Nama disimpulkan dari URL profil & snippet SERP (heuristik, tidak dikarang).
          </p>
        )}
      </section>

      {/* Result count */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {mode === "li" ? (
            liLoading ? (
              "Mencari profil di internet…"
            ) : liError ? (
              <span className="text-rose-600 dark:text-rose-300">{liError}</span>
            ) : liData ? (
              <>
                <span className="font-semibold tabular-nums text-foreground/90">{liData.found.toLocaleString("id-ID")}</span> profil ditemukan via{" "}
                <span className="text-violet-700 dark:text-violet-300">{liData.engine}</span>
              </>
            ) : (
              "Isi jabatan + perusahaan/lokasi, lalu klik Cari di Internet"
            )
          ) : error ? (
            <span className="text-rose-600 dark:text-rose-300">{error}</span>
          ) : loading && !data ? (
            "Mencari…"
          ) : data ? (
            <>
              <span className="font-semibold tabular-nums text-foreground/90">{data.total.toLocaleString("id-ID")}</span>{" "}
              kontak ditemukan
              {applied?.role && <> dengan jabatan <span className="text-violet-700 dark:text-violet-300">“{applied.role}”</span></>}
              {applied?.company && <> di <span className="text-violet-700 dark:text-violet-300">“{applied.company}”</span></>}
            </>
          ) : (
            "Masukkan jabatan atau nama perusahaan untuk mulai mencari"
          )}
        </p>
        {hasQuery && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-border bg-card text-xs text-muted-foreground"
            onClick={() => {
              setRoleInput("");
              setCompanyInput("");
              setApplied(null);
              setPage(1);
            }}
          >
            Reset
          </Button>
        )}
      </div>

      {/* Results grid */}
      {mode === "li" ? (
        <section className="space-y-3">
          {liLoading && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[120px] animate-pulse rounded-xl border border-border bg-card/60" />
              ))}
            </div>
          )}
          {!liLoading && liError && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-300">{liError}</div>
          )}
          {!liLoading && !liError && liData && liData.results.length === 0 && (
            <EmptyState
              title="Tidak ada profil publik yang cocok"
              hint="Coba jabatan lebih umum (mis. “IT Manager”), atau kurangi filter perusahaan/lokasi. Hanya public profile yang ter-index search engine yang bisa ditemukan."
            />
          )}
          {!liLoading && !liError && liData && liData.results.length > 0 && (
            <>
              {/* console engine — transparan kayak halaman Cari Email */}
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                  {liData.steps.map((s) => (
                    <span key={s.engine} className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={
                          s.status === "success"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : s.status === "failed"
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-muted-foreground"
                        }
                      >
                        {s.status === "success" ? "✓" : s.status === "failed" ? "✗" : "–"} {s.engine}
                      </span>
                      <span className="truncate text-muted-foreground/80">
                        ({(s.durationMs / 1000).toFixed(1)}s) — {s.note}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              {/* ekspor CSV / JSON */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-border bg-card text-xs"
                  onClick={() =>
                    downloadText(
                      `linkedin-${(roleInput.trim() || companyInput.trim() || "people").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
                      toCsv(liData.results),
                      "text/csv",
                    )
                  }
                >
                  Ekspor CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-border bg-card text-xs"
                  onClick={() =>
                    downloadText(
                      `linkedin-${(roleInput.trim() || companyInput.trim() || "people").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
                      JSON.stringify(liData.results, null, 2),
                      "application/json",
                    )
                  }
                >
                  Ekspor JSON
                </Button>
              </div>

              {/* tabel hasil: Nama | Jabatan | Perusahaan | LinkedIn */}
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-card/80 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Nama</th>
                      <th className="px-3 py-2 font-semibold">Jabatan</th>
                      <th className="px-3 py-2 font-semibold">Perusahaan</th>
                      <th className="px-3 py-2 font-semibold">LinkedIn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liData.results.map((r) => (
                      <tr key={r.linkedinUrl} className="border-t border-border/60 hover:bg-card/40">
                        <td className="max-w-[260px] px-3 py-2">
                          <p className="truncate font-medium text-foreground/90">
                            {r.name ?? <span className="italic text-muted-foreground">tidak terbaca</span>}
                          </p>
                          {r.headline && <p className="truncate text-[11px] text-muted-foreground" title={r.headline}>{r.headline}</p>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{roleInput.trim() || "—"}</td>
                        <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">{r.company ?? "—"}</td>
                        <td className="px-3 py-2">
                          <a
                            href={r.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-w-0 items-center gap-1 text-sky-700 underline underline-offset-2 hover:text-sky-600 dark:text-sky-300 dark:hover:text-sky-200"
                          >
                            <Linkedin className="h-3 w-3 shrink-0" />
                            <span className="max-w-[240px] truncate">{r.linkedinUrl.replace("https://www.linkedin.com/in/", "linkedin.com/in/")}</span>
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!liLoading && !liError && !liData && (
            <EmptyState
              title="Cari orang di internet"
              hint="Contoh: jabatan “IT Manager” + perusahaan “Bank Mandiri”, atau “HR Manager” + lokasi “Jakarta” — hasilnya public profile LinkedIn dari search engine."
            />
          )}
        </section>
      ) : !hasQuery ? (
        <EmptyState
          title="Cari kontak HR & jabatan"
          hint="Contoh: jabatan “HR” + perusahaan “gojek” → semua kontak HR Gojek yang email-nya ter-publish di database pipeline."
        />
      ) : loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[168px] animate-pulse rounded-xl border border-border bg-card/60" />
          ))}
        </div>
      ) : data && data.people.length === 0 ? (
        <EmptyState
          title="Tidak ada kontak yang cocok"
          hint="Coba jabatan lain (mis. HR, talent, recruitment), atau kurangi filter perusahaan. Kontak baru muncul setelah pipeline menemukan email karir ter-publish."
        />
      ) : data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.people.map((p) => (
            <div key={p.key} className="flex flex-col gap-2.5 rounded-xl border border-border bg-card/60 p-4">
              <div className="flex items-start gap-3">
                <CompanyAvatar name={p.companyName} logoUrl={p.company?.logoUrl} website={p.company?.website} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {p.personName ?? p.role}
                    {p.personInferred && (
                      <span
                        className="ml-1.5 rounded bg-accent px-1 py-0.5 text-[9px] font-medium tracking-wide text-muted-foreground uppercase"
                        title="Nama disimpulkan dari pola email (firstname.lastname@) — belum terverifikasi"
                      >
                        inferred
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.companyName}</p>
                </div>
                <span className="shrink-0 rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                  {p.role}
                </span>
              </div>

              <p className="truncate font-mono text-xs text-emerald-700 dark:text-emerald-300" title={p.hrEmail}>
                {p.hrEmail}
              </p>

              {p.company?.website && (
                <a
                  href={p.company.website.startsWith("http") ? p.company.website : `https://${p.company.website}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground/90"
                >
                  <Globe className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.company.website.replace(/^https?:\/\//, "")}</span>
                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                </a>
              )}

              {p.sampleJobs.length > 0 && (
                <div className="min-w-0 space-y-0.5">
                  {p.sampleJobs.slice(0, 2).map((j) => (
                    <p key={j.id} className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate">{j.title}</span>
                    </p>
                  ))}
                  {p.jobCount > 2 && <p className="text-[10px] text-muted-foreground/70">+{p.jobCount - 2} lowongan lain via email ini</p>}
                </div>
              )}

              <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                <a
                  href={`mailto:${p.hrEmail}`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-500/20 dark:text-violet-300"
                >
                  <Mail className="h-3 w-3" /> Kirim email
                </a>
                <div className="flex items-center gap-1.5">
                  {p.emailSourceUrl && (
                    <a
                      href={p.emailSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground/90"
                    >
                      sumber
                    </a>
                  )}
                  <span className="text-[10px] text-muted-foreground/70">{timeAgo(p.lastSeen)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Halaman {data.page} dari {totalPages}
          </p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-7 border-border bg-card" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <Button variant="outline" size="sm" className="h-7 border-border bg-card" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

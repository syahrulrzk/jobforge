// ─────────────────────────────────────────────────────────────
// JOBFORCE — People Search via Internet (public LinkedIn profiles)
//
// Cari orang berdasarkan jabatan + perusahaan/lokasi/industri lewat
// mesin pencari (Bing / Google CSE / DDG) dengan query:
//
//     site:linkedin.com/in "IT Manager" "Bank Mandiri"
//     site:linkedin.com/in "HR Manager" "Jakarta"
//     site:linkedin.com/in "Head of IT" "perbankan"
//
// HANYA public profile yang ter-index search engine — TIDAK ada scraping
// linkedin.com langsung, tidak butuh login, tidak menyentuh LinkedIn API.
// Nama disimpulkan dari URL profil (/in/budi-santoso-a1b2c… → "Budi
// Santoso" — token ID angka/hex dibuang) dan headline dari snippet SERP;
// keduanya heuristik dan TIDAK dikarang melebihi yang tertulis.
//
// Semua fetch jalan lewat proxy pool yang sama dengan Cari Email
// (mode direct/auto/custom) — engine pencarian = searchWeb() milik
// email-finder, jadi dukungan Google CSE + fallback antar-mesin gratis.
// ─────────────────────────────────────────────────────────────
import { searchWeb, type SearchEngineKey } from "./email-finder";
import { getProxyPool, parseProxyMode, type ProxyMode } from "./proxy-pool";

export interface LinkedInPerson {
  /** nama dari path URL profil (heuristik, token ID dibuang) */
  name: string | null;
  /** headline dari snippet SERP — jabatan/perusahaan sering di sini */
  headline: string | null;
  company: string | null;
  location: string | null;
  linkedinUrl: string;
}

export interface PeopleSearchStep {
  engine: "PROXY" | "SEARCH" | "FILTER";
  status: "success" | "failed" | "skipped";
  durationMs: number;
  note: string;
}

export interface PeopleSearchResult {
  found: number;
  engine: string;
  steps: PeopleSearchStep[];
  results: LinkedInPerson[];
}

export interface PeopleSearchOptions {
  role?: string;
  company?: string;
  location?: string;
  industry?: string;
  /** mesin pencari — default "auto" (CSE bila env ada → Bing) */
  engine?: SearchEngineKey;
  /** mode proxy: direct | auto | custom */
  proxyMode?: string | null;
  /** URL proxy custom (http://user:pass@host:port) */
  proxyUrl?: string | null;
  /** jumlah query paralel-ish (berurutan dengan jitter) — default semua */
}

const PROFILE_RE = /linkedin\.com\/in\//i;
const SLUG_RE = /linkedin\.com\/in\/([A-Za-z0-9_%\-.]{2,100})/i;

/** Bangun daftar query SERP dari kombinasi filter yang diisi user. */
function buildQueries(o: { role?: string; company?: string; location?: string; industry?: string }): string[] {
  const role = (o.role ?? "").trim();
  const company = (o.company ?? "").trim();
  const location = (o.location ?? "").trim();
  const industry = (o.industry ?? "").trim();
  const q: string[] = [];
  if (role && company) q.push(`site:linkedin.com/in "${role}" "${company}"`);
  if (role && location) q.push(`site:linkedin.com/in "${role}" "${location}"`);
  if (role && industry) q.push(`site:linkedin.com/in "${role}" "${industry}"`);
  if (!q.length && (role || company)) {
    q.push(`site:linkedin.com/in${role ? ` "${role}"` : ""}${company ? ` "${company}"` : ""}`);
  }
  if (!q.length) q.push('site:linkedin.com/in "manager"');
  return [...new Set(q)];
}

/** /in/budi-santoso-a1b2c3d4 → "Budi Santoso" (token ID angka/hex dibuang). */
function nameFromProfileUrl(url: URL): string | null {
  const m = url.pathname.match(/^\/in\/([^/]+)/i);
  if (!m) return null;
  let raw = m[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* biarkan apa adanya */
  }
  const words = raw
    .replace(/[%_.]+/g, "-")
    .split("-")
    .filter(Boolean)
    // buang token ID: angka murni atau hex-like ≥6 char yang campur huruf+angka (a1b2c3, 8a12345)
    .filter((w) => !/^\d+$/.test(w) && !(w.length >= 6 && /\d/.test(w) && /[a-z]/i.test(w)))
    .filter((w) => /^[a-z][a-z.'-]*$/i.test(w));
  if (!words.length) return null;
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ").trim();
  return name.length >= 3 ? name : null;
}

/** Ambil URL profil LinkedIn dari sebuah hit SERP (null bila bukan profil). */
function profileUrlFromHit(hitUrl: string): URL | null {
  try {
    const u = new URL(hitUrl);
    if (!/linkedin\./i.test(u.hostname)) return null;
    if (!SLUG_RE.test(hitUrl)) return null;
    // buang query tracking
    u.search = "";
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

/** Perbaiki kapitalisasi token query di snippet — "it manager" → "IT Manager". */
function fixTokenCase(text: string, tokens: (string | undefined)[]): string {
  let out = text.replace(/\s+/g, " ").trim();
  for (const t of tokens) {
    const token = (t ?? "").trim();
    if (token.length < 3) continue;
    const re = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "ig");
    out = out.replace(re, token);
  }
  return out;
}

/** Token huruf/angka panjang ≥ min — untuk filter relevansi. */
function tokenList(s: string | null | undefined, min = 2): string[] {
  return (s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= min);
}

export async function searchPeopleOnInternet(opts: PeopleSearchOptions): Promise<PeopleSearchResult> {
  const role = (opts.role ?? "").trim();
  const company = (opts.company ?? "").trim();
  const location = (opts.location ?? "").trim();
  const industry = (opts.industry ?? "").trim();
  const steps: PeopleSearchStep[] = [];
  const tokensForCase = [role, company, location, industry];

  // ── step PROXY ──────────────────────────────────────────────
  const mode: ProxyMode = parseProxyMode(opts.proxyMode);
  let proxyPool: Awaited<ReturnType<typeof getProxyPool>> | null = null;
  const tProxy = Date.now();
  try {
    proxyPool = await getProxyPool(mode, opts.proxyUrl);
  } catch {
    proxyPool = { mode, urls: [], note: "pool proxy gagal dibuat — fallback langsung" };
  }
  if (mode !== "direct") {
    steps.push({
      engine: "PROXY",
      status: proxyPool.urls.length > 0 ? "success" : "failed",
      durationMs: Date.now() - tProxy,
      note: proxyPool.urls.length > 0 ? `${proxyPool.note} — ${proxyPool.urls.length} proxy siap` : `${proxyPool.note}`,
    });
  }

  // ── step SEARCH — mesin dipilih: CSE bila env ada (auto), selain itu chain searchWeb ──
  let preferred = opts.engine ?? "auto";
  if (preferred === "auto" && !(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX)) {
    preferred = "bing"; // DDG sering keblokir dari IP server/proxy gratis — Bing paling stabil
  }
  const queries = buildQueries({ role, company, location, industry });
  const tSearch = Date.now();
  let allHits: { url: string; snippet: string }[] = [];
  let engineUsed = "none";
  for (const q of queries) {
    let res = await searchWeb(q, preferred, proxyPool);
    if (res.engine === "none" && preferred !== "bing") res = await searchWeb(q, "bing", proxyPool);
    if (res.engine !== "none") engineUsed = res.engine;
    allHits = allHits.concat(res.hits);
  }
  const serpProfiles = allHits.filter((h) => SLUG_RE.test(h.url));
  steps.push({
    engine: "SEARCH",
    status: serpProfiles.length > 0 ? "success" : "failed",
    durationMs: Date.now() - tSearch,
    note: `${engineUsed} · ${queries.length} query "${queries[0]}${queries.length > 1 ? " …" : ""}" → ${allHits.length} hasil SERP (${serpProfiles.length} profil LinkedIn)`,
  });

  // ── step FILTER — parse + dedup + relevansi ─────────────────
  const tFilter = Date.now();
  const bySlug = new Map<string, LinkedInPerson>();
  for (const hit of serpProfiles) {
    const u = profileUrlFromHit(hit.url);
    if (!u) continue;
    const slugMatch = u.pathname.match(/^\/in\/([^/]+)/i);
    const slug = (slugMatch?.[1] ?? "").toLowerCase();
    if (!slug || /^(pub|dir|title)$/i.test(slug)) continue;

    const snippet = hit.snippet.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const name = nameFromProfileUrl(u);
    // headline: snippet yang sudah dirapikan — sering "… - Jabatan di Perusahaan"
    let headline: string | null = fixTokenCase(snippet, tokensForCase);
    if (headline.length > 140) headline = headline.slice(0, 140).replace(/\s+\S*$/, "") + "…";
    headline = headline.length >= 4 ? headline : null;

    const existing = bySlug.get(slug);
    if (existing) {
      if (!existing.name && name) existing.name = name;
      if (!existing.headline && headline) existing.headline = headline;
      continue;
    }
    bySlug.set(slug, {
      name,
      headline,
      company: company || null,
      location: location || null,
      linkedinUrl: `https://www.linkedin.com/in/${slug}`,
    });
  }

  // relevansi: token jabatan wajib ada (slug/headline); konteks
  // perusahaan/lokasi/industri — minimal SATU grup cocok (jangan over-filter)
  const roleTokens = tokenList(role, 2);
  const ctxGroups = [tokenList(company, 3), tokenList(location, 3), tokenList(industry, 3)].filter((g) => g.length > 0);
  let droppedByRole = 0;
  let droppedByContext = 0;
  let results = [...bySlug.values()].filter((p) => {
    const hay = `${p.linkedinUrl} ${p.headline ?? ""}`.toLowerCase();
    if (roleTokens.length && !roleTokens.every((t) => hay.includes(t))) {
      droppedByRole++;
      return false;
    }
    if (ctxGroups.length) {
      const ok = ctxGroups.some((g) => g.some((t) => hay.includes(t)));
      if (!ok) {
        droppedByContext++;
        return false;
      }
    }
    return true;
  });

  // konteks (perusahaan/lokasi/industri) tidak selalu tertulis di snippet —
  // bila filter terlalu ketat sampai kosong, longgarkan ke SEMUA profil unik
  if (!results.length && bySlug.size) {
    results = [...bySlug.values()];
    droppedByRole = 0;
    droppedByContext = 0;
  }

  steps.push({
    engine: "FILTER",
    status: results.length > 0 ? "success" : "failed",
    durationMs: Date.now() - tFilter,
    note: `${serpProfiles.length} profil → ${bySlug.size} unik → ${results.length} relevan${droppedByRole ? ` (${droppedByRole} gak cocok jabatan)` : ""}${droppedByContext ? ` (${droppedByContext} gak cocok konteks)` : ""}`,
  });

  return { found: results.length, engine: engineUsed, steps, results };
}

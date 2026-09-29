// ─────────────────────────────────────────────────────────────
// JOBFORCE — Email Finder Engine (Tools · Cari Email)
//
// Rantai pencarian email HR/karir dari INTERNET untuk satu perusahaan:
//
//   step 1  DB       — email yang sudah ada di JobContact (instan)
//   step 2  WEBSITE  — website perusahaan: homepage → halaman karir →
//                      kontak → browser fallback (§12 chain, findCompanyHrEmail)
//   step 3  SEARCH   — mesin pencari web: query
//                      "email <company> (HR | karir | recruitment | careers)"
//                      → ekstrak email ter-publish dari SERP + crawl
//                      top hasil yang masih satu domain (anti-bot ringan:
//                      UA browser, timeout ketat, jitter antar request).
//                      Publik board (LinkedIn dkk.) sering muncul di SERP
//                      — email yang diambil tetap HANYA yang benar-benar
//                      ter-publish di halaman (tidak ada yang ditebak §12.4).
//
// Semua langkah mengembalikan langkah proses transparan agar UI bisa
// menampilkan seperti console engine ("step/badge/status/duration/note").
// ─────────────────────────────────────────────────────────────
import { extractDomain, resolveDomainFromName } from "./logo";
import { BROWSER_UA } from "./net";
import type { ProxyAgent } from "undici";
import { evictProxy, getProxyPool, isProxyFailStatus, pickProxy, PROXY_ATTEMPT_TIMEOUT_MS, proxyAgentFor, type ProxyMode, type ProxyPool } from "./proxy-pool";

/** Mesin pencari yang bisa dipilih user di halaman Cari Email. */
export type SearchEngineKey = "auto" | "duckduckgo" | "bing" | "google-cse";

export const SEARCH_ENGINES: { key: SearchEngineKey; label: string; hint: string }[] = [
  { key: "auto", label: "Auto", hint: "DuckDuckGo → Bing, mesin pertama yang jawab menang" },
  { key: "duckduckgo", label: "DuckDuckGo", hint: "HTML endpoint tanpa API key — sering diblok dari IP datacenter" },
  { key: "bing", label: "Bing", hint: "Tanpa API key — paling stabil dari server (terukur di sandbox)" },
  { key: "google-cse", label: "Google CSE", hint: "Butuh GOOGLE_CSE_KEY + GOOGLE_CSE_CX di env — kualitas hasil terbaik" },
];

export function parseSearchEngine(value: string | null | undefined): SearchEngineKey {
  const v = (value ?? "").trim().toLowerCase();
  return (SEARCH_ENGINES.some((e) => e.key === v) ? v : "auto") as SearchEngineKey;
}

export interface FinderStep {
  engine: "DB" | "WEBSITE" | "SEARCH" | "LINKEDIN" | "BBOT" | "HOLEHE" | "OCR" | "PROXY";
  status: "success" | "failed" | "skipped";
  durationMs: number;
  note: string;
}

export interface FoundEmail {
  email: string;
  /** bukti: halaman tempat email ter-publish */
  sourceUrl: string;
  /** dari mana email ditemukan */
  via: string;
  /** nama orang bila pola email jelas nama (firstname.lastname@) */
  personName: string | null;
  personInferred: boolean;
  /** jabatan bila prefix email jelas rekrutmen (hr@, talent@, …) */
  role: string | null;
}

export interface EmailFinderResult {
  found: boolean;
  email: FoundEmail | null;
  candidates: FoundEmail[];
  steps: FinderStep[];
  durationMs: number;
  /** hasil holehe untuk email terbaik (verifikasi keberadaan) */
  verified?: { exists: boolean; usedOn: string[]; note: string };
}

/** Opsi orchestrator — tools eksternal opt-in (lebih lambat tapi lebih kuat). */
export interface EmailFinderOptions {
  searchEngine?: SearchEngineKey;
  /** jalankan BBOT email-enum + OCR screenshot + verifikasi holehe */
  useExternalTools?: boolean;
  /** proxy: "direct" (default) | "auto" (pool gratis) | "custom" (URL operator) */
  proxyMode?: ProxyMode;
  /** URL proxy untuk proxyMode "custom" — http://[user:pass@]host:port */
  proxyUrl?: string | null;
}

const FETCH_TIMEOUT_MS = 9_000;
const CHALLENGE_RE = /just a moment|attention required|access denied|captcha|checking your browser/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_BLACKLIST =
  /noreply|no-reply|donotreply|example\.(com|org)|\.png|\.jpg|\.jpeg|\.webp|\.gif|sentry\.io|wixpress|abuse@|postmaster@|dmarc|privacy@|linkedin\.com|licdn\.com/i;
/** Prefix jelas rekrutmen — sinyal jabatan HR. */
const PREFIX_ROLE_RE =
  /^(hr|hrd|career|careers|karir|karier|recruitment|recruit|rekrutmen|talent|jobs|loker|lowongan|people)[.\-_]/i;
const ROLE_FROM_PREFIX: Record<string, string> = {
  hr: "HR",
  hrd: "HRD",
  career: "Careers",
  careers: "Careers",
  karir: "Karir",
  karier: "Karir",
  recruitment: "Recruitment",
  recruit: "Recruitment",
  rekrutmen: "Rekrutmen",
  talent: "Talent Acquisition",
  jobs: "Jobs",
  job: "Jobs",
  loker: "Loker",
  lowongan: "Lowongan",
  people: "People Ops",
};

function jitter(min: number, max: number): Promise<void> {
  return new Promise((r) => setTimeout(r, min + Math.floor(Math.random() * (max - min))));
}

async function fetchPage(url: string, proxyPool?: ProxyPool | null): Promise<{ ok: boolean; status: number; text: string }> {
  const chosen = pickProxy(proxyPool);
  const agent = proxyAgentFor(chosen);
  // percobaan 1 lewat proxy (bila ada); gagal → buang proxy-nya dari pool +
  // percobaan 2 langsung — mode proxy tidak pernah lebih buruk dari direct
  const attempts: (ProxyAgent | undefined)[] = agent ? [agent, undefined] : [undefined];
  for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
    const useAgent = attempts[attemptIdx];
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(useAgent ? PROXY_ATTEMPT_TIMEOUT_MS : FETCH_TIMEOUT_MS),
        redirect: "follow",
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        },
        cache: "no-store",
        ...(useAgent ? { dispatcher: useAgent } : {}),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !ct.includes("html")) {
        if (useAgent) {
          if (isProxyFailStatus(res.status)) evictProxy(chosen);
          continue; // via proxy gagal → coba langsung
        }
        return { ok: false, status: res.status, text: "" };
      }
      return { ok: true, status: res.status, text: (await res.text()).slice(0, 400_000) };
    } catch {
      if (useAgent) {
        evictProxy(chosen);
        continue;
      }
      return { ok: false, status: 0, text: "" };
    }
  }
  return { ok: false, status: 0, text: "" };
}

/** Khusus untuk API JSON (Google CSE, dll) — tidak filter by content-type */
async function fetchJson(url: string, proxyPool?: ProxyPool | null): Promise<{ ok: boolean; status: number; text: string }> {
  const chosen = pickProxy(proxyPool);
  const agent = proxyAgentFor(chosen);
  const attempts: (ProxyAgent | undefined)[] = agent ? [agent, undefined] : [undefined];
  for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
    const useAgent = attempts[attemptIdx];
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(useAgent ? PROXY_ATTEMPT_TIMEOUT_MS : FETCH_TIMEOUT_MS),
        redirect: "follow",
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "application/json,*/*;q=0.8",
        },
        cache: "no-store",
        ...(useAgent ? { dispatcher: useAgent } : {}),
      });
      if (!res.ok) {
        if (useAgent) {
          if (isProxyFailStatus(res.status)) evictProxy(chosen);
          continue;
        }
        return { ok: false, status: res.status, text: "" };
      }
      return { ok: true, status: res.status, text: (await res.text()).slice(0, 400_000) };
    } catch {
      if (useAgent) {
        evictProxy(chosen);
 continue;
      }
      return { ok: false, status: 0, text: "" };
    }
  }
  return { ok: false, status: 0, text: "" };
}

/** Ekstrak email dari HTML mentah — blacklist ketat, prioritas prefix rekrutmen. */
export function extractPublishedEmails(html: string): string[] {
  const all = [...new Set((html.match(EMAIL_RE) ?? []).map((e) => e.trim().toLowerCase()))];
  return all
    .filter((e) => !EMAIL_BLACKLIST.test(e))
    .sort((a, b) => Number(PREFIX_ROLE_RE.test(b.split("@")[0])) - Number(PREFIX_ROLE_RE.test(a.split("@")[0])));
}

function classifyEmail(email: string): Omit<FoundEmail, "email" | "sourceUrl" | "via"> {
  const local = email.split("@")[0] ?? "";
  const prefixMatch = local.match(PREFIX_ROLE_RE);
  let role: string | null = null;
  if (prefixMatch) {
    const key = local.toLowerCase().split(/[.\-_]/)[0];
    role = ROLE_FROM_PREFIX[key] ?? null;
  }
  if (!role && PREFIX_ROLE_RE.test(local)) role = "Rekrutmen";
  // nama pribadi bila pola email jelas nama dan bukan prefix role
  let personName: string | null = null;
  if (!prefixMatch) {
    const parts = local.split(/[._\-]/).filter((p) => /^[a-z]{2,}$/i.test(p));
    if (parts.length >= 2) {
      personName = parts
        .slice(0, 2)
        .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
        .join(" ");
    }
  }
  return { personName, personInferred: !!personName, role };
}

function makeFound(email: string, sourceUrl: string, via: string): FoundEmail {
  return { email, sourceUrl, via, ...classifyEmail(email) };
}

// ── Step 2: WEBSITE — delegasi ke chain §12 yang sudah terbukti ─
async function tryWebsite(companyName: string, domain: string | null, proxyPool?: ProxyPool | null): Promise<{ email: FoundEmail | null; note: string }> {
  const { findCompanyHrEmail } = await import("./company-email");
  const result = await findCompanyHrEmail(companyName, domain ? `https://${domain}` : null, proxyPool);
  if (!result) return { email: null, note: "tidak ada email karir/HR ter-publish di website (homepage, karir, kontak)" };
  return { email: makeFound(result.email, result.sourceUrl, `website · ${result.tier} (${result.via})`), note: `ketemu via ${result.tier}` };
}

// ── Step 3: SEARCH — mesin pencari web + crawl hasil ────────────
// DuckDuckGo HTML endpoint (html.duckduckgo.com) — tanpa API key,
// hasil SERP stabil untuk parsing. Bing sebagai cadangan.

interface SearchHit {
  url: string;
  snippet: string;
}

export async function searchWeb(
  query: string,
  preferred: SearchEngineKey = "auto",
  proxyPool?: ProxyPool | null,
): Promise<{ hits: SearchHit[]; engine: string }> {
  // urutan mesin sesuai preferensi: engine spesifik dicoba dulu, lalu fallback;
  // "auto" = urutan default DDG → Bing
  const chain: SearchEngineKey[] =
    preferred === "auto"
      ? (["duckduckgo", "bing"] as SearchEngineKey[])
      : ([
          preferred,
          ...(preferred === "duckduckgo" ? (["bing"] as SearchEngineKey[]) : preferred === "bing" ? (["duckduckgo"] as SearchEngineKey[]) : []),
        ] as SearchEngineKey[]);

  for (const engine of chain) {
    // 1) DuckDuckGo HTML
    if (engine === "duckduckgo") {
      try {
        await jitter(300, 900);
        const res = await fetchPage(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, proxyPool);
        if (res.ok && !CHALLENGE_RE.test(res.text.slice(0, 3_000))) {
          const hits: SearchHit[] = [];
          const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
          const snipRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]{0,400}?)<\/a>/gi;
          const urls: string[] = [];
          let m: RegExpExecArray | null;
          while ((m = linkRe.exec(res.text)) && urls.length < 8) {
            let href = m[1];
            // DDG pakai redirect //duckduckgo.com/l/?uddg=<encoded>
            const uddg = href.match(/[?&]uddg=([^&]+)/);
            if (uddg) href = decodeURIComponent(uddg[1]);
            try {
              const u = new URL(href);
              if (/^https?:$/.test(u.protocol)) urls.push(u.toString());
            } catch {
              /* skip */
            }
          }
          const snippets: string[] = [];
          while ((m = snipRe.exec(res.text)) && snippets.length < 8) {
            snippets.push(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
          }
          for (let i = 0; i < urls.length; i++) hits.push({ url: urls[i], snippet: snippets[i] ?? "" });
          if (hits.length > 0) return { hits, engine: `duckduckgo${proxyPool && proxyPool.urls.length > 0 ? "+proxy" : ""}` };
        }
      } catch {
        /* lanjut ke mesin berikutnya */
      }
    }

    // 2) Bing — URL hasil = redirect /ck/a?…&u=a1<base64url>
    if (engine === "bing") {
      try {
        await jitter(300, 900);
        const res = await fetchPage(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=id`, proxyPool);
        if (res.ok) {
          const hits: SearchHit[] = [];
          const re = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
          let m: RegExpExecArray | null;
          while ((m = re.exec(res.text)) && hits.length < 8) {
            const real = decodeBingRedirect(m[1]);
            if (real) hits.push({ url: real, snippet: stripTags(m[2]) });
          }
          if (hits.length > 0) return { hits, engine: `bing${proxyPool && proxyPool.urls.length > 0 ? "+proxy" : ""}` };
        }
      } catch {
        /* lanjut ke mesin berikutnya */
      }
    }

    // 3) Google Programmable Search (CSE) JSON API — butuh env key + cx
    if (engine === "google-cse") {
      const key = process.env.GOOGLE_CSE_KEY ?? "";
      const cx = process.env.GOOGLE_CSE_CX ?? "";
      if (key && cx) {
        try {
          const sp = new URLSearchParams({ key, cx, q: query, num: "8" });
          // Gunakan fetchJson bukan fetchPage — CSE return JSON bukan HTML
          const res = await fetchJson(`https://www.googleapis.com/customsearch/v1?${sp.toString()}`, proxyPool);
          if (res.ok) {
            try {
              const json = JSON.parse(res.text) as {
                items?: { link?: string; title?: string; snippet?: string }[];
                error?: { message?: string };
              };
              if (json.error?.message) {
                console.error(`[CSE] API error: ${json.error.message}`);
              }
              const hits: SearchHit[] = (json.items ?? [])
                .filter((it) => it.link && /^https?:\/\//.test(it.link))
                .map((it) => ({ url: it.link!, snippet: `${it.title ?? ""} ${it.snippet ?? ""}` }));
              if (hits.length > 0) return { hits, engine: "google-cse" };
            } catch {
              /* JSON rusak → mesin berikutnya */
            }
          }
        } catch {
          /* lanjut ke mesin berikutnya */
        }
      }
    }
  }
  return { hits: [], engine: "none" };
}

/** Bing redirect /ck/a?…&u=a1<base64url-of-target> → URL asli. */
function decodeBingRedirect(href: string): string | null {
  try {
    if (!href.includes("bing.com/ck/") && !href.includes("bing.com/ck")) {
      return /^https?:\/\//.test(href) ? href : null;
    }
    const u = new URL(href.replace(/&amp;/g, "&"), "https://www.bing.com");
    const encoded = u.searchParams.get("u");
    if (!encoded) return null;
    const b64 = encoded.replace(/^a1/, "").replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    return /^https?:\/\/\S+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ── Step 3.5: LINKEDIN — cari email lewat profil/overview publik ────
// LinkedIn loginwall memblokir HTML anonim, TAPI:
//   1. SERP (Bing/DDG/Google CSE) mengindeks company overview + job post
//      LinkedIn — snippet-nya kadang memuat email ter-publish
//   2. Halaman publik (company/about + post lowongan) masih bisa dibuka
//      anonim sebagian — email di meta description/JSON-LD terbaca
//   3. Konten yang dirender sebagai gambar → tesseract OCR (Mode OSINT)
async function tryLinkedin(
  companyName: string,
  domain: string | null,
  proxyPool?: ProxyPool | null,
): Promise<{ candidates: FoundEmail[]; note: string }> {
  const candidates: FoundEmail[] = [];
  const seen = new Set<string>();
  const push = (email: string, url: string, via: string) => {
    const e = email.trim().toLowerCase();
    if (e && !seen.has(e) && !EMAIL_BLACKLIST.test(e)) {
      seen.add(e);
      candidates.push(makeFound(e, url, via));
    }
  };

  // 1) SERP terbatas LinkedIn — pakai mesin pilihan user (fallback bing)
  const queries = [
    `site:linkedin.com "${companyName}" (email OR "send me an email" OR kontak) HR`,
    domain ? `site:linkedin.com "${domain}" email` : `site:linkedin.com "${companyName}" recruitment email`,
  ];
  let pagesCrawled = 0;
  for (const q of queries) {
    const { hits, engine } = await searchWeb(q, "bing", proxyPool);
    // email dari snippet SERP — sering muncul di meta description hasil LinkedIn
    for (const h of hits) {
      for (const email of extractPublishedEmails(h.snippet)) push(email, h.url, `linkedin · ${engine} (SERP)`);
    }
    // 2) crawl halaman LinkedIn publik dari hasil (about/company/post)
    for (const hit of hits.filter((h) => /linkedin\.com/i.test(h.url)).slice(0, 3)) {
      pagesCrawled++;
      const page = await fetchPage(hit.url, proxyPool);
      if (!page.ok) continue;
      // meta description + JSON-LD + og:description sering lolos loginwall
      const metaBits = [
        ...(page.text.match(/<meta[^>]+(?:name|property)="(?:description|og:description|twitter:description)"[^>]+content="([^"]+)"/gi) ?? []),
      ];
      const metaText = metaBits.join(" ") + " " + stripTags(page.text.slice(0, 200_000));
      for (const email of extractPublishedEmails(metaText)) push(email, hit.url, `linkedin · ${engine} (halaman publik)`);
      await jitter(500, 1_200);
    }
    if (candidates.length > 0) break;
  }

  if (candidates.length === 0) {
    return {
      candidates,
      note: `LinkedIn: ${pagesCrawled} halaman publik + SERP di-scan — email biasanya tidak di-publish di profil (loginwall); job post LinkedIn di-handle pipeline scrape`,
    };
  }
  return { candidates, note: `${candidates.length} kandidat dari LinkedIn (SERP + halaman publik)` };
}

// ── Step 3: SEARCH — mesin pencari web + crawl hasil ────────────
async function trySearch(
  companyName: string,
  domain: string | null,
  preferred: SearchEngineKey,
  proxyPool?: ProxyPool | null,
): Promise<{ email: FoundEmail | null; candidates: FoundEmail[]; note: string }> {
  const base = domain ?? (await resolveDomainFromName(companyName));
  const queries = [
    `"${companyName}" email HR karir`,
    base ? `site:${base} email (HR | karir | careers | recruitment)` : `"${companyName}" (email karir OR recruitment OR careers)`,
    `"${companyName}" "@${base}" rekrutmen`,
  ];
  const candidates: FoundEmail[] = [];
  const seen = new Set<string>();
  let engineUsed = "none";
  let pagesCrawled = 0;

  for (const q of queries) {
    const { hits, engine } = await searchWeb(q, preferred, proxyPool);
    if (engine !== "none") engineUsed = engine;
    // 1) email langsung dari SERP (snippet + query echo)
    for (const h of hits) {
      for (const email of extractPublishedEmails(h.snippet)) {
        if (!seen.has(email)) {
          seen.add(email);
          candidates.push(makeFound(email, h.url, `search · ${engineUsed} (SERP)`));
        }
      }
    }
    // 2) crawl top 4 hasil — utamakan yang masih satu domain perusahaan
    const prioritized = [...hits].sort((a, b) => {
      const aIn = base && a.url.includes(base) ? 0 : 1;
      const bIn = base && b.url.includes(base) ? 0 : 1;
      return aIn - bIn;
    });
    for (const hit of prioritized.slice(0, 4)) {
      if (pagesCrawled >= 4) break;
      pagesCrawled++;
      const page = await fetchPage(hit.url, proxyPool);
      if (!page.ok) continue;
      const emails = extractPublishedEmails(page.text);
      const domainEmails = base ? emails.filter((e) => e.endsWith(`@${base}`)) : emails;
      const pool = domainEmails.length > 0 ? domainEmails : emails;
      for (const email of pool) {
        if (!seen.has(email)) {
          seen.add(email);
          candidates.push(makeFound(email, hit.url, `search · ${engineUsed} (crawl)`));
        }
      }
      await jitter(400, 1_100); // anti-bot ringan antar halaman
    }
    if (candidates.length > 0) break; // cukup — hentikan query berikutnya
  }

  if (candidates.length === 0) {
    return { email: null, candidates: [], note: `search (${engineUsed}) tidak menemukan email ter-publish setelah ${pagesCrawled} halaman` };
  }
  // kandidat terbaik: prefix role > domain perusahaan > lainnya
  const best = candidates[0];
  return { email: best, candidates, note: `${candidates.length} kandidat via ${engineUsed} (${pagesCrawled} halaman di-crawl)` };
}

// ── Orchestrator ────────────────────────────────────────────────────────────────
export async function findEmailFromInternet(
  companyName: string,
  knownWebsite?: string | null,
  searchEngine: SearchEngineKey = "auto",
  useExternalTools = false,
  opts: EmailFinderOptions = {},
): Promise<EmailFinderResult> {
  const started = Date.now();
  const steps: FinderStep[] = [];
  const domain = extractDomain(knownWebsite) ?? (await resolveDomainFromName(companyName));

  // step 1 — PROXY: siapkan jalur keluar (mode auto → pool gratis tervalidasi;
  // custom → URL operator; direct → tanpa proxy). Gagal pool ≠ gagal fitur.
  const proxyMode: ProxyMode = opts.proxyMode ?? "direct";
  const poolStarted = Date.now();
  const proxyPool = await getProxyPool(proxyMode, opts.proxyUrl ?? null);
  steps.push({
    engine: "PROXY",
    status: proxyPool.urls.length > 0 ? "success" : proxyMode === "direct" ? "skipped" : "failed",
    durationMs: Date.now() - poolStarted,
    note: proxyPool.note,
  });
  const allCandidates: FoundEmail[] = [];
  const seen = new Set<string>();
  const pushCandidate = (c: FoundEmail | null | undefined) => {
    if (c && !seen.has(c.email)) {
      seen.add(c.email);
      allCandidates.push(c);
    }
  };

  // step 2 — WEBSITE
  const webStarted = Date.now();
  const web = await tryWebsite(companyName, domain, proxyPool);
  pushCandidate(web.email);
  steps.push({ engine: "WEBSITE", status: web.email ? "success" : "failed", durationMs: Date.now() - webStarted, note: web.note });

  // step 3 — SEARCH ENGINE (selalu jalan bila website gagal; kalau sukses, skip)
  let searchResult: Awaited<ReturnType<typeof trySearch>> | null = null;
  if (!web.email) {
    const sStarted = Date.now();
    searchResult = await trySearch(companyName, domain, searchEngine, proxyPool);
    for (const c of searchResult.candidates) pushCandidate(c);
    steps.push({
      engine: "SEARCH",
      status: searchResult.email ? "success" : "failed",
      durationMs: Date.now() - sStarted,
      note: searchResult.note,
    });
  } else {
    steps.push({ engine: "SEARCH", status: "skipped", durationMs: 0, note: "email sudah ditemukan di website" });
  }

  // step 3.5 — LINKEDIN: search engine dengan site:linkedin.com + crawl halaman publik
  if (!web.email) {
    const liStarted = Date.now();
    const li = await tryLinkedin(companyName, domain, proxyPool);
    for (const c of li.candidates) pushCandidate(c);
    steps.push({
      engine: "LINKEDIN",
      status: li.candidates.length > 0 ? "success" : "failed",
      durationMs: Date.now() - liStarted,
      note: li.note,
    });
  } else {
    steps.push({ engine: "LINKEDIN", status: "skipped", durationMs: 0, note: "email sudah ditemukan di website" });
  }

  // step 4 — TOOLS EKSTERNAL (opt-in): BBOT email-enum + tesseract OCR
  if (useExternalTools && domain) {
    const { bbotEmailEnum, ocrPageForEmails } = await import("./external-email-tools");

    // BBOT — modul pasif email-enum (emailformat, skymem, newsletters, pgp)
    const bbot = await bbotEmailEnum(domain);
    for (const e of bbot.emails) pushCandidate(makeFound(e.email, `https://${domain}`, `bbot · ${e.source}`));
    steps.push({
      engine: "BBOT",
      status: bbot.emails.length > 0 ? "success" : "failed",
      durationMs: bbot.durationMs,
      note: bbot.note,
    });

    // OCR — screenshot halaman; kontak yang dirender sebagai gambar tetap kebaca
    // (browser ikut lewat proxy bila pool aktif — biar lolos blokir IP)
    const ocr = await ocrPageForEmails(`https://${domain}`, 6_000, pickProxy(proxyPool) ?? undefined);
    for (const e of ocr.emails) pushCandidate(makeFound(e, `https://${domain}`, "ocr · tesseract (gambar halaman)"));
    steps.push({
      engine: "OCR",
      status: ocr.emails.length > 0 ? "success" : "failed",
      durationMs: ocr.durationMs,
      note: ocr.note,
    });
  } else if (useExternalTools) {
    steps.push({ engine: "BBOT", status: "skipped", durationMs: 0, note: "domain tidak diketahui — BBOT butuh domain" });
    steps.push({ engine: "OCR", status: "skipped", durationMs: 0, note: "domain tidak diketahui — OCR butuh URL" });
  }

  // pilih kandidat terbaik: prefix rekrutmen > domain perusahaan > asal (website/ocr)
  const base = domain ?? "";
  const ranked = [...allCandidates].sort((a, b) => {
    const score = (c: FoundEmail) =>
      (c.role ? 100 : 0) +
      (base && c.email.endsWith(`@${base}`) ? 50 : 0) +
      (c.via.startsWith("website") ? 30 : 0) +
      (c.via.startsWith("ocr") ? 20 : 0);
    return score(b) - score(a);
  });
  const email = ranked[0] ?? null;

  // step 5 — HOLEHE verifikasi (opt-in): email terbaik terdaftar di layanan nyata?
  let verified: EmailFinderResult["verified"];
  if (useExternalTools && email) {
    const { holeheVerify } = await import("./external-email-tools");
    const hStarted = Date.now();
    const h = await holeheVerify(email.email);
    verified = { exists: h.exists, usedOn: h.usedOn, note: h.note };
    steps.push({ engine: "HOLEHE", status: "success", durationMs: h.durationMs, note: h.note });
  }

  return {
    found: !!email,
    email,
    candidates: ranked,
    steps,
    durationMs: Date.now() - started,
    verified,
  };
}

// ─────────────────────────────────────────────────────────────
// JOBFORCE — Domain Email Harvest (Tools · Cari Email · mode Harvest)
//
// Ala hunter.io: kumpulkan SEMUA email publik untuk satu domain —
// info@, support@, sales@, billing@, sampai personal firstname@ —
// bukan cuma HR. Sumber:
//
//   1. DEEP CRAWL situs perusahaan (BFS sampai 25 halaman: homepage,
//      /contact /about /team /support /legal /privacy /karir …)
//   2. SEARCH ENGINE @domain ("@tokopedia.com" email) — hasil SERP
//      + crawl top hits (directori, forum, PDF, repo publik)
//   3. BBOT email-enum (opsional, Mode OSINT) — emailformat, skymem,
//      newsletters, pgp
//
// Setiap email dicatat dengan sumber + halaman asal + klasifikasi.
// HANYA email yang benar-benar ter-publish — tidak ada yang dikonstruksi
// atau ditebak (§12.4). Pola name@domain TIDAK dibuat-buat.
// ─────────────────────────────────────────────────────────────
import { extractPublishedEmails, searchWeb, type SearchEngineKey } from "./email-finder";
import { resolveDomainFromName } from "./logo";
import { BROWSER_UA } from "./net";
import type { ProxyAgent } from "undici";
import { evictProxy, getProxyPool, isProxyFailStatus, pickProxy, PROXY_ATTEMPT_TIMEOUT_MS, proxyAgentFor, type ProxyMode, type ProxyPool } from "./proxy-pool";

export interface HarvestedEmail {
  email: string;
  /** klasifikasi sederhana */
  kind: "role" | "personal" | "unknown";
  /** kategori role bila prefix jelas (info, support, hr, …) */
  category: string | null;
  /** halaman pertama tempat email terlihat */
  sourceUrl: string;
  /** dari mana: crawl | search | bbot */
  via: string;
  /** halaman lain yang juga memuat email ini */
  sources: string[];
}

export interface HarvestStep {
  source: "CRAWL" | "SEARCH" | "BBOT" | "PROXY";
  status: "success" | "failed";
  durationMs: number;
  note: string;
}

export interface HarvestResult {
  domain: string;
  emails: HarvestedEmail[];
  pagesCrawled: number;
  steps: HarvestStep[];
  durationMs: number;
}

const CRAWL_TIMEOUT_MS = 8_000;
const MAX_PAGES = 25;
const CHALLENGE_RE = /just a moment|attention required|access denied|captcha|checking your browser/i;

/** prefix email umum → kategori (non-HR juga dihitung — ini mode harvest) */
const CATEGORY_MAP: [RegExp, string][] = [
  [/^(info|contact|kontak|hello|hi|halo|admin|office|kantor)[.\-_@]/i, "Info/Kontak"],
  [/^(support|help|bantuan|cs|customerservice|customer[.\-_]?care|cs[.\-_]?care)[.\-_@]/i, "Support/CS"],
  [/^(sales|marketing|bisnis|business|partnership|partner|mitra|sales[.\-_]?marketing)[.\-_@]/i, "Sales/Marketing"],
  [/^(billing|finance|keuangan|accounting|invoice|payment)[.\-_@]/i, "Finance/Billing"],
  [/^(press|media|pr|publikasi)[.\-_@]/i, "Press/Media"],
  [/^(hr|hrd|personalia|kepegawaian|career|careers|karir|karier|recruitment|recruit|rekrutmen|talent|jobs|loker|lowongan|people)[.\-_@]/i, "HR/Rekrutmen"],
  [/^(legal|compliance|privacy|dpo|security|abuse|postmaster|webmaster|noc|it)[.\-_@]/i, "Legal/Teknis"],
  [/^(no[-_.]?reply|donotreply|noreply)[.\-_@]/i, "No-Reply"],
];

function classify(email: string): { kind: "role" | "personal" | "unknown"; category: string | null } {
  const local = email.split("@")[0] ?? "";
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(local + "@")) return { kind: "role", category: cat };
  }
  // pola nama pribadi: firstname / firstname.lastname / flastname
  const parts = local.split(/[._\-]/).filter((p) => /^[a-z]{2,}$/i.test(p));
  if (parts.length >= 2) return { kind: "personal", category: null };
  if (parts.length === 1 && parts[0].length >= 4) return { kind: "personal", category: null };
  return { kind: "unknown", category: null };
}

async function fetchPage(url: string, proxyPool?: ProxyPool | null): Promise<{ ok: boolean; text: string }> {
  const chosen = pickProxy(proxyPool);
  const agent = proxyAgentFor(chosen);
  // percobaan 1 lewat proxy (bila ada); gagal → buang proxy-nya + percobaan 2 langsung
  const attempts: (ProxyAgent | undefined)[] = agent ? [agent, undefined] : [undefined];
  for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
    const useAgent = attempts[attemptIdx];
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(useAgent ? PROXY_ATTEMPT_TIMEOUT_MS : CRAWL_TIMEOUT_MS),
        redirect: "follow",
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*;q=0.8", "Accept-Language": "id-ID,id;q=0.9,en;q=0.8" },
        cache: "no-store",
        ...(useAgent ? { dispatcher: useAgent } : {}),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !ct.includes("html")) {
        if (useAgent) {
          if (isProxyFailStatus(res.status)) evictProxy(chosen);
          continue;
        }
        return { ok: false, text: "" };
      }
      return { ok: true, text: (await res.text()).slice(0, 500_000) };
    } catch {
      if (useAgent) {
        evictProxy(chosen);
        continue;
      }
      return { ok: false, text: "" };
    }
  }
  return { ok: false, text: "" };
}

/** Halaman dalam satu domain — prioritas path yang biasanya berisi kontak. */
const PRIORITY_PATH_RE = /kontak|contact|about|tentang|tim|team|support|bantuan|help|legal|privacy|terms|karir|karier|career|lowongan|cabang|lokasi|location/i;

function extractInternalLinks(html: string, baseUrl: string, domain: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href\s*=\s*["']([^"'#]{3,200})["']/gi)) {
    let abs: string;
    try {
      abs = new URL(m[1].trim(), baseUrl).toString();
    } catch {
      continue;
    }
    let host: string;
    try {
      host = new URL(abs).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    const clean = abs.split("?")[0].split("#")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function jitter(min: number, max: number): Promise<void> {
  return new Promise((r) => setTimeout(r, min + Math.floor(Math.random() * (max - min))));
}

// ── 1. Deep crawl situs perusahaan ───────────────────────────────
async function crawlSite(
  domain: string,
  into: Map<string, HarvestedEmail>,
  proxyPool?: ProxyPool | null,
): Promise<{ pages: number; note: string }> {
  const origin = `https://${domain}`;
  const queue: string[] = [origin];
  const visited = new Set<string>();
  let pages = 0;

  while (queue.length > 0 && pages < MAX_PAGES) {
    // prioritas: path kontak/team/about duluan
    queue.sort((a, b) => Number(PRIORITY_PATH_RE.test(b)) - Number(PRIORITY_PATH_RE.test(a)));
    const url = queue.shift()!;
    const key = url.split("?")[0];
    if (visited.has(key)) continue;
    visited.add(key);

    const page = await fetchPage(url, proxyPool);
    if (!page.ok || CHALLENGE_RE.test(page.text.slice(0, 3_000))) continue;
    pages++;

    for (const email of extractPublishedEmails(page.text)) {
      const existing = into.get(email);
      if (existing) {
        if (!existing.sources.includes(key) && existing.sources.length < 5) existing.sources.push(key);
      } else {
        const { kind, category } = classify(email);
        into.set(email, { email, kind, category, sourceUrl: key, via: "crawl", sources: [key] });
      }
    }

    for (const link of extractInternalLinks(page.text, url, domain)) {
      if (!visited.has(link) && queue.length < 60) queue.push(link);
    }
    await jitter(150, 500);
  }
  return { pages, note: `${pages} halaman di-crawl dari ${domain}` };
}

// ── 2. Search engine @domain ─────────────────────────────────────
async function searchDomainEmails(
  domain: string,
  engine: SearchEngineKey,
  into: Map<string, HarvestedEmail>,
  proxyPool?: ProxyPool | null,
): Promise<{ crawled: number; note: string }> {
  const queries = [`"@${domain}"`, `"@${domain}" email kontak`, `site:${domain} mailto OR "@" email`];
  let crawled = 0;
  for (const q of queries) {
    const { hits, engine: used } = await searchWeb(q, engine, proxyPool);
    for (const h of hits) {
      for (const email of extractPublishedEmails(h.snippet)) {
        const existing = into.get(email);
        if (existing) {
          if (!existing.sources.includes(h.url) && existing.sources.length < 5) existing.sources.push(h.url);
        } else {
          const { kind, category } = classify(email);
          into.set(email, { email, kind, category, sourceUrl: h.url, via: "search", sources: [h.url] });
        }
      }
    }
    // crawl top hits non-domain (direktori/leaderboard/forum yang membahas domain)
    for (const hit of hits.slice(0, 5)) {
      if (crawled >= 8) break;
      crawled++;
      const page = await fetchPage(hit.url, proxyPool);
      if (!page.ok) continue;
      for (const email of extractPublishedEmails(page.text)) {
        // di halaman eksternal: hanya email domain target yang relevan
        if (!email.endsWith(`@${domain}`)) continue;
        const existing = into.get(email);
        if (existing) {
          if (!existing.sources.includes(hit.url) && existing.sources.length < 5) existing.sources.push(hit.url);
        } else {
          const { kind, category } = classify(email);
          into.set(email, { email, kind, category, sourceUrl: hit.url, via: "search", sources: [hit.url] });
        }
      }
      await jitter(300, 800);
    }
    if (into.size >= 3 && q !== queries[0]) break; // cukup — hemat query
  }
  return { crawled, note: `search @${domain}: ${crawled} halaman eksternal di-scan` };
}

// ── Orchestrator ─────────────────────────────────────────────────
export async function harvestDomainEmails(
  companyName: string,
  website: string | null,
  engine: SearchEngineKey = "auto",
  useExternalTools = false,
  proxyMode: ProxyMode = "direct",
  proxyUrl?: string | null,
): Promise<HarvestResult> {
  const started = Date.now();
  const steps: HarvestStep[] = [];

  const domain =
    website
      ? website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")
      : ((await resolveDomainFromName(companyName)) ?? "");

  if (!domain || !domain.includes(".")) {
    return {
      domain: domain || "-",
      emails: [],
      pagesCrawled: 0,
      steps: [{ source: "CRAWL", status: "failed", durationMs: 0, note: "domain tidak bisa di-resolve dari input" }],
      durationMs: Date.now() - started,
    };
  }

  const into = new Map<string, HarvestedEmail>();

  // step 0 — PROXY: jalur keluar (auto → pool gratis; custom → URL operator)
  const tPool = Date.now();
  const proxyPool = await getProxyPool(proxyMode, proxyUrl ?? null);
  steps.push({
    source: "PROXY",
    status: proxyPool.urls.length > 0 ? "success" : proxyMode === "direct" ? "success" : "failed",
    durationMs: Date.now() - tPool,
    note: proxyPool.note,
  });

  // 1) deep crawl
  const tCrawl = Date.now();
  const crawl = await crawlSite(domain, into, proxyPool);
  steps.push({ source: "CRAWL", status: crawl.pages > 0 ? "success" : "failed", durationMs: Date.now() - tCrawl, note: crawl.note });

  // 2) search @domain
  const tSearch = Date.now();
  const search = await searchDomainEmails(domain, engine, into, proxyPool);
  steps.push({ source: "SEARCH", status: "success", durationMs: Date.now() - tSearch, note: search.note });

  // 3) BBOT (opsional)
  if (useExternalTools) {
    const { bbotEmailEnum } = await import("./external-email-tools");
    const tBbot = Date.now();
    const bbot = await bbotEmailEnum(domain);
    for (const e of bbot.emails) {
      const existing = into.get(e.email);
      if (existing) existing.via = `${existing.via}+bbot`;
      else {
        const { kind, category } = classify(e.email);
        into.set(e.email, { email: e.email, kind, category, sourceUrl: `https://${domain}`, via: "bbot", sources: [`bbot:${e.source}`] });
      }
    }
    steps.push({ source: "BBOT", status: bbot.emails.length > 0 ? "success" : "failed", durationMs: bbot.durationMs, note: bbot.note });
  }

  // sort: role dulu (Info/HR/Support), lalu personal, lalu unknown; lalu banyak sumber
  const emails = [...into.values()].sort((a, b) => {
    const rank = (e: HarvestedEmail) => (e.kind === "role" ? 0 : e.kind === "personal" ? 1 : 2);
    return rank(a) - rank(b) || b.sources.length - a.sources.length;
  });

  return {
    domain,
    emails,
    pagesCrawled: crawl.pages + search.crawled,
    steps,
    durationMs: Date.now() - started,
  };
}

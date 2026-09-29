// ─────────────────────────────────────────────────────────────
// JOBFORCE — Company HR-email chain (§12 lanjutan)
//
// Board listing tidak expose email HR (LinkedIn terukur 0%, JobStreet/
// Glints ~14%). Tapi perusahaan mempublish email karir di situs mereka
// sendiri. Chain ini mengejar HANYA email yang benar-benar ter-publish:
//
//   1. domain  = website DB  →  Clearbit autocomplete (resolveDomainFromName)
//   2. homepage → cari link halaman karir (href ATAU anchor text:
//      /karir /karier /career /lowongan /join-us /vacancy /job)
//   3. scan halaman karir   → mailto → prefix rekrutmen → email apa pun
//      yang ter-publish di halaman karir (blacklist ketat)
//   4. tier 2: halaman kontak/kontak-kami → mailto + prefix rekrutmen SAJA
//      (info@/marketing@ bukan HR — jangan salah sasaran)
//   5. halaman 403/challenge Cloudflare → real Chrome (scanPageForEmailBrowser)
//
// Tidak ada email ditebak, tidak ada pola name@domain dikonstruksi (§12.4).
// ─────────────────────────────────────────────────────────────
import { extractDomain, resolveDomainFromName } from "./logo";
import { evictProxy, isProxyFailStatus, pickProxy, PROXY_ATTEMPT_TIMEOUT_MS, proxyAgentFor, type ProxyPool } from "./proxy-pool";
import type { ProxyAgent } from "undici";

const FETCH_TIMEOUT_MS = 8_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_BLACKLIST =
  /noreply|no-reply|donotreply|linkedin\.com|licdn\.com|sentry|example\.(com|org)|\.png|\.jpg|\.jpeg|\.webp|\.gif|privacy|abuse|postmaster|dmarc|webmaster|hostmaster|cloudflare|wixpress|sentry\.io/i;
/** Prefix jelas rekrutmen — boleh dipercaya dari halaman mana pun. */
const PREFIX_EMAIL_RE =
  /\b((?:hr|hrd|careers?|recruitment|recruit|rekrutmen|talent|jobs?|karir|karier|loker)[A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/i;
const CHALLENGE_RE = /just a moment|attention required|access denied|captcha-turnstile|cf-challenge|checking your browser/i;

/** Link halaman karir — cocok di PATH href atau teks anchor (ID + EN). */
const CAREERS_LINK_RE = /karir|karier|career|lowongan|join[\s_-]?us|vacanc|job[-_ ]?(opening|list)?|rekrutmen|working\s+at/i;
const CONTACT_LINK_RE = /kontak|contact/i;

async function fetchPage(url: string, proxyPool?: ProxyPool | null): Promise<{ ok: boolean; status?: number; text: string } | null> {
  const chosen = pickProxy(proxyPool);
  const agent = proxyAgentFor(chosen);
  // percobaan 1 lewat proxy (bila ada); gagal → buang proxy-nya + percobaan 2 langsung
  const attempts: (ProxyAgent | undefined)[] = agent ? [agent, undefined] : [undefined];
  for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
    const useAgent = attempts[attemptIdx];
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(useAgent ? PROXY_ATTEMPT_TIMEOUT_MS : FETCH_TIMEOUT_MS),
        redirect: "follow",
        headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.8", "Accept-Language": "id-ID,id;q=0.9,en;q=0.8" },
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
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("html")) {
        if (useAgent) {
          if (isProxyFailStatus(res.status)) evictProxy(chosen);
          continue;
        }
        return { ok: false, status: res.status, text: "" };
      }
      return { ok: true, status: res.status, text: (await res.text()).slice(0, 600_000) };
    } catch {
      if (useAgent) {
        evictProxy(chosen);
        continue;
      }
      return null;
    }
  }
  return null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // %-encoding rusak — pakai mentahnya
  }
}

/** Anchor absolut dari homepage yang cocok filter (href path ATAU teks link). */
function findLinks(html: string, baseUrl: string, filter: RegExp, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const baseHost = (() => {
    try {
      return new URL(baseUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  for (const m of html.matchAll(/<a[^>]+href\s*=\s*["']([^"'#]{4,200})["'][^>]*>([\s\S]{0,150}?)<\/a>/gi)) {
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
    // karir kadang subdomain beda (careers.foo.com) — izinkan host mengandung domain inti
    if (!host.endsWith(baseHost.replace(/^[a-z0-9-]+\./, "")) && host !== baseHost) continue;
    const key = abs.split("?")[0];
    if (seen.has(key)) continue;
    const hay = `${safeDecode(m[1])} ${stripTags(m[2])}`;
    if (filter.test(hay)) {
      seen.add(key);
      out.push(abs);
      if (out.length >= max) break;
    }
  }
  return out;
}

export interface PageEmailScan {
  email: string | null;
  via: "mailto" | "prefix" | "published";
}

/** Scan satu halaman: mailto → prefix rekrutmen → (opsional) email ter-publish apa pun. */
export function scanPageForPublishedEmail(html: string, allowGeneric: boolean): PageEmailScan {
  // 1) mailto: — sinyal kontak terkuat
  for (const m of html.matchAll(/mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi)) {
    const email = m[1].toLowerCase();
    if (!EMAIL_BLACKLIST.test(email)) return { email, via: "mailto" };
  }
  // 2) prefix rekrutmen (hr@ / karir@ / hrd@ / careers@ / rekrutmen@ …)
  const prefixed = html.match(PREFIX_EMAIL_RE)?.[1]?.toLowerCase();
  if (prefixed && !EMAIL_BLACKLIST.test(prefixed)) return { email: prefixed, via: "prefix" };
  // 3) email lain yang memang ter-publish — hanya di halaman karir
  //    (semua email di halaman karir relevan lamaran); sort: prefix-like dulu
  if (allowGeneric) {
    const candidates = [...new Set((html.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))]
      .filter((e) => !EMAIL_BLACKLIST.test(e))
      .sort((a, b) => Number(PREFIX_EMAIL_RE.test(b)) - Number(PREFIX_EMAIL_RE.test(a)));
    if (candidates[0]) return { email: candidates[0], via: "published" };
  }
  return { email: null, via: "mailto" };
}

export interface CompanyEmailResult {
  email: string;
  sourceUrl: string;
  tier: "homepage" | "careers" | "contact" | "browser";
  via: PageEmailScan["via"];
}

/**
 * Rantai pencarian email HR untuk satu perusahaan — hanya email ter-publish.
 * Return null = tidak ada yang di-publish / situs tak terjangkau (bukan kegagalan data).
 */
export async function findCompanyHrEmail(
  companyName: string,
  knownWebsite?: string | null,
  proxyPool?: ProxyPool | null,
): Promise<CompanyEmailResult | null> {
  const domain = extractDomain(knownWebsite) ?? (await resolveDomainFromName(companyName));
  if (!domain) return null;
  const website = `https://${domain}`;

  // ── homepage ──────────────────────────────────────────────
  const home = await fetchPage(website, proxyPool);
  if (!home) return null; // domain mati / tak terjangkau — jangan konstruksi apa pun

  let careersUrl: string | null = null;
  let contactUrl: string | null = null;
  if (home.ok && !CHALLENGE_RE.test(home.text.slice(0, 4_000))) {
    careersUrl = findLinks(home.text, website, CAREERS_LINK_RE)[0] ?? null;
    contactUrl = findLinks(home.text, website, CONTACT_LINK_RE)[0] ?? null;

    // homepage: prefix rekrutmen saja (email generic homepage sering info@)
    const homeScan = scanPageForPublishedEmail(home.text, false);
    if (homeScan.email) return { email: homeScan.email, sourceUrl: website, tier: "homepage", via: homeScan.via };
  }

  // ── halaman karir — target utama ──────────────────────────
  if (careersUrl) {
    const page = await fetchPage(careersUrl, proxyPool);
    if (page?.ok) {
      const scan = scanPageForPublishedEmail(page.text, true);
      if (scan.email) return { email: scan.email, sourceUrl: careersUrl, tier: "careers", via: scan.via };
    }
  }

  // ── tier 2: halaman kontak — prefix rekrutmen saja ────────
  if (contactUrl) {
    const page = await fetchPage(contactUrl, proxyPool);
    if (page?.ok) {
      const scan = scanPageForPublishedEmail(page.text, false);
      if (scan.email) return { email: scan.email, sourceUrl: contactUrl, tier: "contact", via: scan.via };
    }
  }

  // ── halaman diblokir/challenge → real Chrome (§12 path JobStreet/Glints) ──
  const blocked = !home.ok || CHALLENGE_RE.test(home.text.slice(0, 4_000)) || (careersUrl && !(await fetchPage(careersUrl, proxyPool))?.ok);
  if (blocked) {
    try {
      const { scanPageForEmailBrowser } = await import("./browser-boards");
      // browser fallback ikut lewat proxy bila pool aktif
      const email = await scanPageForEmailBrowser(careersUrl ?? website, pickProxy(proxyPool) ?? undefined);
      if (email && !EMAIL_BLACKLIST.test(email)) {
        return { email, sourceUrl: careersUrl ?? website, tier: "browser", via: "published" };
      }
    } catch {
      // browser gagal (challenge/proxy) — honest null
    }
  }

  return null;
}

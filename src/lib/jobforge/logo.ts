// ─────────────────────────────────────────────────────────────
// JOBFORCE — Company Logo Enrichment (§11)
// Resolves a company logo (PNG) from the company website domain
// via public logo providers — no API key required.
//
// Provider chain:
//   1. Google favicon svc  https://www.google.com/s2/favicons?...    PNG 128px
//   2. DuckDuckGo icons    https://icons.duckduckgo.com/ip3/...      ICO/PNG
//
// NOTE: Clearbit Logo API (logo.clearbit.com) was sunset Dec 2025 —
// removed from the chain, requests hang/fail and waste the timeout.
// ─────────────────────────────────────────────────────────────

export function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  const withProto = website.startsWith("http") ? website : `https://${website}`;
  try {
    const host = new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export function googleFaviconUrl(domain: string, size = 128): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}

export function duckduckgoIconUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${domain}`;
}

// ─────────────────────────────────────────────────────────────
// Nama → domain (Clearbit Autocomplete — free, no auth).
// Terukur 2026-09-12: jalan untuk perusahaan Indonesia
// ("sevima" → sevima.com, "bank mandiri" → bankmandiri.co.id).
// Dipakai ketika board tidak mengekspos website perusahaan
// (JobStreet/Glints) — domain dibutuhkan untuk resolve logo.
// ─────────────────────────────────────────────────────────────
const NAME_TIMEOUT_MS = 5000;
const nameDomainCache = new Map<string, string | null>();

export function cleanCompanyName(name: string): string {
  return name
    .replace(/^(pt|cv|cv\.|pt\.)/gi, " ")
    .replace(/\b(tbk|persero|indonesia)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function resolveDomainFromName(name: string | null | undefined): Promise<string | null> {
  const q = cleanCompanyName(name ?? "");
  if (q.length < 2) return null;
  const cacheKey = q.toLowerCase();
  if (nameDomainCache.has(cacheKey)) return nameDomainCache.get(cacheKey) ?? null;
  try {
    const res = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(NAME_TIMEOUT_MS) }
    );
    if (!res.ok) {
      nameDomainCache.set(cacheKey, null);
      return null;
    }
    const list = (await res.json()) as { domain?: string }[];
    const domain = list?.[0]?.domain ?? null;
    nameDomainCache.set(cacheKey, domain);
    return domain;
  } catch {
    nameDomainCache.set(cacheKey, null);
    return null;
  }
}

/**
 * URL logo terbaik untuk disimpan di DB. Rantai (logo = field wajib, jadi
 * fungsi ini dijamin mengembalikan sesuatu untuk nama yang valid):
 *   1. website domain        → Google favicon 128px (logo asli brand)
 *   2. nama perusahaan       → Clearbit autocomplete (domain) → Google favicon
 *   3. fallback terakhir     → badge SVG brand-color deterministik (data URI)
 */
export async function resolveLogoUrl(
  website: string | null | undefined,
  companyName?: string | null
): Promise<string | null> {
  const domain = extractDomain(website) ?? (await resolveDomainFromName(companyName));
  if (domain) return googleFaviconUrl(domain, 128);
  const clean = cleanCompanyName(companyName ?? "");
  if (clean.length >= 2) return svgBadgeDataUri(clean);
  return null;
}

/** Brand badge SVG sebagai data URI — dipakai ketika tidak ada provider yang punya brand. */
export function svgBadgeDataUri(seed: string): string {
  const safe = seed.toLowerCase().replace(/[^a-z0-9.]/g, "") || "x";
  const svg = generateLogoBadge(safe);
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * Logo aman-portal: portal tujuan (Karivia) memvalidasi company.logo_url dgn
 * URL validator strict (http/https saja) — data URI badge SVG internal kita
 * ditolak 422. Fungsi ini mengkonversi nilai logo apapun di DB menjadi URL
 * publik yang valid TANPA mengubah data di DB:
 *   1. sudah http(s)          → dipakai apa adanya
 *   2. data URI / lainnya     → Google favicon dari domain website perusahaan
 *   3. tanpa domain           → placeholder publik inisial nama (placehold.co)
 */
export function portalSafeLogoUrl(
  logoUrl: string | null | undefined,
  website: string | null | undefined,
  companyName: string | null | undefined
): string {
  const v = (logoUrl ?? "").trim();
  if (/^https?:\/\//i.test(v)) return v;
  const domain = extractDomain(website);
  if (domain) return googleFaviconUrl(domain, 128);
  // Inisial dari maksimal 2 kata pertama nama perusahaan → placeholder publik.
  const initials = (companyName ?? "")
    .replace(/^(pt|cv)\b/gi, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "") || "JB";
  return `https://placehold.co/128x128/png?text=${encodeURIComponent(initials)}`;
}

const FETCH_TIMEOUT_MS = 4000;
// suspiciously tiny response = provider stub/placeholder, skip it
const MIN_BYTES = 120;

export interface LogoFetchResult {
  body: ArrayBuffer;
  contentType: string;
  provider: string;
}

/** Fetch actual logo bytes through the provider chain — used by the /api/logo proxy. */
export async function fetchLogoPng(domain: string): Promise<LogoFetchResult | null> {
  const candidates = [
    { url: googleFaviconUrl(domain, 128), provider: "google-s2" },
    { url: duckduckgoIconUrl(domain), provider: "duckduckgo" },
  ];
  for (const c of candidates) {
    try {
      const res = await fetch(c.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
        headers: { "User-Agent": "JobForgeBot/1.0 (+logo enrichment)" },
      });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) continue;
      const body = await res.arrayBuffer();
      if (body.byteLength < MIN_BYTES) continue;
      return { body, contentType: type, provider: c.provider };
    } catch {
      // provider timed out / unreachable — try next in chain
    }
  }
  return null;
}

/**
 * Deterministic brand-colored SVG badge — last-resort "logo" so every
 * domain renders something visual even when no provider has the brand.
 * Same domain always yields the same color + label.
 */
export function generateLogoBadge(domain: string): string {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash * 31 + domain.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const hue2 = (hue + 42) % 360;
  const label =
    domain
      .split(".")[0]
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 2)
      .toUpperCase() || "?";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},72%,52%)"/><stop offset="1" stop-color="hsl(${hue2},68%,38%)"/></linearGradient></defs><rect width="128" height="128" rx="26" fill="url(#g)"/><text x="64" y="66" font-family="Arial, Helvetica, sans-serif" font-size="50" font-weight="700" fill="rgba(255,255,255,0.95)" text-anchor="middle" dominant-baseline="central">${label}</text></svg>`;
}

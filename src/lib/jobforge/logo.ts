// ─────────────────────────────────────────────────────────────
// JOBFORCE — Company Logo Enrichment (§11)
// Resolves a company logo (PNG) from the company website domain
// via public logo providers — no API key required.
//
// Provider chain:
//   1. Clearbit Logo API   https://logo.clearbit.com/{domain}        PNG, up to 512px
//   2. Google favicon svc  https://www.google.com/s2/favicons?...    PNG 128px
//   3. DuckDuckGo icons    https://icons.duckduckgo.com/ip3/...      ICO/PNG
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

export function clearbitLogoUrl(domain: string, size = 256): string {
  return `https://logo.clearbit.com/${domain}?size=${size}`;
}

export function googleFaviconUrl(domain: string, size = 128): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}

export function duckduckgoIconUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${domain}`;
}

/** Best direct PNG link to persist in DB — CDN resolves the actual image at display time. */
export function resolveLogoUrl(website: string | null | undefined): string | null {
  const domain = extractDomain(website);
  return domain ? clearbitLogoUrl(domain) : null;
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
    { url: clearbitLogoUrl(domain, 256), provider: "clearbit" },
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

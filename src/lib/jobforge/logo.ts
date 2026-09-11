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

/** Best direct PNG link to persist in DB — Google's CDN resolves the actual image at display time. */
export function resolveLogoUrl(website: string | null | undefined): string | null {
  const domain = extractDomain(website);
  return domain ? googleFaviconUrl(domain, 128) : null;
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

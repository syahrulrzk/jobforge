// ─────────────────────────────────────────────────────────────
// JOBFORCE — Source-aware network layer (§9 adapter transport)
//
// Every HTTP call to a job board goes through here so that a source's
// OWN network settings apply consistently:
//
//   proxyUrl    — optional HTTP(S) proxy (undici ProxyAgent, CONNECT
//                 tunneling). Residential proxies let the scraper exit
//                 from a home IP instead of a datacenter IP — the only
//                 reliable way past Cloudflare/Datadome challenges that
//                 block DC ranges outright.
//   headersJson — optional custom headers (Cookie, X-Requested-With…).
//                 Lets the operator hand off a browser-minted clearance
//                 cookie (cf_clearance) when JobForge runs on the same
//                 IP as the browser that minted it.
//
// Browser engines receive proxyUrl too — Playwright launch accepts
// { proxy: { server } } (HTTP/SOCKS), applied per attempt in live-search.
// ─────────────────────────────────────────────────────────────

import { ProxyAgent, fetch as undiciFetch } from "undici";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
export const BOT_UA = "JobForgeBot/1.0 (+https://jobforge.local; job aggregation)";

const agentCache = new Map<string, ProxyAgent>();

/** ProxyAgent per unique proxy URL (cached — agents own connection pools). */
export function proxyAgentFor(proxyUrl: string | null | undefined): ProxyAgent | null {
  const url = (proxyUrl ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return null; // socks → browser engines only
  let agent = agentCache.get(url);
  if (!agent) {
    agent = new ProxyAgent({ uri: url });
    agentCache.set(url, agent);
  }
  return agent;
}

/** Parse a source's headersJson into a flat header record (invalid → {}). */
export function parseHeadersJson(raw: string | null | undefined): Record<string, string> {
  const s = (raw ?? "").trim();
  if (!s) return {};
  try {
    const obj: unknown = JSON.parse(s);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === "string" || typeof v === "number") out[k] = String(v);
      }
      return out;
    }
  } catch {
    // invalid JSON → ignore silently; schema validation guards writes
  }
  return {};
}

export interface SourceNetConfig {
  proxyUrl?: string | null;
  headersJson?: string | null;
}

export interface SourceFetchOptions {
  /** browser UA for stealth attempts, bot UA otherwise (default bot) */
  ua?: "browser" | "bot";
  accept?: string;
  timeoutMs?: number;
}

export interface SourceFetchResult {
  ok: boolean;
  status: number;
  text: string;
}

/** Single entry point for board HTTP traffic — proxy + custom headers applied. */
export async function sourceFetchText(
  url: string,
  cfg: SourceNetConfig,
  opts: SourceFetchOptions = {}
): Promise<SourceFetchResult> {
  const custom = parseHeadersJson(cfg.headersJson);
  const headers: Record<string, string> = {
    "User-Agent": opts.ua === "browser" ? BROWSER_UA : BOT_UA,
    Accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
    ...custom,
  };
  const dispatcher = proxyAgentFor(cfg.proxyUrl);
  const res = await undiciFetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

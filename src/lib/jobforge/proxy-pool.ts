// ─────────────────────────────────────────────────────────────
// JOBFORCE — Free Proxy Pool (Tools · Cari Email / Harvest)
//
// IP datacenter gampang keblokir anti-bot (DDG 202 anomaly, skymem 403,
// emailformat unreachable). Pool proxy gratis ini ngasih jalur keluar:
//
//   mode "auto"   — fetch daftar proxy publik (geonode free API +
//                   proxy-list.download) → validasi paralel (8s, 2 lapis:
//                   IP echo + fetch google) → pegang pool sehat (~6)
//                   → rotasi round-robin per request.
//   mode "custom" — satu proxy URL dari operator (http://user:pass@host:port)
//                   dipakai apa adanya (tidak divalidasi keras, cuma dipakai).
//
// Validasi di-cache (TTL) supaya probe berikutnya instan. Semua fungsi
// tidak pernah melempar — gagal → null/pool kosong, caller lanjut tanpa
// proxy (fallback langsung — jangan sampai pool mati bikin fitur mati).
// ─────────────────────────────────────────────────────────────
import { ProxyAgent, fetch as undiciFetch } from "undici";

export type ProxyMode = "direct" | "auto" | "custom";

/** Parse input mode dari API — nilai aneh → "direct". */
export function parseProxyMode(value: string | null | undefined): ProxyMode {
  const v = (value ?? "").trim().toLowerCase();
  return v === "auto" || v === "custom" ? v : "direct";
}

export interface ProxyPool {
  mode: ProxyMode;
  /** proxy URL siap pakai (http://[user:pass@]host:port) */
  urls: string[];
  /** catatan singkat untuk step console di UI */
  note: string;
}

const AGENT_TTL_MS = 10 * 60_000; // agent cache 10 menit
const POOL_TTL_MS = 5 * 60_000; // validated pool cache 5 menit
const VALIDATE_TIMEOUT_MS = 8_000;
const EARLY_EXIT_HEALTHY = 8; // cukup 8 sehat → berhenti validasi (request pertama tetap cepat)
const VALIDATE_CONCURRENCY = 24;

interface CacheEntry {
  urls: string[];
  at: number;
  note: string;
}

const poolCache = new Map<string, CacheEntry>();
const agentCache = new Map<string, { agent: ProxyAgent; at: number }>();

// circuit breaker: proxy gratis sering mati massal — setelah MAX_STRIKES
// kegagalan, pool dimatikan sementara (fallback langsung) biar run tidak
// terus membayar timeout di proxy busuk
const MAX_STRIKES = 4;
const POISON_COOLDOWN_MS = 60_000;
let strikes = 0;
let poisonedUntil = 0;

/** ProxyAgent per URL (cached, TTL dijaga — koneksi pool milik agent). */
export function proxyAgentFor(proxyUrl: string | null | undefined): ProxyAgent | null {
  const url = (proxyUrl ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const hit = agentCache.get(url);
  if (hit && Date.now() - hit.at < AGENT_TTL_MS) return hit.agent;
  try {
    const agent = new ProxyAgent({ uri: url });
    agentCache.set(url, { agent, at: Date.now() });
    return agent;
  } catch {
    return null;
  }
}

/** URL proxy dikonfigurasi via env? (opsional — operator bisa pin proxy pribadi) */
function envProxyUrl(): string | null {
  const raw = (process.env.JOBFORCE_PROXY_URL ?? process.env.PROXY_URL ?? "").trim();
  return /^https?:\/\//i.test(raw) ? raw : null;
}

/** round-robin counter global — rotasi adil antar request */
let rr = 0;
export function pickProxy(pool: ProxyPool | null | undefined): string | null {
  if (!pool || pool.urls.length === 0) return null;
  const url = pool.urls[rr % pool.urls.length];
  rr = (rr + 1) % Number.MAX_SAFE_INTEGER;
  return url;
}

/**
 * Buang proxy yang terbukti gagal dari pool cache — request berikutnya
 * langsung rotasi ke proxy sehat berikutnya (atau langsung tanpa proxy).
 * Mencegah tiap request mengulang timeout di proxy yang sama.
 */
export function evictProxy(url: string | null | undefined): void {
  if (!url) return;
  const hit = poolCache.get("auto");
  if (hit) {
    const i = hit.urls.indexOf(url);
    // splice in-place — pool object yang sedang dipakai run juga ikut keupdate
    if (i >= 0) hit.urls.splice(i, 1);
  }
  strikes += 1;
  if (strikes >= MAX_STRIKES) {
    poolCache.delete("auto");
    poisonedUntil = Date.now() + POISON_COOLDOWN_MS; // 60s full direct
  }
}

/** Status HTTP yang menandakan jalur proxy bermasalah (bukan target-nya). */
export function isProxyFailStatus(status: number): boolean {
  return status === 403 || status === 407 || status === 429 || status === 502 || status === 503;
}

/** Timeout khusus percobaan via proxy — lebih pendek dari fetch langsung. */
export const PROXY_ATTEMPT_TIMEOUT_MS = 5_000;

// ── Sumber daftar proxy gratis ─────────────────────────────────
interface RawProxy {
  url: string;
  latencyMs: number;
}

async function fetchGeonode(timeoutMs: number): Promise<RawProxy[]> {
  try {
    const res = await undiciFetch(
      "https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=latency&sort_type=asc&protocols=http%2Chttps&filterUpTime=80",
      { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { ip?: string; port?: number; latency?: number }[] };
    return (json.data ?? [])
      .filter((p) => p.ip && p.port)
      .slice(0, 60)
      .map((p) => ({ url: `http://${p.ip}:${p.port}`, latencyMs: p.latency ?? 9999 }));
  } catch {
    return [];
  }
}

async function fetchProxyListDownload(timeoutMs: number): Promise<RawProxy[]> {
  try {
    const res = await undiciFetch(
      "https://www.proxy-list.download/api/v1/get?type=http&anon=elite",
      { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "text/plain" } },
    );
    if (!res.ok) return [];
    const text = await res.text();
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(l))
      .slice(0, 60)
      .map((l) => ({ url: `http://${l}`, latencyMs: 9999 }));
  } catch {
    return [];
  }
}

/** Validasi 1 proxy: lapis 1 echo IP (cepat), lapis 2 fetch google (reliabel). */
async function validateProxy(url: string): Promise<boolean> {
  const agent = proxyAgentFor(url);
  if (!agent) return false;
  try {
    const res = await undiciFetch("https://api.ipify.org/?format=json", {
      dispatcher: agent,
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return false;
    await res.text();
  } catch {
    return false;
  }
  try {
    const res2 = await undiciFetch("https://www.google.com/generate_204", {
      dispatcher: agent,
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    return res2.status === 204;
  } catch {
    return false;
  }
}

/** Pool map keyed by URL; runs validate with concurrency cap. */
async function validateInBatches(candidates: string[]): Promise<string[]> {
  const healthy: string[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(VALIDATE_CONCURRENCY, candidates.length) }, async () => {
    while (idx < candidates.length) {
      if (healthy.length >= EARLY_EXIT_HEALTHY) {
        idx = candidates.length; // pool cukup — sisa kandidat skip
        break;
      }
      const i = idx++;
      const ok = await validateProxy(candidates[i]);
      if (ok) healthy.push(candidates[i]);
    }
  });
  await Promise.all(workers);
  return healthy;
}

/**
 * Ambil pool proxy sesuai mode.
 *  - "direct"  → pool kosong (tanpa proxy)
 *  - "custom"  → URL operator dipakai mentah (1 URL)
 *  - "auto"    → cache dulu → fetch daftar publik → validasi → pool sehat
 */
export async function getProxyPool(mode: ProxyMode, customUrl?: string | null): Promise<ProxyPool> {
  if (mode === "direct") return { mode, urls: [], note: "langsung tanpa proxy" };

  if (mode === "custom") {
    const url = (customUrl ?? "").trim() || envProxyUrl() || "";
    if (!/^https?:\/\//i.test(url)) {
      return { mode, urls: [], note: "custom proxy tidak valid (harus http://[user:pass@]host:port)" };
    }
    return { mode, urls: [url], note: "custom proxy operator (tidak divalidasi keras)" };
  }

  // mode auto — env pin dihargai dulu biar instan
  const envUrl = envProxyUrl();
  if (envUrl) return { mode, urls: [envUrl], note: "proxy dari env JOBFORCE_PROXY_URL" };

  const cacheKey = "auto";
  // circuit breaker terbuka → jangan buang waktu ke proxy, jalur langsung saja
  if (Date.now() < poisonedUntil) {
    return { mode, urls: [], note: `pool proxy gratis tidak stabil (circuit breaker) — jalur langsung, coba lagi ${Math.ceil((poisonedUntil - Date.now()) / 1000)}s lagi` };
  }
  const hit = poolCache.get(cacheKey);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) {
    return { mode, urls: hit.urls, note: `${hit.urls.length} proxy sehat (cache) — ${hit.note}` };
  }

  const started = Date.now();
  const [geo, pld] = await Promise.all([fetchGeonode(7_000), fetchProxyListDownload(7_000)]);
  const seen = new Set<string>();
  const candidates = [...geo, ...pld].filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true))).map((p) => p.url);
  if (candidates.length === 0) {
    return { mode, urls: [], note: "daftar proxy gratis tidak bisa diambil (sumber diblokir) — fallback langsung" };
  }

  const healthy = await validateInBatches(candidates);
  const note = `${healthy.length}/${candidates.length} proxy gratis lolos validasi (${((Date.now() - started) / 1000).toFixed(1)}s)`;
  poolCache.set(cacheKey, { urls: healthy, at: Date.now(), note });
  strikes = 0; // pool baru — reset breaker
  return { mode, urls: healthy, note };
}

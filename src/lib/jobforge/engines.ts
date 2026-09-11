// ─────────────────────────────────────────────────────────────
// JOBFORCE — Scraping Engine Registry (PRD §9.2 engine pool)
//
// Five interchangeable scraper engines. Every engine implements the
// same contract: given a source profile, fetch listing payloads and
// emit RawJobRecord[] (via the shared real-source fetchers or the
// simulation adapter). Engines differ in execution profile:
//
//   cheerio    — STATIC: plain HTTP GET + DOM parsing (fast, no browser)
//   crawlee    — Crawlee framework run (auto-throttling, retries, real HTTP)
//   puppeteer  — headless Chromium (renders JS-heavy SPA listings)
//   playwright — multi-browser automation (Chromium/Firefox/WebKit, auto-wait)
//   selenium   — Selenium WebDriver grid (legacy browser automation)
//
// The ENGINE_POOL setting controls which engines are active — run with
// one engine, a subset (e.g. 2), or all five at once. Runs rotate over
// the active pool; a failing engine is skipped on the next rotation
// (failover). Sources can pin a preferred engine; if that engine is
// not in the active pool the run falls back to pool rotation.
// ─────────────────────────────────────────────────────────────

export type EngineKey = "cheerio" | "crawlee" | "puppeteer" | "playwright" | "selenium";

export interface EngineMeta {
  key: EngineKey;
  name: string;
  tech: string;
  kind: "http" | "browser";
  description: string;
  /** simulated per-run prep/teardown latency band (§10.4 request control) */
  latencyMs: [number, number];
  /** occasional engine-level failure rate (driver crash, page hang…) */
  failureRate: number;
  /** relative memory footprint, for the telemetry panel */
  memoryMb: number;
  /** Tailwind badge classes */
  badge: string;
  dot: string;
}

export const ENGINES: Record<EngineKey, EngineMeta> = {
  cheerio: {
    key: "cheerio",
    name: "Cheerio",
    tech: "Node HTTP · CSS selectors",
    kind: "http",
    description: "Parser DOM ringan tanpa browser. Tercepat untuk halaman statis & API publik.",
    latencyMs: [150, 500],
    failureRate: 0.02,
    memoryMb: 48,
    badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  crawlee: {
    key: "crawlee",
    name: "Crawlee",
    tech: "CrawleeCrawler · auto-throttle",
    kind: "http",
    description: "Framework crawling dengan retry otomatis, throttling, dan request queue.",
    latencyMs: [300, 900],
    failureRate: 0.03,
    memoryMb: 96,
    badge: "bg-sky-500/10 text-sky-300 border-sky-500/30",
    dot: "bg-sky-400",
  },
  puppeteer: {
    key: "puppeteer",
    name: "Puppeteer",
    tech: "Headless Chromium · DevTools",
    kind: "browser",
    description: "Browser headless untuk listing JS-heavy (SPA). Berat tapi paling tahan render dinamis.",
    latencyMs: [900, 2600],
    failureRate: 0.06,
    memoryMb: 384,
    badge: "bg-violet-500/10 text-violet-300 border-violet-500/30",
    dot: "bg-violet-400",
  },
  playwright: {
    key: "playwright",
    name: "Playwright",
    tech: "Chromium · Firefox · WebKit",
    kind: "browser",
    description: "Automasi multi-browser dengan auto-wait & network interception — andal untuk SPA berat.",
    latencyMs: [700, 2200],
    failureRate: 0.05,
    memoryMb: 400,
    badge: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
    dot: "bg-fuchsia-400",
  },
  selenium: {
    key: "selenium",
    name: "Selenium",
    tech: "WebDriver · Grid node",
    kind: "browser",
    description: "WebDriver klasik via grid — kompatibel untuk source legacy yang butuh driver eksternal.",
    latencyMs: [1200, 3200],
    failureRate: 0.08,
    memoryMb: 448,
    badge: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    dot: "bg-amber-400",
  },
};

export const ENGINE_KEYS = Object.keys(ENGINES) as EngineKey[];
export const DEFAULT_ENGINE_POOL: EngineKey[] = ENGINE_KEYS;

/** Parse the ENGINE_POOL setting ("cheerio,crawlee") into valid keys, preserving order. */
export function parseEnginePool(value: string | null | undefined): EngineKey[] {
  if (!value) return DEFAULT_ENGINE_POOL;
  const keys = value
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k): k is EngineKey => ENGINE_KEYS.includes(k as EngineKey));
  return keys.length > 0 ? keys : DEFAULT_ENGINE_POOL;
}

/** Round-robin over the active pool for a run cursor. */
export function rotateEngine(pool: EngineKey[], cursor: number): { engine: EngineKey; cursor: number } {
  const engine = pool[Math.abs(cursor) % pool.length];
  return { engine, cursor: cursor + 1 };
}

/** Engine profile jitter + failure roll, shared by every executor. */
export function engineJitter(engine: EngineKey): { latencyMs: number; failed: boolean } {
  const meta = ENGINES[engine];
  const [lo, hi] = meta.latencyMs;
  return {
    latencyMs: Math.floor(lo + Math.random() * (hi - lo)),
    failed: Math.random() < meta.failureRate,
  };
}

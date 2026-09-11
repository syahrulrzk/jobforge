import { db } from "@/lib/db";
import { SOURCE_PROFILES, randInt } from "./data";
import { DEFAULT_ENGINE_POOL } from "./engines";

// ─────────────────────────────────────────────────────────────
// JOBFORCE — Initial seed (idempotent, anti-spam).
// Hanya menanam SOURCES + SETTINGS. Tidak ada lagi job/companies
// mock — data real mengalir dari public job boards via worker
// engine (sources-real.ts REAL_BOARDS). Board portal tanpa
// integrasi real ditanam INACTIVE: tidak pernah generate data palsu.
// ─────────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;

// Real boards + engine pin default-nya (urutan 1 board = 1 engine berbeda
// supaya semua engine kebagian rotasi; user bebas ubah via UI multi-engine).
const REAL_BOARD_SEED: { slug: string; engine: string; schedule: string }[] = [
  { slug: "remotive", engine: "cheerio", schedule: "hourly" },
  { slug: "jobicy", engine: "crawlee", schedule: "hourly" },
  { slug: "arbeitnow", engine: "puppeteer", schedule: "every_6_hours" },
  { slug: "remoteok", engine: "selenium", schedule: "every_6_hours" },
  { slug: "himalayas", engine: "playwright", schedule: "every_6_hours" },
];

let seedPromise: Promise<void> | null = null;

export function ensureSeed(): Promise<void> {
  if (!seedPromise) seedPromise = seed();
  return seedPromise;
}

async function seed(): Promise<void> {
  // 1. Real boards — selalu di-upsert (idempotent) supaya DB fresh selalu
  //    punya sumber data real. Engine pin default hanya diisi bila kolom
  //    engines masih kosong — pilihan multi-engine user tidak ditimpa restart.
  for (const rb of REAL_BOARD_SEED) {
    const p = SOURCE_PROFILES.find((x) => x.slug === rb.slug);
    const existing = await db.source.findUnique({ where: { slug: rb.slug } });
    if (!existing) {
      await db.source.create({
        data: {
          slug: rb.slug,
          name: p?.name ?? "Himalayas",
          baseUrl: p?.baseUrl ?? "https://himalayas.app",
          type: p?.type ?? "PUBLIC_SOURCE",
          scraperType: p?.scraperType ?? "API",
          engine: rb.engine,
          engines: rb.engine,
          schedule: rb.schedule,
          status: "ACTIVE",
          lastRunAt: new Date(Date.now() - randInt(2, 10) * HOUR),
        },
      });
    } else if (!existing.engines) {
      await db.source.update({
        where: { slug: rb.slug },
        data: { engine: rb.engine, engines: rb.engine },
      });
    }
  }

  // 2. Portal sources (PRD §8) — sekali saja saat belum ada.
  //    Portal tanpa integrasi real (JobStreet dkk.) ditanam INACTIVE:
  //    engine bisa dipilih bebas, tapi auto-tick tidak akan bikin data mock.
  const realSlugs = new Set(REAL_BOARD_SEED.map((r) => r.slug));
  const portalCount = await db.source.count({ where: { slug: { in: SOURCE_PROFILES.map((p) => p.slug) } } });
  if (portalCount === 0) {
    for (const p of SOURCE_PROFILES) {
      if (realSlugs.has(p.slug)) continue; // sudah dibuat di atas
      await db.source.create({
        data: {
          slug: p.slug,
          name: p.name,
          baseUrl: p.baseUrl,
          type: p.type,
          scraperType: p.scraperType,
          engine: "cheerio",
          schedule: p.schedule,
          status: "INACTIVE",
          lastRunAt: new Date(Date.now() - randInt(1, 10) * HOUR),
        },
      });
    }
  }

  // 3. Settings (§23, §37) — create-if-missing, tidak menimpa preferensi user.
  const defaults: Record<string, string> = {
    JOB_PORTAL_API_URL: "https://portal.jobforge.local/api/v1/jobs/import",
    JOB_PORTAL_API_KEY: "jf_live_9f2c8a41d7e64b05",
    BATCH_SIZE: "25",
    MAX_ATTEMPTS: "3",
    AUTO_SCRAPE: "true",
    AUTO_DELIVERY: "true",
    TICK_INTERVAL_MS: "5000",
    DEMO_JOB_CAP: "3000",
    DATA_MODE: "real",
    ENGINE_POOL: DEFAULT_ENGINE_POOL.join(","),
  };
  for (const [key, value] of Object.entries(defaults)) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
}

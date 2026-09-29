import { db } from "@/lib/db";
import { SOURCE_PROFILES, randInt } from "./data";
import { DEFAULT_ENGINE_POOL } from "./engines";

// ─────────────────────────────────────────────────────────────
// JOBFORCE — Initial seed (idempotent, anti-spam).
// Hanya menanam SOURCES + SETTINGS. Tidak ada lagi job/companies
// mock — data real mengalir dari public job boards via worker
// engine (sources-real.ts REAL_BOARDS): 5 board internasional
// (remotive/jobicy/arbeitnow/remoteok/himalayas) + Dealls Indonesia
// (api.sejutacita.id — email HR ikut di payload). Board portal tanpa
// integrasi real ditanam INACTIVE: tidak pernah generate data palsu.
// ─────────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;

// NOTE (Task 16): the five public boards (remotive/jobicy/arbeitnow/
// remoteok/himalayas) used to be re-created here on every boot, which
// resurrected boards the user had deliberately deleted — fixed per
// user intent: JobForge no longer auto-creates them. They remain fully
// supported: any source the user adds with one of those slugs gets its
// real integration + live keyword search immediately (BOARD_SEARCHES
// / REAL_BOARDS are slug-driven, not row-driven).

let seedPromise: Promise<void> | null = null;

export function ensureSeed(): Promise<void> {
  if (!seedPromise) seedPromise = seed();
  return seedPromise;
}

async function seed(): Promise<void> {
  // 1. Portal sources (PRD §8) — sekali saja saat belum ada.
  //    Portal tanpa integrasi real (Glints dkk.) ditanam INACTIVE:
  //    engine bisa dipilih bebas, tapi auto-tick tidak akan bikin data mock.
  //    Board publik internasional TIDAK di-auto-create (lihat NOTE di atas).
  const portalCount = await db.source.count({ where: { slug: { in: SOURCE_PROFILES.map((p) => p.slug) } } });
  if (portalCount === 0) {
    for (const p of SOURCE_PROFILES) {
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

  // 2. Settings (§23, §37) — create-if-missing, tidak menimpa preferensi user.
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

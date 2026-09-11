// One-off migration: enable REAL data mode + 4-engine pool.
// - Adds 4 real job-board sources (public APIs) with engine assignments
// - Deactivates the 7 legacy simulation boards
// - Sets DATA_MODE=real, ENGINE_POOL=all 4 engines, bumps DEMO_JOB_CAP
// Safe to re-run (upserts).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const REAL_SOURCES = [
  { slug: "remotive", name: "Remotive", baseUrl: "https://remotive.com", type: "PUBLIC_SOURCE", scraperType: "API", engine: "crawlee", schedule: "hourly" },
  { slug: "jobicy", name: "Jobicy", baseUrl: "https://jobicy.com", type: "PUBLIC_SOURCE", scraperType: "API", engine: "puppeteer", schedule: "hourly" },
  { slug: "arbeitnow", name: "Arbeitnow", baseUrl: "https://www.arbeitnow.com", type: "PUBLIC_SOURCE", scraperType: "API", engine: "cheerio", schedule: "every_6_hours" },
  { slug: "remoteok", name: "RemoteOK", baseUrl: "https://remoteok.com", type: "PUBLIC_SOURCE", scraperType: "API", engine: "selenium", schedule: "every_6_hours" },
];

const SETTINGS: [string, string][] = [
  ["DATA_MODE", "real"],
  ["ENGINE_POOL", "cheerio,crawlee,puppeteer,selenium"],
  ["DEMO_JOB_CAP", "3000"],
];

async function main() {
  for (const s of REAL_SOURCES) {
    await db.source.upsert({
      where: { slug: s.slug },
      update: { name: s.name, baseUrl: s.baseUrl, type: s.type, scraperType: s.scraperType, engine: s.engine, schedule: s.schedule },
      create: { ...s, status: "ACTIVE" },
    });
    console.log(`✓ real source ready: ${s.name} (engine: ${s.engine})`);
  }

  const mockSlugs = ["jobstreet", "glints", "indeed", "kalibrr", "karir", "dealls", "career-sites"];
  const deactivated = await db.source.updateMany({
    where: { slug: { in: mockSlugs } },
    data: { status: "INACTIVE" },
  });
  console.log(`✓ legacy mock sources deactivated: ${deactivated.count}`);

  for (const [key, value] of SETTINGS) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    console.log(`✓ setting ${key}=${value}`);
  }

  // backfill engine on historical runs so the Runs view shows something sensible
  const legacyRuns = await db.scrapeRun.updateMany({ where: { engine: null }, data: { engine: "cheerio" } });
  console.log(`✓ legacy runs tagged with engine: ${legacyRuns.count}`);

  const active = await db.source.findMany({ where: { status: "ACTIVE" }, select: { name: true, engine: true } });
  console.log("\nActive sources:", active.map((s) => `${s.name}[${s.engine}]`).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

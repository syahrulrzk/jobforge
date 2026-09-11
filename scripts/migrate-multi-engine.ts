// One-off migration (Task 13): multi-engine per source + anti-spam real mode.
// 1. Backfill Source.engines = engine (kolom baru CSV prioritas)
// 2. Upsert 5 real boards (Remotive/Jobicy/Arbeitnow/RemoteOK/Himalayas) ACTIVE dgn engine pin
// 3. Nonaktifkan portal legacy tanpa integrasi real (JobStreet dkk.)
// 4. PURGE semua data mock (jobs/companies/runs/errors) — anti-spam, DB mulai bersih
// 5. Pastikan settings DATA_MODE=real + ENGINE_POOL 5 engine
// Safe to re-run (upserts).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const REAL_SOURCES: { slug: string; name: string; baseUrl: string; engine: string; schedule: string }[] = [
  { slug: "remotive", name: "Remotive", baseUrl: "https://remotive.com", engine: "cheerio", schedule: "hourly" },
  { slug: "jobicy", name: "Jobicy", baseUrl: "https://jobicy.com", engine: "crawlee", schedule: "hourly" },
  { slug: "arbeitnow", name: "Arbeitnow", baseUrl: "https://www.arbeitnow.com", engine: "puppeteer", schedule: "every_6_hours" },
  { slug: "remoteok", name: "RemoteOK", baseUrl: "https://remoteok.com", engine: "selenium", schedule: "every_6_hours" },
  { slug: "himalayas", name: "Himalayas", baseUrl: "https://himalayas.app", engine: "playwright", schedule: "every_6_hours" },
];

const PORTAL_SLUGS = ["jobstreet", "glints", "indeed", "kalibrr", "karir", "dealls", "career-sites"];

async function main() {
  // 1. backfill engines CSV utk semua source existing
  const sources = await db.source.findMany();
  for (const s of sources) {
    if (!s.engines) {
      await db.source.update({ where: { id: s.id }, data: { engines: s.engine || "cheerio" } });
    }
  }
  console.log(`✓ engines CSV backfilled: ${sources.filter((s) => !s.engines).length} source`);

  // 2. upsert real boards
  for (const s of REAL_SOURCES) {
    await db.source.upsert({
      where: { slug: s.slug },
      update: { name: s.name, baseUrl: s.baseUrl, engine: s.engine, engines: s.engine, schedule: s.schedule, type: "PUBLIC_SOURCE", scraperType: "API" },
      create: {
        slug: s.slug,
        name: s.name,
        baseUrl: s.baseUrl,
        type: "PUBLIC_SOURCE",
        scraperType: "API",
        engine: s.engine,
        engines: s.engine,
        schedule: s.schedule,
        status: "ACTIVE",
      },
    });
    console.log(`✓ real board ready: ${s.name} [${s.engine}]`);
  }

  // 3. portal legacy tanpa integrasi real → INACTIVE (anti-spam, auto-tick skip)
  const deactivated = await db.source.updateMany({
    where: { slug: { in: PORTAL_SLUGS } },
    data: { status: "INACTIVE" },
  });
  console.log(`✓ portal tanpa integrasi real di-nonaktifkan: ${deactivated.count}`);

  // 4. purge data mock (semua job/companies/runs/errors/log saat ini berasal dari generator mock)
  const delJobs = await db.job.deleteMany({});
  const delCompanies = await db.company.deleteMany({});
  const delRuns = await db.scrapeRun.deleteMany({});
  const delErrors = await db.scrapeError.deleteMany({});
  const delLogs = await db.activityLog.deleteMany({});
  console.log(
    `✓ mock data purged — jobs: ${delJobs.count}, companies: ${delCompanies.count}, runs: ${delRuns.count}, errors: ${delErrors.count}, logs: ${delLogs.count}`
  );

  // 5. settings
  for (const [key, value] of [
    ["DATA_MODE", "real"],
    ["ENGINE_POOL", "cheerio,crawlee,puppeteer,playwright,selenium"],
    ["DEMO_JOB_CAP", "3000"],
  ] as [string, string][]) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    console.log(`✓ setting ${key}=${value}`);
  }

  const active = await db.source.findMany({ where: { status: "ACTIVE" }, select: { name: true, engine: true, engines: true } });
  console.log("\nActive sources:", active.map((s) => `${s.name}[${s.engines}]`).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

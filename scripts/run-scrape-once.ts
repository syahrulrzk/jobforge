// ─────────────────────────────────────────────────────────────
// JobForge — Run one scheduled scrape via the real engine
//
//   DATABASE_URL=... bun scripts/run-scrape-once.ts <slug>
//
// Reuses the app's Prisma client, ensureSeed() (source/settings
// seeding) and runSourceNow() — the exact path the dashboard
// "Run now" button uses. Prints the ingest report afterwards.
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const slug = process.argv[2]?.trim();
  if (!slug) {
    console.error("usage: bun scripts/run-scrape-once.ts <source-slug>");
    process.exit(1);
  }

  // 1. seed sources/settings (idempotent) — mirrors bootstrap.ts
  const { ensureSeed } = await import("../src/lib/jobforge/seed");
  await ensureSeed();

  // 2. find the source; activate if still INACTIVE so the engine will run it
  const source = await db.source.findUnique({ where: { slug } });
  if (!source) {
    console.error(`source "${slug}" tidak ada di DB — cek Data Sources / seed`);
    process.exit(1);
  }
  if (source.status === "INACTIVE") {
    await db.source.update({ where: { id: source.id }, data: { status: "ACTIVE" } });
    console.log(`source "${slug}" tadinya INACTIVE → diaktifkan untuk run ini`);
  }
  console.log(`running engine scrape for "${source.name}" (${slug})…\n`);

  // 3. run the REAL engine path (same as dashboard "Run now")
  const { runSourceNow } = await import("../src/lib/jobforge/engine");
  await runSourceNow(source.id);

  // 4. report — read back what actually landed in the DB
  const [updated, runs, logs, byStatus] = await Promise.all([
    db.source.findUnique({ where: { id: source.id } }),
    db.scrapeRun.findMany({
      where: { sourceId: source.id },
      orderBy: { startedAt: "desc" },
      take: 1,
    }),
    db.activityLog.findMany({
      where: { source: slug },
      orderBy: { ts: "desc" },
      take: 8,
    }),
    db.job.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const run = runs[0];
  console.log("== ScrapeRun ==");
  if (run) {
    console.log({
      status: run.status,
      engine: run.engine,
      pagesScraped: run.pagesScraped,
      jobsFound: run.jobsFound,
      jobsCreated: run.jobsCreated,
      jobsUpdated: run.jobsUpdated,
      jobsDuplicate: run.jobsDuplicate,
      jobsRejected: run.jobsRejected,
      errorCount: run.errorCount,
      durationMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
    });
  } else {
    console.log("(tidak ada ScrapeRun tercatat)");
  }

  console.log("\n== ActivityLog (source ini) ==");
  for (const l of logs) console.log(`[${l.status}] ${l.message.slice(0, 160)}`);

  console.log("\n== Source status ==");
  console.log({ status: updated?.status, lastRunAt: updated?.lastRunAt });

  console.log("\n== Job status distribution (DB) ==");
  for (const g of byStatus) console.log(`  ${g.status}: ${g._count._all}`);

  const totalJobs = await db.job.count();
  console.log(`\ntotal jobs in DB: ${totalJobs}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

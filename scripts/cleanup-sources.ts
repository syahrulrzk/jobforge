// Task 16-a — restore user's intent: ONLY JobStreet (+ 4 INACTIVE ID portals).
// The 5 international boards (remotive/jobicy/arbeitnow/remoteok/himalayas) were
// re-added by the sandbox-restore script even though the user had deleted them.
// This script deletes them again + removes orphan jobs that lost their only source.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const KILL = ["remotive", "jobicy", "arbeitnow", "remoteok", "himalayas"];

async function main() {
  const all = await db.source.findMany({
    select: { id: true, slug: true, name: true, status: true, engine: true, engines: true, scraperType: true, schedule: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("=== BEFORE ===");
  for (const s of all)
    console.log(`${s.slug} | ${s.name} | ${s.status} | engine=${s.engine} | engines=${s.engines} | scraper=${s.scraperType} | sched=${s.schedule}`);

  // 1) delete the 5 international boards (cascade: jobLinks, runs, errors)
  const kill = await db.source.findMany({ where: { slug: { in: KILL } } });
  for (const s of kill) {
    const links = await db.jobSource.count({ where: { sourceId: s.id } });
    await db.source.delete({ where: { id: s.id } });
    console.log(`DELETED source ${s.slug} (${links} job links cascaded)`);
  }

  // 2) delete jobs that lost their last source link (orphans from deleted boards)
  const jobs = await db.job.findMany({ select: { id: true } });
  let orphan = 0;
  for (const j of jobs) {
    const c = await db.jobSource.count({ where: { jobId: j.id } });
    if (c === 0) {
      await db.job.delete({ where: { id: j.id } });
      orphan++;
    }
  }
  console.log(`DELETED ${orphan} orphan jobs (no source links left)`);

  // 3) verify JobStreet keeps the user's own config untouched
  const js = await db.source.findUnique({ where: { slug: "jobstreet" } });
  if (js) {
    console.log(`jobstreet kept: status=${js.status} engine=${js.engine} engines=${js.engines} scraper=${js.scraperType} sched=${js.schedule} baseUrl=${js.baseUrl}`);
  } else {
    console.log("!! jobstreet source MISSING");
  }

  const after = await db.source.findMany({ select: { slug: true, status: true }, orderBy: { createdAt: "asc" } });
  console.log("=== AFTER === " + after.map((s) => `${s.slug}(${s.status})`).join(", "));
  console.log(`sources: ${after.length}, jobs left: ${await db.job.count()}`);
}

main().finally(() => db.$disconnect());

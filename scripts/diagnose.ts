// Diagnose: check for linkless jobs created recently + recent runs
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const linkless = await db.job.findMany({
    where: { jobLinks: { none: {} } },
    select: { id: true, status: true, scrapedAt: true },
    orderBy: { scrapedAt: "desc" },
    take: 5,
  });
  console.log("linkless jobs (newest 5):", JSON.stringify(linkless, null, 1));

  const runs = await db.scrapeRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
    select: { startedAt: true, status: true, jobsFound: true, jobsCreated: true },
  });
  console.log("recent runs:", JSON.stringify(runs, null, 1));

  const byStatus = await db.job.groupBy({ by: ["status"], _count: { status: true } });
  console.log("status dist:", byStatus.map((s) => `${s.status}=${s._count.status}`).join(", "));
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());

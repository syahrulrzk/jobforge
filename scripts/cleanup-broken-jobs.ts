// One-off cleanup: remove broken jobs (no source links) produced by the
// earlier bug, plus their related errors/logs. Safe to re-run.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const broken = await db.job.findMany({
    where: { jobLinks: { none: {} } },
    select: { id: true },
  });
  if (broken.length > 0) {
    const ids = broken.map((b) => b.id);
    await db.apiDelivery.deleteMany({ where: { jobId: { in: ids } } });
    await db.jobContact.deleteMany({ where: { jobId: { in: ids } } });
    await db.scrapeError.deleteMany({ where: { jobId: { in: ids } } });
    await db.job.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(`removed ${broken.length} broken jobs`);

  const fakeErrors = await db.scrapeError.deleteMany({
    where: { message: { contains: "Source Platform" } },
  });
  console.log(`removed ${fakeErrors.count} false error rows`);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());

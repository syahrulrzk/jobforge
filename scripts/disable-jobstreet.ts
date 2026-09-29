// One-off: matikan source JobStreet (user directive — scraping-nya bermasalah).
// Jalankan: bunx tsx scripts/disable-jobstreet.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const result = await db.source.updateMany({
    where: { slug: { in: ["jobstreet", "jobstreet-id"] } },
    data: { status: "INACTIVE", schedule: "manual" },
  });
  console.log(`JobStreet sources updated: ${result.count} → INACTIVE / manual`);
  const remaining = await db.source.findMany({ where: { status: "ACTIVE" }, select: { slug: true, name: true } });
  console.log("Active sources:", remaining.map((s) => s.slug).join(", ") || "(none)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

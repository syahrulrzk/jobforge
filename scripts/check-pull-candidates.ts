// Verifikasi cepat distribusi status job + kandidat pull (read-only)
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const g = await db.job.groupBy({ by: ["status"], _count: true });
  console.log(g.map((r) => `${r.status}: ${r._count}`).join("\n"));
  const readyPullable = await db.job.count({
    where: { status: "READY", pulledAt: null, contact: { isNot: null } },
  });
  console.log("\nREADY + belum di-pull + ada contact:", readyPullable);
  const sample = await db.job.findFirst({
    where: { status: "READY", pulledAt: null },
    include: { company: true, jobLinks: true, contact: true },
  });
  console.log("sample READY:", sample ? `${sample.code} company=${!!sample.company} links=${sample.jobLinks.length} contact=${!!sample.contact}` : "TIDAK ADA");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

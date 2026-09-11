// Cek state DB: daftar source + distribusi status job
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const sources = await db.source.findMany({
    orderBy: { createdAt: "asc" },
    select: { slug: true, name: true, status: true, engine: true, engines: true, scraperType: true, baseUrl: true },
  });
  console.log("=== SOURCES ===");
  for (const s of sources) {
    console.log(`${s.slug.padEnd(12)} | ${s.name.padEnd(14)} | ${s.status.padEnd(8)} | ${s.engine} | engines="${s.engines}" | ${s.scraperType} | ${s.baseUrl}`);
  }
  console.log("\n=== JOB STATUS DISTRIBUTION ===");
  const jobs = await db.job.groupBy({ by: ["status"], _count: true });
  for (const j of jobs) console.log(`${j.status}: ${j._count}`);
  console.log(`\nTotal jobs: ${await db.job.count()}`);
  console.log(`Total jobSources: ${await db.jobSource.count()}`);
}

main().finally(() => db.$disconnect());

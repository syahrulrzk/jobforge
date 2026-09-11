// E2E test flow NEEDS_ENRICHMENT (direktif user: job tetap masuk DB walau tanpa email HR)
// 1. Tambah source uji sementara (remotive — integrasi asli BOARD_SEARCHES)
// 2. Live search ke-1 → job baru: SCRAPED (ber-email) + NEEDS_ENRICHMENT (no email)
// 3. Live search ke-2 (query sama) → duplikat + recovery "enriched"
// 4. Inspeksi isi DB
// 5. Cleanup total (job + contact + link + source uji) — DB balik ke 5 source Indonesia
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://localhost:3000";

async function liveSearch(q: string, sources: string[]) {
  const res = await fetch(`${BASE}/api/search/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, sources }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`live search HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json as Record<string, any>;
}

async function main() {
  console.log("=== 0. STATE AWAL ===");
  console.log(`jobs sebelum: ${await db.job.count()}`);

  console.log("\n=== 1. Buat source uji remotive (sementara) ===");
  const src = await db.source.upsert({
    where: { slug: "remotive" },
    create: {
      slug: "remotive",
      name: "Remotive",
      baseUrl: "https://remotive.com",
      type: "PUBLIC_SOURCE",
      status: "ACTIVE",
      scraperType: "API",
      engine: "cheerio",
      engines: "cheerio",
      schedule: "manual",
    },
    update: { status: "ACTIVE" },
  });
  console.log(`source uji: ${src.slug} (${src.id})`);

  console.log("\n=== 2. Live search ke-1: 'developer' ===");
  const r1 = await liveSearch("developer", ["remotive"]);
  for (const b of r1.boards ?? []) {
    console.log(`board=${b.board} status=${b.status} engine=${b.engine} attempts=${(b.attempts ?? []).length}`);
    console.log(`  found=${b.found} created=${b.created} dup=${b.duplicate} needsEnrichment=${b.needsEnrichment} enriched=${b.enrichment ?? b.enriched} skipped=${b.skipped}`);
    if (b.error) console.log(`  error: ${b.error}`);
  }
  console.log(`total: created=${r1.totalCreated} dup=${r1.totalDuplicate} needsEnrichment=${r1.totalNeedsEnrichment} enriched=${r1.totalEnriched} found=${r1.totalFound}`);

  console.log("\n=== 3. Live search ke-2 (query sama — harus duplikat/recovery) ===");
  const r2 = await liveSearch("developer", ["remotive"]);
  console.log(`total: created=${r2.totalCreated} dup=${r2.totalDuplicate} needsEnrichment=${r2.totalNeedsEnrichment} enriched=${r2.totalEnriched} found=${r2.totalFound}`);

  console.log("\n=== 4. Inspeksi DB ===");
  const neJobs = await db.job.findMany({
    where: { status: "NEEDS_ENRICHMENT" },
    take: 5,
    orderBy: { scrapedAt: "desc" },
    include: { contact: true, jobLinks: { include: { source: true } } },
  });
  console.log(`-- sampel NEEDS_ENRICHMENT (${await db.job.count({ where: { status: "NEEDS_ENRICHMENT" } })} total) --`);
  for (const j of neJobs) {
    console.log(`  • ${j.title.slice(0, 55)} | company=${j.companyName ?? "-"} | contact=${j.contact ? j.contact.hrEmail : "TIDAK ADA (benar)"} | links=${j.jobLinks.map((l) => l.source.slug).join(",")}`);
    console.log(`    reason: ${(j.statusReason ?? "").slice(0, 110)}`);
  }
  const scrapedJobs = await db.job.findMany({
    where: { status: "SCRAPED" },
    take: 3,
    orderBy: { scrapedAt: "desc" },
    include: { contact: true },
  });
  console.log(`-- sampel SCRAPED (${await db.job.count({ where: { status: "SCRAPED" } })} total) --`);
  for (const j of scrapedJobs) {
    console.log(`  • ${j.title.slice(0, 55)} | contact=${j.contact?.hrEmail ?? "TIDAK ADA (SALAH!)"}`);
  }
  const orphanNe = await db.job.count({ where: { status: "NEEDS_ENRICHMENT", contact: null } });
  const neWithContact = await db.job.count({ where: { status: "NEEDS_ENRICHMENT", contact: { isNot: null } } });
  console.log(`-- invariant: NEEDS_ENRICHMENT tanpa contact=${orphanNe}, dengan contact=${neWithContact} --`);

  console.log("\n=== 5. Cleanup source uji + semua job test ===");
  const delContacts = await db.jobContact.deleteMany({});
  const delLinks = await db.jobSource.deleteMany({});
  const delJobs = await db.job.deleteMany({});
  const delRuns = await db.scrapeRun.deleteMany({ where: { sourceId: src.id } });
  const delSrc = await db.source.delete({ where: { id: src.id } });
  console.log(`hapus: contacts=${delContacts.count} links=${delLinks.count} jobs=${delJobs.count} runs=${delRuns.count} source=${delSrc.slug}`);
  const sourcesLeft = await db.source.findMany({ select: { slug: true, status: true } });
  console.log(`source tersisa: ${sourcesLeft.map((s) => `${s.slug}(${s.status})`).join(", ")}`);
  console.log(`jobs tersisa: ${await db.job.count()}`);

  console.log("\n=== 6. Restore status JobStreet ACTIVE (intent user) ===");
  await db.source.update({ where: { slug: "jobstreet" }, data: { status: "ACTIVE" } });
  console.log("jobstreet → ACTIVE (catatan: scheduler tick berikutnya bisa menandai ERROR lagi bila masih diblokir — perilaku jujur engine)");
}

main()
  .catch((e) => {
    console.error("TEST FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

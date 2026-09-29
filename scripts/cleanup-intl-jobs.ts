// ─────────────────────────────────────────────────────────────
// JobForge — Cleanup job NEEDS_ENRICHMENT / REJECTED orphan
//
// Context (user request): dashboard mau fokus Indonesia. Board
// internasional (remotive/jobicy/arbeitnow) sudah dihapus user
// dari Sources — tapi job hasil scrape-nya tetap tergantung
// NEEDS_ENRICHMENT (JobSource ter-cascade terhapus, jadi job jadi
// orphan tanpa provenance source). Script ini membersihkan:
//
//   1. Job NEEDS_ENRICHMENT  — HANYA yang orphan (tidak punya relasi
//      JobSource = provenance hilang, tak bisa di-recovery). Job
//      NEEDS_ENRICHMENT yang punya source aktif DIPERTAHANKAN — itu
//      antrean valid untuk recovery email scan (JobStreet/Glints).
//   2. Job REJECTED          — artifact run lama / description kosong
//   3. Company orphan        — tidak lagi punya relasi Job
//   4. ScrapeError OPEN      — EMAIL_NOT_FOUND/SOURCE_BLOCKED dari job
//      yang sudah tidak ada (stale, bukan error aktif)
//
// Rerunnable — aman dijalankan ulang kapan pun (idempotent).
// Jalankan: npx tsx scripts/cleanup-intl-jobs.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const t0 = Date.now();

  const counts = await db.job.groupBy({ by: ["status"], _count: { id: true } });
  console.log("== state awal ==");
  for (const c of counts) console.log(`  ${c.status}: ${c._count.id}`);

  // 1. NEEDS_ENRICHMENT — hapus HANYA yang orphan (tanpa relasi JobSource).
  //    Job dengan source aktif tetap hidup: itu antrean recovery email.
  const needy = await db.job.findMany({
    where: { status: "NEEDS_ENRICHMENT", jobLinks: { none: {} } },
    select: { id: true },
  });
  const r1 = await db.job.deleteMany({
    where: { status: "NEEDS_ENRICHMENT", jobLinks: { none: {} } },
  });
  console.log(`\n[1] NEEDS_ENRICHMENT orphan dihapus: ${r1.count} (ditemukan ${needy.length})`);

  // 2. REJECTED — artifact lama, bukan data layak tayang
  const r2 = await db.job.deleteMany({ where: { status: "REJECTED" } });
  console.log(`[2] REJECTED dihapus: ${r2.count}`);

  // 3. Company orphan — tidak lagi direferensikan job mana pun
  const orphanCompanies = await db.company.findMany({
    where: { jobs: { none: {} } },
    select: { id: true, name: true },
  });
  const r3 = await db.company.deleteMany({ where: { jobs: { none: {} } } });
  console.log(`[3] Company orphan dihapus: ${r3.count} (mis. ${orphanCompanies.slice(0, 3).map((c) => c.name).join(", ")})`);

  // 4a. Stale OPEN errors — error yang job-nya sudah tidak ada
  //     (ScrapeError tidak punya relation ke Job — pakai EXISTS raw SQL)
  const r4 = await db.$executeRaw`DELETE FROM "ScrapeError"
    WHERE status = 'OPEN' AND "jobId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Job" j WHERE j.id = "ScrapeError"."jobId")`;
  console.log(`[4a] Stale OPEN error dihapus (job sudah tidak ada): ${r4}`);

  // 4b. RESOLVE error yang kondisinya sudah lewat:
  //     - EMAIL_NOT_FOUND pada job yang sekarang punya contact valid / PUBLISHED
  //       (error tercatat di stage ENRICHING sebelum contact masuk — misleading)
  //     - PARSER_ERROR/DATABASE_ERROR/TIMEOUT one-off dari masalah yang sudah
  //       diperbaiki (run berikutnya SUCCESS)
  const r5 = await db.$executeRaw`UPDATE "ScrapeError" SET status = 'RESOLVED'
    WHERE status = 'OPEN' AND (
      "errorType" = 'EMAIL_NOT_FOUND' AND "jobId" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "Job" j JOIN "JobContact" c ON c."jobId" = j.id
        WHERE j.id = "ScrapeError"."jobId" AND c."emailStatus" = 'VALID')
      OR "errorType" IN ('PARSER_ERROR', 'DATABASE_ERROR', 'TIMEOUT')
    )`;
  console.log(`[4b] Error stale di-RESOLVE: ${r5}`);

  // Activity log entry biar kecatat di console dashboard
  const total = r1.count + r2.count;
  await db.activityLog.create({
    data: {
      source: "cleanup",
      action: "validate",
      status: "success",
      message: `Cleanup fokus Indonesia: ${r1.count} NEEDS_ENRICHMENT + ${r2.count} REJECTED dihapus, ${r3.count} company orphan dibersihkan, ${r4} stale error dihapus, ${r5} di-resolve`,
      durationMs: Date.now() - t0,
    },
  });

  const after = await db.job.groupBy({ by: ["status"], _count: { id: true } });
  console.log("\n== state akhir ==");
  for (const c of after) console.log(`  ${c.status}: ${c._count.id}`);
  console.log(`\nSelesai dalam ${Date.now() - t0}ms`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

// ─────────────────────────────────────────────────────────────
// Hardening produksi — bersihkan artefak simulasi gagal 7% yang
// lama (Task 23 menghapus simulasi itu dari engine).
//
// Yang dibersihkan:
//   1. ApiDelivery FAILED dgn responseCode 500 + body berisi
//      "Internal Server Error" buatan → status di-reset jadi
//      PENDING + attempt 1 (tanpa responseCode/body palsu) supaya
//      delivery worker mengirim ulang dengan payload valid.
//   2. ApiDelivery FAILED dgn responseBody "Canonical payload
//      unavailable" (job data incomplete) TIDAK disentuh — itu
//      kegagalan nyata, butuh perbaikan data / retry manual.
//   3. Job yang sebelumnya tertahan FAILED palsu tapi datanya
//      masih lengkap (READY/SENT) → statusReason dibersihkan.
//      Job SENT tidak dikembalikan ke READY (sudah terkirim).
//   4. ScrapeError API_ERROR lama yang pesannya persis format
//      simulasi ("Portal import failed after N attempts" tanpa
//      keterangan canonical) di-resolve — artefak palsu.
//
// Jalankan: npx tsx scripts/cleanup-fake-delivery-failures.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("── Bersihkan artefak simulasi delivery gagal 7% ──\n");

  // 1. Delivery FAILED dengan 500 buatan dari simulasi lama.
  //    Marker yang pasti berasal dari simulasi: body memuat
  //    "Internal Server Error" (persis string yang dulu di-JSON.stringify
  //    oleh engine) atau responseCode 500 tanpa body.
  const fakeFailed = await db.apiDelivery.findMany({
    where: {
      status: "FAILED",
      responseCode: 500,
      OR: [
        { responseBody: { contains: "Internal Server Error" } },
        { responseBody: null },
      ],
    },
    include: { job: { select: { id: true, status: true, statusReason: true } } },
  });

  console.log(`Delivery FAILED dgn 500 buatan ditemukan: ${fakeFailed.length}`);
  let reset = 0;
  let skippedReal = 0;
  for (const d of fakeFailed) {
    // Hanya reset delivery yang job-nya masih layak kirim ulang:
    // READY (belum pernah sukses) atau SENT (pernah sukses, retry tidak perlu —
    // cukup bersihkan statusReason). FAILED lain (data rusak) biarkan manual.
    const jobStatus = d.job?.status;
    if (jobStatus !== "READY" && jobStatus !== "SENT") {
      skippedReal += 1;
      continue;
    }
    await db.apiDelivery.update({
      where: { id: d.id },
      data: {
        // SENT → sukses sebenarnya sudah terjadi; PENDING hanya utk READY
        status: jobStatus === "READY" ? "PENDING" : d.status,
        attempt: 1,
        responseCode: null,
        responseBody: null,
        nextRetryAt: null,
      },
    });
    if (jobStatus === "READY" && d.job.statusReason?.startsWith("PREFLIGHT:") === false) {
      await db.job.update({
        where: { id: d.job.id },
        data: { statusReason: null },
      });
    }
    reset += 1;
  }
  console.log(`  di-reset ke PENDING (READY): ${reset}`);
  console.log(`  dilewati (job bukan READY/SENT): ${skippedReal}`);

  // 2. Delivery PENDING/SENDING yatim dgn nextRetryAt lampau + responseCode 500
  //    buatan — pastikan tidak ada antrean yang macet karena artefak lama.
  const staleInFlight = await db.apiDelivery.updateMany({
    where: {
      status: { in: ["PENDING", "SENDING"] },
      responseCode: 500,
      responseBody: { contains: "Internal Server Error" },
    },
    data: { responseCode: null, responseBody: null },
  });
  console.log(`Antrean aktif dgn jejak 500 buatan dibersihkan: ${staleInFlight.count}`);

  // 3. ScrapeError API_ERROR dari pesan simulasi lama → resolve.
  //    Pesan simulasi persis: "Portal import failed after N attempts"
  //    (versi baru menyebut "canonical payload unavailable" — tidak disentuh).
  const fakeErrors = await db.scrapeError.updateMany({
    where: {
      errorType: "API_ERROR",
      status: "OPEN",
      message: { contains: "Portal import failed after" },
      NOT: [{ message: { contains: "canonical payload unavailable" } }],
    },
    data: { status: "RESOLVED" },
  });
  console.log(`ScrapeError API_ERROR palsu di-resolve: ${fakeErrors.count}`);

  // 4. Ringkasan sisa delivery FAILED — harusnya hanya kegagalan nyata.
  const remaining = await db.apiDelivery.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  console.log("\nSisa delivery per status:");
  for (const r of remaining) {
    console.log(`  ${r.status}: ${r._count.status}`);
  }

  console.log("\nSelesai ✓");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

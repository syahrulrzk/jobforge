// ─────────────────────────────────────────────────────────────
// Hardening produksi — hapus artefak pipeline delivery lama
// (sebelum pre-flight gate Task 21): ApiDelivery FAILED dengan
// responseCode 422 buatan (payload cacat dulu dikirim lalu ditolak
// portal). Persetujuan user: hapus SEMUA baris FAILED 422.
//
// Aman terhadap dedup portal: processBulkImport (portal.ts) hanya
// menghitung dedup dari delivery SUCCESS — baris FAILED tidak
// dipakai, jadi menghapusnya tidak memicu duplikat.
//
// Yang TIDAK disentuh:
//   - Delivery SUCCESS (riwayat terkirim, dipakai dedup)
//   - FAILED non-422 (kegagalan nyata, mis. canonical unavailable)
//   - Status job (READY tetap READY → gate Task 21 yang menentukan;
//     PUBLISHED tidak disentuh sama sekali)
//
// Jalankan: npx tsx scripts/cleanup-failed422-deliveries.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("── Hapus delivery FAILED 422 (artefak pipeline lama) ──\n");

  const found = await db.apiDelivery.findMany({
    where: { status: "FAILED", responseCode: 422 },
    select: { id: true, jobId: true },
  });
  console.log(`FAILED 422 ditemukan: ${found.length}`);

  if (found.length === 0) {
    console.log("Tidak ada yang perlu dihapus — selesai ✓");
    return;
  }

  const jobIds = [...new Set(found.map((d) => d.jobId))];

  const deleted = await db.apiDelivery.deleteMany({
    where: { status: "FAILED", responseCode: 422 },
  });
  console.log(`Dihapus: ${deleted.count}`);

  // Ringkasan: job yang tadinya kejangkit stat failed — dengan gate Task 21,
  // job READY yang valid otomatis dibuatkan delivery baru oleh tick berikutnya;
  // yang cacat ditahan + badge PREFLIGHT di tabel Jobs.
  const jobStatuses = await db.job.groupBy({
    by: ["status"],
    where: { id: { in: jobIds } },
    _count: { status: true },
  });
  console.log("\nStatus job terdampak (tidak diubah):");
  for (const s of jobStatuses) {
    console.log(`  ${s.status}: ${s._count.status}`);
  }

  const remaining = await db.apiDelivery.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  console.log("\nDelivery per status sekarang:");
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

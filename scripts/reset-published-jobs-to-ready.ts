// ─────────────────────────────────────────────────────────────
// Reset job PUBLISHED (artefak era simulasi) ke READY.
//
// Konteks: 242 job asli hasil scrape Dealls nyangkut di status
// PUBLISHED — status "terkirim" dari mesin simulasi lama, padahal
// belum pernah dikirim sebagai HTTP POST nyata ke portal. Setelah
// delivery real HTTP aktif, job-job ini di-reset ke READY supaya
// delivery worker mengangkutnya ke portal (mis. Karivia).
//
// Aman:
//   - Hanya menyentuh job PUBLISHED; SENT/READY/FAILED dll tidak
//     disentuh.
//   - deliveredAt dikosongkan lagi (belum ada delivery nyata).
//   - publishedAt dikosongkan (artefak simulasi).
//   - Tidak ada data job yang diubah/dihapus — status saja.
//   - Tick engine berikutnya otomatis membuat ApiDelivery baru
//     untuk job READY (burst BATCH_SIZE per tick).
//
// Jalankan: npx tsx scripts/reset-published-jobs-to-ready.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("── Reset job PUBLISHED → READY ──\n");

  const found = await db.job.count({ where: { status: "PUBLISHED" } });
  console.log(`Job PUBLISHED ditemukan: ${found}`);

  if (found === 0) {
    console.log("Tidak ada yang perlu di-reset — selesai ✓");
    return;
  }

  const updated = await db.job.updateMany({
    where: { status: "PUBLISHED" },
    data: { status: "READY", statusReason: null, publishedAt: null },
  });
  console.log(`Di-reset ke READY    : ${updated.count}`);
  console.log("\nSelesai ✓ — delivery worker akan mengirim bertahap (BATCH_SIZE per tick).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

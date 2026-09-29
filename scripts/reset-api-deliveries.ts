// ─────────────────────────────────────────────────────────────
// Reset tabel ApiDelivery — hapus SEMUA riwayat delivery lama.
//
// Konteks: semua baris existing adalah artefak era simulasi
// (delivery belum pernah keluar sebagai HTTP POST beneran ke
// Karivia). Setelah delivery real HTTP aktif, tabel ini di-reset
// supaya tracking mulai bersih — baris baru hanya berasal dari
// POST nyata ke JOB_PORTAL_API_URL.
//
// Aman:
//   - Job tidak disentuh (status tetap READY/SENT/PUBLISHED).
//   - In-flight delivery (PENDING/SENDING) ikut terhapus —
//     tick berikutnya bakal membuat delivery baru untuk job
//     READY yang memenuhi syarat (dedup via JobSource tetap jalan).
//   - processBulkImport fallback memakai delivery SUCCESS untuk
//     dedup; setelah reset, fallback akan menghitung semua job
//     sebagai created — hanya relevan saat kredensial portal
//     dikosongkan (mode simulasi).
//
// Jalankan: npx tsx scripts/reset-api-deliveries.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const before = await db.apiDelivery.count();
  console.log(`── Reset ApiDelivery ──`);
  console.log(`Baris ditemukan : ${before}`);

  if (before === 0) {
    console.log("Tabel sudah kosong — tidak ada yang perlu dihapus ✓");
    return;
  }

  const deleted = await db.apiDelivery.deleteMany({});
  console.log(`Baris dihapus   : ${deleted.count}`);
  console.log("Selesai — tracking delivery mulai bersih ✓");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

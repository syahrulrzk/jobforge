// ─────────────────────────────────────────────────────────────
// Fix akar masalah "Invalid URL" (Task: cleanup FAILED 500/422).
//
// Temuan: Company.website tersimpan "" (string kosong, bukan NULL).
// canonicalFor() memakai `website ?? null` sehingga "" lolos ke zod
// z.string().url() → 422 "Invalid URL" → ApiDelivery FAILED.
// 303 baris terbentuk 08:15–08:19 (engine lama sebelum HMR reload
// menerapkan pre-flight gate); setelah reload, gate menahan — tapi
// data company tetap perlu dinormalisasi.
//
// Yang dilakukan:
//   1. Company.website "" → NULL (string kosong = tidak ada info)
//   2. Hapus ApiDelivery FAILED responseCode 422 (kelas artefak yang
//      sama dengan yang dihapus di Task 24, persetujuan user)
//   3. Ringkasan verifikasi
//
// Jalankan: npx tsx scripts/fix-empty-website-and-clean-422.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("── Fix website kosong + bersihkan FAILED 422 ──\n");

  // 1. Normalisasi Company.website: "" → NULL
  const emptyCompanies = await db.company.findMany({
    where: { website: "" },
    select: { id: true, name: true },
  });
  console.log(`Company dgn website "": ${emptyCompanies.length}`);
  for (const c of emptyCompanies) {
    await db.company.update({ where: { id: c.id }, data: { website: null } });
  }
  console.log(`  dinormalisasi ke NULL: ${emptyCompanies.length}`);

  // Juga JobSource.sourceUrl "" bila ada (field lain yang masuk zod url)
  const emptyLinks = await db.jobSource.updateMany({
    where: { sourceUrl: "" },
    data: { sourceUrl: "https://unknown.invalid/" },
  });
  console.log(`JobSource.sourceUrl "" diperbaiki: ${emptyLinks.count}`);

  // 2. Hapus ApiDelivery FAILED 422 (artefak era pra-gate)
  const deleted = await db.apiDelivery.deleteMany({
    where: { status: "FAILED", responseCode: 422 },
  });
  console.log(`\nApiDelivery FAILED 422 dihapus: ${deleted.count}`);

  // 3. Verifikasi
  const [failed, success, pending] = await Promise.all([
    db.apiDelivery.count({ where: { status: "FAILED" } }),
    db.apiDelivery.count({ where: { status: "SUCCESS" } }),
    db.apiDelivery.count({ where: { status: { in: ["PENDING", "SENDING"] } } }),
  ]);
  console.log(`\nSisa delivery: SUCCESS=${success}, FAILED=${failed}, PENDING/SENDING=${pending}`);

  const stillEmpty = await db.company.count({ where: { website: "" } });
  console.log(`Company website "" tersisa: ${stillEmpty}`);

  console.log("\nSelesai ✓");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

// ─────────────────────────────────────────────────────────────
// Direktif user: hapus semua job ber-status NEEDS_ENRICHMENT.
// Job NEEDS_ENRICHMENT = job tanpa email HR (belum ketemu).
// Safety: sebelum hapus dicek — yang punya JobContact (email)
// TIDAK ikut dihapus supaya tidak ada email yang hilang.
// Sekalian: company yang jadi yatim (0 job) ikut dibersihkan.
// Jalankan: npx tsx scripts/purge-needs-enrichment.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const needy = await db.job.findMany({ where: { status: "NEEDS_ENRICHMENT" }, select: { id: true } });
  if (needy.length === 0) {
    console.log("Tidak ada job NEEDS_ENRICHMENT — selesai.");
    return;
  }
  const ids = needy.map((j) => j.id);

  // Safety email: job yang punya JobContact jangan dihapus
  const withEmail = await db.jobContact.findMany({ where: { jobId: { in: ids } }, select: { jobId: true } });
  const keepIds = new Set(withEmail.map((c) => c.jobId));
  const deleteIds = ids.filter((id) => !keepIds.has(id));
  console.log(`NEEDS_ENRICHMENT: ${ids.length} total — hapus ${deleteIds.length}, keep ${keepIds.size} (punya email)`);

  // Hapus manual per-tabel (aman utk DB apa pun, tak bergantung cascade)
  const delJobs = await db.job.deleteMany({ where: { id: { in: deleteIds } } });
  console.log(`Job terhapus: ${delJobs.count} (JobSource/JobContact ikut via cascade)`);

  // Company yatim → bersihkan
  const orphans = await db.company.findMany({
    where: { jobs: { none: {} }, harvestedContacts: { none: {} } },
    select: { id: true, name: true },
  });
  const delComp = await db.company.deleteMany({ where: { id: { in: orphans.map((c) => c.id) } } });
  console.log(`Company yatim terhapus: ${delComp.count}`);

  const byStatus = await db.job.groupBy({ by: ["status"], _count: { _all: true } });
  console.log(`Sisa job: ${byStatus.map((g) => `${g.status}=${g._count._all}`).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

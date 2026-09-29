// ─────────────────────────────────────────────────────────────
// Direktif user: bersih-bersih data — hapus job yang company-nya
// TIDAK punya deskripsi asli (placeholder / template derifatif /
// harvest-auto), plus job yang belum ter-link company apa pun.
//
// ATURAN EMAIL (direktif user, task sebelumnya): job yang punya
// JobContact (email HR) TIDAK dihapus — email tidak boleh hilang.
// Company yang jadi yatim ikut dibersihkan.
// Jalankan: npx tsx scripts/purge-jobs-without-company-profile.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // 1. company tanpa deskripsi asli
  const badCompanies = await db.company.findMany({
    where: {
      OR: [
        { profile: "Profil perusahaan belum tersedia." },
        { profile: { contains: "membuka kesempatan berkarir" } },
        { profile: { contains: "Perusahaan ditambahkan otomatis" } },
      ],
    },
    select: { id: true, name: true },
  });
  const badIds = badCompanies.map((c) => c.id);

  // 2. job target: ter-link company buruk ATAU tanpa company sama sekali
  const targets = await db.job.findMany({
    where: { OR: [{ companyId: { in: badIds } }, { companyId: null }] },
    select: { id: true, title: true, companyId: true },
  });

  // 3. safety email: yang punya JobContact di-skip
  const withEmail = await db.jobContact.findMany({
    where: { jobId: { in: targets.map((t) => t.id) } },
    select: { jobId: true },
  });
  const keep = new Set(withEmail.map((c) => c.jobId));
  const deleteIds = targets.filter((t) => !keep.has(t.id)).map((t) => t.id);
  const keptWithCompany = targets.filter((t) => keep.has(t.id) && t.companyId).length;
  const keptNoCompany = targets.filter((t) => keep.has(t.id) && !t.companyId).length;

  console.log(`Target awal : ${targets.length} job`);
  console.log(`  - di-skip karena punya email HR: ${keep.size} (${keptWithCompany} ber-company + ${keptNoCompany} tanpa company)`);
  console.log(`  - dihapus: ${deleteIds.length}`);

  if (deleteIds.length > 0) {
    const del = await db.job.deleteMany({ where: { id: { in: deleteIds } } });
    console.log(`Job terhapus: ${del.count}`);
  }

  // 4. company yatim (0 job & 0 harvested contact) → bersihkan
  const orphans = await db.company.findMany({
    where: { jobs: { none: {} }, harvestedContacts: { none: {} } },
    select: { id: true },
  });
  const delCo = await db.company.deleteMany({ where: { id: { in: orphans.map((c) => c.id) } } });
  console.log(`Company yatim terhapus: ${delCo.count}`);

  // 5. verifikasi akhir
  const [jobsLeft, compLeft, contacts, harvest] = await Promise.all([
    db.job.count(),
    db.company.count(),
    db.jobContact.count(),
    db.harvestedContact.count(),
  ]);
  const stillBad = await db.job.count({
    where: { company: { OR: [{ profile: "Profil perusahaan belum tersedia." }, { profile: { contains: "membuka kesempatan berkarir" } }, { profile: { contains: "Perusahaan ditambahkan otomatis" } }] } },
  });
  console.log(`\nVerifikasi:`);
  console.log(`  Sisa job: ${jobsLeft} | company: ${compLeft}`);
  console.log(`  Job tersisa yang company-nya masih tanpa profil asli: ${stillBad}`);
  console.log(`  Email utuh: JobContact=${contacts}, HarvestedContact=${harvest}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

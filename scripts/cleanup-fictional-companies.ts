// One-off cleanup: remove fictional companies + their jobs that were
// re-created by the stale engine process during the real-data migration window.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const FICTIONAL = [
  "PT Sinar Digital Indonesia", "PT Nusantara Teknologi Kreatif", "PT Global Media Anti",
  "PT Andalan Fintech Group", "PT Maju E-Commerce Sentosa", "PT Bumi Logistik Prima",
  "PT Cerdas Data Analytics", "PT Sehat Digital Medika", "PT Pintar Edukasi Nusantara",
  "PT Kreatif Studio Digital", "PT Trans Otomotif Indonesia", "PT Hijau Energi Terbarukan",
  "PT Wisata Travelindo", "PT Aman Asuransi Jiwa", "PT Cepat Kurir Kilat",
  "PT Bank Digital Harapan", "PT Rasa Kuliner Group", "PT Amanah Properti Utama",
  "PT Tangguh Keamanan Siber", "PT Cerdik Game Studios", "PT Ramah Lingkungan Pack",
  "PT Prestasi Konsultan Manajemen", "PT Cepat Telekomunikasi Molde", "PT Satu Agri Teknologi",
  "PT Unggul Konstruksi Bina", "PT Melati Kosmetik Alami", "PT Prima Otomasi Sistem",
  "PT Harmoni Event Organizer", "PT Andal Sport Digital", "PT Mitra Layanan Biro",
];

async function main() {
  const companies = await db.company.findMany({
    where: { name: { in: FICTIONAL } },
    select: { id: true, name: true },
  });
  console.log(`Fictional companies to remove: ${companies.length}`);

  let jobs = 0;
  for (const c of companies) {
    const delJobs = await db.job.deleteMany({ where: { companyId: c.id } });
    jobs += delJobs.count;
    await db.company.delete({ where: { id: c.id } });
  }
  console.log(`Deleted jobs: ${jobs}, companies: ${companies.length}`);

  const remaining = await db.company.count();
  const fictionalLeft = await db.company.count({ where: { name: { in: FICTIONAL } } });
  console.log(`Companies remaining: ${remaining} | fictional left: ${fictionalLeft}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

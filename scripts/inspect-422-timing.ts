// Rentang waktu + pola website kosong pada FAILED 422 — apakah masih terbentuk sekarang?
// Jalankan: npx tsx scripts/inspect-422-timing.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const rows = await db.apiDelivery.findMany({
    where: { status: "FAILED", responseCode: 422 },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (rows.length === 0) {
    console.log("Tidak ada FAILED 422.");
    return;
  }
  const first = rows[0].createdAt;
  const last = rows[rows.length - 1].createdAt;
  console.log(`Jumlah  : ${rows.length}`);
  console.log(`Pertama : ${first.toISOString()}`);
  console.log(`Terakhir: ${last.toISOString()}`);

  // Distribusi website kosong/null pada company dari job terdampak
  const deliveries = await db.apiDelivery.findMany({
    where: { status: "FAILED", responseCode: 422 },
    select: { job: { select: { company: { select: { website: true } } } } },
  });
  let emptyWeb = 0;
  let nullWeb = 0;
  let hasWeb = 0;
  let noCompany = 0;
  for (const d of deliveries) {
    const w = d.job?.company?.website;
    if (w === undefined) noCompany += 1;
    else if (w === null) nullWeb += 1;
    else if (w === "") emptyWeb += 1;
    else hasWeb += 1;
  }
  console.log(`\nCompany website: kosong("")=${emptyWeb}, null=${nullWeb}, terisi=${hasWeb}, tanpa company=${noCompany}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

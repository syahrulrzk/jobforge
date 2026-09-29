// Lihat logoUrl perusahaan dari job yang delivery-nya FAILED 422
import { db } from "@/lib/db";

async function main() {
  const failed = await db.apiDelivery.findMany({
    where: { status: "FAILED", responseCode: 422 },
    take: 30,
    include: { job: { include: { company: { select: { id: true, name: true, logoUrl: true, website: true } } } } },
  });
  const seen = new Set<string>();
  console.log("── Company logoUrl dari delivery FAILED 422 ──\n");
  for (const d of failed) {
    const c = d.job.company;
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    console.log(`${c.name}`);
    console.log(`  logoUrl : ${JSON.stringify(c.logoUrl)}`);
    console.log(`  website : ${JSON.stringify(c.website)}`);
  }

  // Ringkasan semua company READY job: berapa yang logoUrl kosong / aneh
  const readyJobs = await db.job.findMany({
    where: { status: "READY" },
    include: { company: { select: { id: true, name: true, logoUrl: true } } },
  });
  const empty = new Map<string, string>();
  for (const j of readyJobs) {
    if (j.company && (!j.company.logoUrl || j.company.logoUrl.trim() === "")) {
      empty.set(j.company.id, j.company.name);
    }
  }
  console.log(`\n── READY jobs: ${readyJobs.length}, company dgn logo KOSONG: ${empty.size} ──`);
  for (const [id, name] of [...empty.entries()].slice(0, 10)) console.log(`  ${name} (${id})`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

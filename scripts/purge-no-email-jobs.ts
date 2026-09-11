// One-time cleanup — enforce the email-mandatory rule (user request):
// "disimpan db kita wajib ada emailnya, klo gada jangan disimpan (spam)"
//
// Deletes every real-source job stuck in NEEDS_ENRICHMENT without a JobContact
// (i.e. no HR email was ever discovered). Jobs in earlier stages (SCRAPED,
// PROCESSING, ENRICHING, VALIDATING) are left alone — the new pipeline purges
// them naturally within a tick or two.
//
// Run: npx tsx scripts/purge-no-email-jobs.ts

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const byStatus = await db.job.groupBy({ by: ["status"], _count: true });
  console.log("=== Job stock by status (before) ===");
  for (const g of byStatus) console.log(`  ${g.status}: ${g._count}`);

  const noEmail = await db.job.count({ where: { status: "NEEDS_ENRICHMENT", contact: null } });
  const withEmail = await db.job.count({ where: { contact: { isNot: null } } });
  console.log(`\nNEEDS_ENRICHMENT tanpa contact (akan dihapus): ${noEmail}`);
  console.log(`Job dengan email (dipertahankan): ${withEmail}`);

  const res = await db.job.deleteMany({
    where: { status: "NEEDS_ENRICHMENT", contact: null },
  });
  console.log(`\nDeleted: ${res.count}`);

  const after = await db.job.groupBy({ by: ["status"], _count: true });
  console.log("\n=== Job stock by status (after) ===");
  for (const g of after) console.log(`  ${g.status}: ${g._count}`);

  const totalNoContact = await db.job.count({ where: { contact: null } });
  console.log(`\nSisa job tanpa contact (in-flight pipeline, akan diproses engine baru): ${totalNoContact}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

// Lihat responseBody PENUH satu delivery FAILED 422 — cari field URL mana yang invalid.
// Jalankan: npx tsx scripts/inspect-one-failed422.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const d = await db.apiDelivery.findFirst({
    where: { status: "FAILED", responseCode: 422 },
    orderBy: { createdAt: "desc" },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          jobLinks: { select: { sourceUrl: true, sourceJobId: true } },
          company: { select: { name: true, website: true, logoUrl: true } },
          contact: { select: { hrEmail: true, emailSourceUrl: true } },
        },
      },
    },
  });
  if (!d) {
    console.log("Tidak ada FAILED 422.");
    return;
  }
  console.log("createdAt :", d.createdAt);
  console.log("requestId :", d.requestId);
  console.log("attempt   :", d.attempt);
  console.log("response  :", d.responseBody);
  console.log("\nJob:", d.job?.title);
  console.log("sourceUrl   :", JSON.stringify(d.job?.jobLinks[0]?.sourceUrl));
  console.log("companyWeb  :", JSON.stringify(d.job?.company?.website));
  console.log("logoUrl     :", JSON.stringify(d.job?.company?.logoUrl));
  console.log("emailSource :", JSON.stringify(d.job?.contact?.emailSourceUrl));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

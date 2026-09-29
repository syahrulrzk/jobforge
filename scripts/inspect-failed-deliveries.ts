// Inspeksi read-only: dari mana 978 delivery FAILED berasal?
// Jalankan: npx tsx scripts/inspect-failed-deliveries.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const failed = await db.apiDelivery.findMany({
    where: { status: "FAILED" },
    select: { responseCode: true, responseBody: true, attempt: true, job: { select: { status: true, statusReason: true } } },
  });
  console.log(`Total FAILED: ${failed.length}\n`);

  const byCode: Record<string, number> = {};
  for (const d of failed) {
    const key = `${d.responseCode ?? "null"} | ${d.responseBody ? d.responseBody.slice(0, 60) : "(no body)"}`;
    byCode[key] = (byCode[key] ?? 0) + 1;
  }
  console.log("Distribusi responseCode + potongan body:");
  for (const [k, v] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(4)} × ${k}`);
  }

  const byJobStatus: Record<string, number> = {};
  for (const d of failed) {
    byJobStatus[d.job?.status ?? "?"] = (byJobStatus[d.job?.status ?? "?"] ?? 0) + 1;
  }
  console.log("\nDistribusi status job dari delivery FAILED:");
  for (const [k, v] of Object.entries(byJobStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(4)} × ${k}`);
  }

  const byAttempt: Record<number, number> = {};
  for (const d of failed) byAttempt[d.attempt] = (byAttempt[d.attempt] ?? 0) + 1;
  console.log("\nDistribusi attempt:");
  for (const [k, v] of Object.entries(byAttempt).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  attempt ${k}: ${v}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

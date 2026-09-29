// Seed 1 job READY lengkap untuk uji pull API (§19b)
// Jalankan: npx tsx scripts/seed-ready-job.ts "[Uji] Backend Engineer Pull API"
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const db = new PrismaClient();

async function main() {
  const title = process.argv[2] ?? "[Uji Pull] Backend Engineer";
  const fp = createHash("sha256").update(`uji-pull-co|${title}|jakarta`).digest("hex");

  const existing = await db.job.findUnique({ where: { fingerprint: fp } });
  if (existing) {
    console.log("Job uji sudah ada:", existing.code, existing.status, "pulledAt:", existing.pulledAt?.toISOString() ?? "-");
    return;
  }

  // sequence code via raw (kolom punya default nextval) — biarkan DB generate
  const company = await db.company.upsert({
    where: { normalizedName: "uji pull co" },
    update: {},
    create: {
      name: "Uji Pull Co",
      normalizedName: "uji pull co",
      logoUrl: "https://www.google.com/s2/favicons?domain=uji-pull.co&sz=128",
      website: "https://uji-pull.co",
      profile: "Perusahaan dummy untuk pengujian API pull.",
    },
  });

  let source = await db.source.findFirst({ where: { slug: "remotive" } });
  if (!source) {
    source = await db.source.create({
      data: { slug: "remotive", name: "Remotive", baseUrl: "https://remotive.com" },
    });
  }

  // alokasi code readable via sequence (sama dgn allocateJobCode di app):
  // sync dulu ke melewati nomor terbesar yang sudah terpakai, baru nextval
  await db.$executeRawUnsafe("CREATE SEQUENCE IF NOT EXISTS job_code_seq START 1");
  await db.$executeRawUnsafe(
    "SELECT setval('job_code_seq', GREATEST((SELECT COALESCE(MAX(SUBSTRING(code FROM 6)::int), 0) FROM \"Job\" WHERE code ~ '^JOBS[0-9]+$'), 1))"
  );
  const seqRows = await db.$queryRawUnsafe<{ next: bigint }>("SELECT nextval('job_code_seq') AS next");
  const code = `JOBS${String(Number(seqRows[0].next)).padStart(5, "0")}`;

  const job = await db.job.create({
    data: {
      code,
      fingerprint: fp,
      title,
      normalizedTitle: title.toLowerCase(),
      companyName: "Uji Pull Co",
      companyLogoUrl: company.logoUrl,
      description: "Deskripsi lowongan uji untuk memastikan pull API mengembalikan payload canonical yang valid.",
      location: "Jakarta",
      employmentType: "FULL_TIME",
      workplaceType: "HYBRID",
      requirements: JSON.stringify(["3+ tahun backend", "Node.js/TypeScript"]),
      skills: JSON.stringify(["nodejs", "typescript", "postgresql"]),
      status: "READY",
      companyId: company.id,
      jobLinks: {
        create: { sourceId: source.id, sourceJobId: `uji-${Date.now()}`, sourceUrl: "https://uji-pull.co/jobs/uji-pull" },
      },
      contact: {
        create: { hrEmail: "hr@uji-pull.co", emailStatus: "VALID", emailVerified: true },
      },
    },
  });
  console.log("Job READY dibuat (menunggu lease):", job.code, job.id);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

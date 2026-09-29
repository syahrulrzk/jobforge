// ─────────────────────────────────────────────────────────────
// Direktif user: fokus scraping job ke Dealls saja.
// Hapus source JobStreet/Glints/LinkedIn + seluruh job yang
// ter-link ke ketiganya (cascade JobSource → Job).
//
// PENTING (direktif user): EMAIL TIDAK BOLEH HILANG.
// Sebelum source dihapus, semua JobContact (email HR) milik job
// dari portal tsb dipindah ke HarvestedContact — gudang email
// yang dipakai fitur Cari Email / Harvest. Fitur Cari Email
// (email-finder, people search, harvest) tidak disentuh sama sekali.
//
// Jalankan: npx tsx scripts/cleanup-focus-dealls.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const sources = await db.source.findMany({
    where: {
      OR: [
        { slug: { contains: "jobstreet" } },
        { slug: { contains: "glints" } },
        { slug: { contains: "linkedin" } },
      ],
    },
  });

  if (sources.length === 0) {
    console.log("Tidak ada source jobstreet/glints/linkedin di DB — selesai.");
    return;
  }
  console.log(`Target source: ${sources.map((s) => `${s.slug}[${s.status}]`).join(", ")}`);

  const ids = sources.map((s) => s.id);
  const links = await db.jobSource.findMany({
    where: { sourceId: { in: ids } },
    select: { jobId: true },
  });
  const jobIds = [...new Set(links.map((l) => l.jobId))];
  console.log(`Job ter-link ke 3 portal ini: ${jobIds.length}`);

  // ── 1. SELAMATKAN EMAIL: JobContact → HarvestedContact ──
  const contacts = await db.jobContact.findMany({
    where: { jobId: { in: jobIds } },
    include: { job: { select: { companyName: true, company: { select: { id: true, name: true } } } } },
  });
  let saved = 0;
  for (const c of contacts) {
    const domain =
      (c.emailSourceUrl?.match(/https?:\/\/([^/]+)/)?.[1] ?? c.hrEmail.split("@")[1] ?? "")
        .replace(/^www\./, "")
        .toLowerCase();
    if (!domain.includes(".")) continue;
    try {
      await db.harvestedContact.upsert({
        where: { email: c.hrEmail },
        update: { updatedAt: new Date() },
        create: {
          email: c.hrEmail,
          domain,
          companyId: c.job?.company?.id ?? null,
          kind: "role",
          category: "HR/Rekrutmen",
          via: "pipeline",
          sourceUrl: c.emailSourceUrl ?? null,
          sourcesJson: JSON.stringify([c.emailSourceUrl ?? `https://${domain}`]),
        },
      });
      saved += 1;
    } catch {
      // dup race — email sudah ada di gudang, aman
    }
  }
  console.log(`Email HR dipindah ke HarvestedContact (gudang email): ${saved}/${contacts.length}`);

  // ── 2. Hapus source — cascade: JobSource → Job → JobContact/ApiDelivery/ScrapeRun ──
  for (const s of sources) {
    const runs = await db.scrapeRun.count({ where: { sourceId: s.id } });
    await db.source.delete({ where: { id: s.id } });
    console.log(`Source dihapus: ${s.slug} (scrape runs ikut terhapus: ${runs})`);
  }

  // ── 3. Verifikasi ──
  const [jobs, contactsLeft, harvest, sourcesLeft] = await Promise.all([
    db.job.count(),
    db.jobContact.count(),
    db.harvestedContact.count(),
    db.source.findMany({ select: { slug: true, status: true } }),
  ]);
  console.log(`\nVerifikasi:`);
  console.log(`  Sisa source : ${sourcesLeft.map((s) => s.slug).join(", ") || "-"}`);
  console.log(`  Total job   : ${jobs}`);
  console.log(`  JobContact  : ${contactsLeft} (email di job Dealls dkk — tidak disentuh)`);
  console.log(`  Harvested   : ${harvest} (gudang email Cari Email — aman)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

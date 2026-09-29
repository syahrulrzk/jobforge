// Audit data yang dikirim ke portal — verifikasi field wajib:
// deskripsi, email HR, logo (URL publik valid). Juga cek hasil kirim ulang
// delivery yang di-reset setelah fix logo 422.
// Jalankan: npx tsx scripts/audit-sent-payload-quality.ts
import { db } from "@/lib/db";

async function main() {
  // 1. Hasil kirim ulang — distribusi status delivery sekarang
  const byStatus = await db.apiDelivery.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("── Distribusi delivery sekarang ──");
  for (const s of byStatus) console.log(`  ${s.status}: ${s._count._all}`);

  const stillFailed = await db.apiDelivery.findMany({
    where: { status: "FAILED" },
    take: 5,
    orderBy: { createdAt: "desc" },
    select: { responseCode: true, responseBody: true, createdAt: true },
  });
  console.log(`\n── FAILED tersisa: ${stillFailed.length > 0 ? "ADA (5 contoh terbaru):" : "0 ✓"}`);
  for (const f of stillFailed) {
    console.log(`  [${f.createdAt.toISOString()}] HTTP ${f.responseCode ?? "network"} — ${(f.responseBody ?? "").slice(0, 120)}`);
  }

  // 2. Audit job yang terkirim sukses (delivery terbaru per job)
  const recentSuccess = await db.apiDelivery.findMany({
    where: { status: "SUCCESS" },
    orderBy: { deliveredAt: "desc" },
    take: 120,
    include: {
      job: {
        include: {
          company: { select: { name: true, logoUrl: true, website: true } },
          contact: { select: { hrEmail: true, emailVerified: true } },
        },
      },
    },
  });

  const problems = { noDesc: [] as string[], shortDesc: [] as string[], noEmail: [] as string[], badLogo: [] as string[] };
  let checked = 0;
  const seen = new Set<string>();
  for (const d of recentSuccess) {
    const j = d.job;
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    checked += 1;
    const descLen = j.description?.length ?? 0;
    if (descLen === 0) problems.noDesc.push(j.title);
    else if (descLen < 30) problems.shortDesc.push(`${j.title} (${descLen})`);
    if (!j.contact?.hrEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(j.contact.hrEmail)) problems.noEmail.push(j.title);
    const logo = j.company?.logoUrl ?? "";
    if (!/^https?:\/\//i.test(logo) && logo.trim() !== "") problems.badLogo.push(`${j.company?.name}: data URI (dikonversi saat kirim)`);
  }

  console.log(`\n── Audit ${checked} job terkirim sukses (terbaru) ──`);
  console.log(`  Deskripsi kosong          : ${problems.noDesc.length}`);
  console.log(`  Deskripsi <30 char        : ${problems.shortDesc.length}`);
  console.log(`  Email HR hilang/invalid   : ${problems.noEmail.length}`);
  console.log(`  Logo data URI di DB       : ${problems.badLogo.length} (otomatis dikonversi ke URL publik saat kirim)`);
  if (problems.shortDesc.length) console.log(`    contoh: ${problems.shortDesc.slice(0, 3).join("; ")}`);
  if (problems.noEmail.length) console.log(`    contoh: ${problems.noEmail.slice(0, 3).join("; ")}`);
  if (problems.badLogo.length) console.log(`    contoh: ${problems.badLogo.slice(0, 3).join("; ")}`);

  // 3. Job READY yang masih mengantre — pastikan semua ber-email & ber-deskripsi
  const ready = await db.job.findMany({
    where: { status: "READY", pulledAt: null },
    include: {
      company: { select: { name: true, logoUrl: true, website: true } },
      contact: { select: { hrEmail: true } },
    },
  });
  const bad = ready.filter(
    (j) => !j.contact?.hrEmail || (j.description?.length ?? 0) < 30 || !j.company
  );
  console.log(`\n── Job READY mengantre: ${ready.length}, bermasalah: ${bad.length} ${bad.length === 0 ? "✓" : "⚠"}`);
  for (const j of bad.slice(0, 5)) {
    console.log(`  ${j.title}: email=${j.contact?.hrEmail ?? "TIDAK ADA"} desc=${j.description?.length ?? 0} char`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

// Inspeksi hasil tombol "Kirim ke portal":
// 1. Delivery FAILED terbaru — responseCode/responseBody (kenapa gagal kirim)
// 2. Job READY ber-statusReason PREFLIGHT — group by reason (kenapa ditahan)
// Jalankan: npx tsx scripts/inspect-send-now-result.ts
import { db } from "@/lib/db";

async function main() {
  console.log("── Delivery FAILED terbaru (7 hari) ──\n");
  const failed = await db.apiDelivery.findMany({
    where: { status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { job: { select: { title: true } } },
  });
  if (failed.length === 0) console.log("(tidak ada)");
  for (const d of failed) {
    console.log(`[${d.createdAt.toISOString()}] ${d.job.title.slice(0, 50)}`);
    console.log(`  endpoint : ${d.endpoint}`);
    console.log(`  attempt  : ${d.attempt}/${d.maxAttempts}`);
    console.log(`  code     : ${d.responseCode ?? "null (network error)"}`);
    console.log(`  body     : ${(d.responseBody ?? "").slice(0, 300)}`);
    console.log("");
  }

  console.log("── Distribusi delivery per status ──");
  const byStatus = await db.apiDelivery.groupBy({ by: ["status"], _count: { _all: true } });
  for (const s of byStatus) console.log(`  ${s.status}: ${s._count._all}`);

  console.log("\n── Job READY yang ditahan (statusReason PREFLIGHT) ──\n");
  const held = await db.job.groupBy({
    by: ["statusReason"],
    _count: { _all: true },
    where: { status: "READY", statusReason: { not: null } },
    orderBy: { _count: { statusReason: "desc" } },
  });
  if (held.length === 0) console.log("(tidak ada)");
  for (const h of held) {
    console.log(`  ${h._count._all}×  ${(h.statusReason ?? "").slice(0, 180)}`);
  }

  console.log("\n── Contoh job ditahan (3 teratas) ──\n");
  const samples = await db.job.findMany({
    where: { status: "READY", statusReason: { not: null } },
    take: 3,
    include: {
      company: { select: { name: true, logoUrl: true, website: true, profile: true } },
      jobLinks: { include: { source: { select: { slug: true } } } },
      contact: { select: { hrEmail: true, emailVerified: true } },
    },
  });
  for (const j of samples) {
    console.log(`${j.title.slice(0, 60)} — ${j.statusReason}`);
    console.log(`  company : ${j.company ? `${j.company.name} | logo=${j.company.logoUrl ? "ada" : "KOSONG"} | website=${j.company.website ?? "null"} | profile=${j.company.profile ? "ada" : "KOSONG"}` : "NULL"}`);
    console.log(`  links   : ${j.jobLinks.length} (${j.jobLinks.map((l) => l.source.slug).join(", ")})`);
    console.log(`  contact : ${j.contact ? `${j.contact.hrEmail} verified=${j.contact.emailVerified}` : "NULL"}`);
    console.log(`  desc len: ${j.description?.length ?? 0}`);
    console.log("");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

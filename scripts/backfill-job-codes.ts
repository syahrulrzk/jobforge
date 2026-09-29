// ─────────────────────────────────────────────────────────────
// Backfill Job.code — ID publik readable JOBS00001 (§19b).
// Semua job lama yang masih code="" diberi nomor urut berdasar
// createdAt (tertua → JOBS00001) supaya urutan kode nyambung
// dengan umur data, bukan urutan random id.
//
// Idempotent: hanya menyentuh row code="".
// Jalankan: npx tsx scripts/backfill-job-codes.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("── Backfill Job.code (JOBS00001) ──\n");

  const pending = await db.job.findMany({
    where: { code: "" },
    orderBy: { scrapedAt: "asc" },
    select: { id: true, title: true },
  });
  console.log(`Job tanpa code: ${pending.length}`);

  if (pending.length === 0) {
    console.log("Semua job sudah punya code — selesai ✓");
    return;
  }

  // Lanjut dari nomor terbesar yang sudah terpakai (kalau backfill
  // pernah jalan sebagian) — anti tabrakan JOBS####.
  const last = await db.job.findFirst({
    where: { code: { not: "" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  let seq = 0;
  if (last?.code) {
    const m = /^JOBS(\d+)$/.exec(last.code);
    if (m) seq = parseInt(m[1], 10);
  }
  console.log(`Nomor awal: JOBS${String(seq + 1).padStart(5, "0")}\n`);

  let updated = 0;
  let lastCode = "";
  for (const job of pending) {
    let code = "";
    // Coba sampai dapat nomor yang benar-benar bebas (kalau ada row manual
    // lain menembus nomor yang sama, geser terus — loop-nya bounded).
    for (let i = 0; i < 1000; i++) {
      seq += 1;
      const candidate = `JOBS${String(seq).padStart(5, "0")}`;
      const clash = await db.job.findFirst({ where: { code: candidate }, select: { id: true } });
      if (!clash) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      console.error(`Gagal alokasi nomor bebas untuk ${job.id} — skip`);
      continue;
    }
    await db.job.update({ where: { id: job.id }, data: { code } });
    lastCode = code;
    updated += 1;
    if (updated % 100 === 0) console.log(`  … ${updated}/${pending.length}`);
  }

  console.log(`\nSelesai ✓ — ${updated} job diberi code (terakhir ${lastCode})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

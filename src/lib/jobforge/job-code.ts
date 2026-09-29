import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────
// Job code — ID publik readable: JOBS00001, JOBS00002, … (§19b)
// Dihasilkan dari Postgres sequence (backing default kolom code)
// + advisory lock sebagai anti-tabrakan concurrent: dua worker
// yang alokasi bersamaan pasti dapat nomor berbeda. Gap akibat
// rollback tidak masalah — kode bukan counter ketat.
// ─────────────────────────────────────────────────────────────

const SEQ_NAME = "job_code_seq";
const LOCK_KEY = 918_273_645; // advisory lock khusus alokasi job code

let sequenceSynced = false; // sync max-vs-sequence cukup sekali per proses

async function ensureSequence(): Promise<void> {
  await db.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS ${SEQ_NAME} START 1`);
  if (!sequenceSynced) {
    // Sequence bisa ketinggalan / di-reset (db push, restore) → dorong ke
    // depan melewati nomor terbesar yang sudah terpakai di Job.code.
    await db
      .$executeRawUnsafe(
        `SELECT setval('${SEQ_NAME}', GREATEST(
           (SELECT COALESCE(MAX(SUBSTRING(code FROM 6)::int), 0) FROM "Job" WHERE code ~ '^JOBS[0-9]+$'),
           (SELECT CASE WHEN last_value = 1 AND NOT is_called THEN 0 ELSE last_value END FROM ${SEQ_NAME})
         ))`
      )
      .catch(() => {}); // best-effort — clash tetap ditangani loop alokasi
    sequenceSynced = true;
  }
}

/**
 * Alokasi satu kode job bebas (JOBS00001-style).
 * Sequence + advisory lock → aman dipanggil dari beberapa worker sekaligus.
 * Selalu cek ke DB bahwa nomor benar-benar bebas (row manual bisa menembus
 * sequence bila pernah ada gap/backfill).
 */
export async function allocateJobCode(): Promise<string> {
  await ensureSequence();
  for (let attempt = 0; attempt < 50; attempt++) {
    // Advisory lock: alokasi serial — concurrent dapat nomor beda pasti
    await db.$executeRawUnsafe(`SELECT pg_advisory_lock(${LOCK_KEY})`);
    try {
      const rows: { next: bigint }[] = await db.$queryRawUnsafe(
        `SELECT nextval('${SEQ_NAME}') AS next`
      );
      const seq = Number(rows[0]?.next ?? 0);
      if (seq <= 0) continue;
      const candidate = `JOBS${String(seq).padStart(5, "0")}`;
      const clash = await db.job.findFirst({ where: { code: candidate }, select: { id: true } });
      if (clash) continue; // row manual — geser ke nomor berikutnya
      return candidate;
    } finally {
      await db.$executeRawUnsafe(`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
    }
  }
  // Fallback super-jarang: 50x tabrak → pakai suffix waktu supaya tetap
  // readable dan unik (JOBS04231-x7f2a) tanpa pernah gagalkan create job.
  const rows: { next: bigint }[] = await db.$queryRawUnsafe(
    `SELECT nextval('${SEQ_NAME}') AS next`
  );
  const seq = Number(rows[0]?.next ?? Date.now() % 100000);
  return `JOBS${String(seq).padStart(5, "0")}-${Date.now().toString(16).slice(-4)}`;
}

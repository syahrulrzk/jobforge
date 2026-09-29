// Reset delivery FAILED 422 "company.logo url harus berupa URL yang valid" —
// akar masalahnya: fallback badge SVG internal tersimpan sbg data URI
// (data:image/svg+xml;base64,...) dan dikirim mentah ke portal, padahal
// validasi URL Karivia strict. Fix di payload: portalSafeLogoUrl() mengkonversi
// data URI → Google favicon/placeholder publik. Delivery lama di-reset ke
// PENDING supaya tick berikutnya mengirim ulang dgn payload yang sudah benar.
//
// Aman karena:
//   - Hanya menyentuh delivery FAILED dgn responseCode 422 DAN responseBody
//     yang memuat pesan error logo_url persis (bukan 422 lain).
//   - processBulkImport hanya menghitung dedup dari delivery SUCCESS —
//     baris FAILED tidak dipakai dedup, jadi reset tidak bikin duplikat.
//   - Job terkait (status SENT/PUBLISHED dgn delivery ini) di-reset ke READY
//     hanya kalau belum di-pull consumer (pulledAt null) supaya worker
//     mengangkut ulang. Yang sudah di-pull tidak disentuh.
//   - nextRetryAt dikosongkan → langsung masuk batch tick berikutnya.
//
// Jalankan: npx tsx scripts/reset-logo422-deliveries.ts
import { db } from "@/lib/db";

const LOGO_ERR = "company.logo url harus berupa URL yang valid";

async function main() {
  const targets = await db.apiDelivery.findMany({
    where: {
      status: "FAILED",
      responseCode: 422,
      responseBody: { contains: LOGO_ERR },
    },
    select: { id: true, jobId: true },
  });
  console.log(`── Delivery FAILED 422 logo_url ditemukan: ${targets.length} ──\n`);
  if (targets.length === 0) {
    console.log("Tidak ada yang perlu di-reset ✓");
    return;
  }

  // Reset delivery → PENDING (attempt 1, tanpa error body)
  const deliveryIds = targets.map((t) => t.id);
  const del = await db.apiDelivery.updateMany({
    where: { id: { in: deliveryIds } },
    data: { status: "PENDING", attempt: 1, responseCode: null, responseBody: null, nextRetryAt: null, deliveredAt: null },
  });
  console.log(`Delivery di-reset ke PENDING: ${del.count}`);

  // Job terkait yang masih SENT (belum PUBLISHED) & belum di-pull → READY agar
  // worker mengangkut ulang. Job yang sudah PUBLISHED tidak disentuh — datanya
  // sudah diterima portal dgn delivery sukses lain / diproses konsumen.
  const jobIds = [...new Set(targets.map((t) => t.jobId))];
  const jobs = await db.job.findMany({
    where: { id: { in: jobIds }, status: "SENT", pulledAt: null },
    select: { id: true },
  });
  if (jobs.length > 0) {
    const upd = await db.job.updateMany({
      where: { id: { in: jobs.map((j) => j.id) } },
      data: { status: "READY", statusReason: null },
    });
    console.log(`Job SENT → READY (agar diangkut ulang): ${upd.count}`);
  } else {
    console.log("Tidak ada job SENT yang perlu di-reset ke READY");
  }

  console.log("\nSelesai ✓ — tick berikutnya (≤5 dtk) akan mengirim ulang dengan logo URL publik yang valid.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

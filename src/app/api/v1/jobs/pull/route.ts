import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { verifyApiToken } from "@/lib/jobforge/api-tokens";
import { preflightCanonical, log } from "@/lib/jobforge/engine";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// GET /api/v1/jobs/pull — API konsumsi job (PRD §19b, model LEASE/ACK)
//
// Auth : Bearer <API_TOKEN> (dibuat via /api/tokens)
//
// ALUR CONSUMER:
//   1. GET  /api/v1/jobs/pull?lease_minutes=15
//      → job READY dikembalikan dgn status LEASED: tersembunyi dari
//        consumer lain & dari delivery portal selama N menit, TAPI
//        belum final.
//   2. POST {action:"ack", ids:[…]}      → FINAL (pulledAt terisi):
//      job tidak pernah muncul lagi di pull manapun.
//      POST {action:"release", ids:[…]} → balikin job yang gagal
//      diproses ke pool tanpa menunggu lease habis.
//   3. Lease tak di-ack dalam N menit → otomatis balik ke pool
//      (bisa di-pull consumer lain).
//
// Recovery: ?include_pulled=1 → ikutkan job yang sudah FINAL
// (pulledAt terisi) tanpa mengubah flag apapun.
// ─────────────────────────────────────────────────────────────

const DEFAULT_LEASE_MIN = 15;
const MAX_LEASE_MIN = 120;

/**
 * Tulis riwayat konsumsi (ApiPullLog) — satu baris per job per aksi.
 * Snapshot job diambil saat penulisan; kegagalan logging tidak pernah
 * menggagalkan aksi pull itu sendiri.
 */
async function writePullLogs(
  tokenId: string,
  action: "LEASE" | "ACK" | "RELEASE",
  leaseMin: number | null,
  jobWhere: Record<string, unknown>
): Promise<void> {
  try {
    const jobs = await db.job.findMany({
      where: jobWhere,
      select: {
        id: true,
        code: true,
        title: true,
        jobLinks: { select: { source: { select: { slug: true } }, sourceUrl: true }, take: 1 },
      },
    });
    if (jobs.length === 0) return;
    await db.apiPullLog.createMany({
      data: jobs.map((j) => ({
        tokenId,
        jobId: j.id,
        jobCode: j.code || j.id,
        jobTitle: j.title,
        action,
        leaseMin,
        metaJson: JSON.stringify({
          platform: j.jobLinks[0]?.source.slug ?? null,
          url: j.jobLinks[0]?.sourceUrl ?? null,
        }),
      })),
    });
  } catch {
    // logging must never break the pull API
  }
}

export async function GET(req: NextRequest) {
  await ensureBootstrap();

  // 1. Auth Bearer
  const principal = await verifyApiToken(req.headers.get("authorization"));
  if (!principal) {
    return NextResponse.json(
      { success: false, message: "Unauthorized — Bearer token tidak valid atau sudah di-revoke" },
      { status: 401 }
    );
  }

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") ?? "50", 10) || 50));
  const leaseMin = Math.min(MAX_LEASE_MIN, Math.max(1, parseInt(sp.get("lease_minutes") ?? String(DEFAULT_LEASE_MIN), 10) || DEFAULT_LEASE_MIN));
  const includePulled = sp.get("include_pulled") === "1";
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMin * 60_000);

  // 2. Kandidat lease: READY, belum FINAL (pulledAt null), lease aktif
  //    maupun kadaluarsa dianggap bebas (expired → balik ke pool).
  const jobs = await db.job.findMany({
    where: {
      status: "READY",
      contact: { isNot: null },
      pulledAt: null,
      OR: [{ pullLeaseUntil: null }, { pullLeaseUntil: { lt: now } }],
    },
    orderBy: { scrapedAt: "asc" },
    take: limit,
    include: { company: true, jobLinks: { include: { source: true } }, contact: true },
  });

  // 3. Build payload canonical — hanya job yang lolos pre-flight
  const payload: object[] = [];
  const leaseIds: string[] = [];
  for (const job of jobs) {
    const pre = preflightCanonical(job);
    if (!pre.ok) continue; // data belum lengkap — biarkan enrichment yang lanjut
    payload.push({ id: job.id, code: job.code || job.id, lease_until: leaseUntil.toISOString(), ...pre.canonical });
    leaseIds.push(job.id);
  }

  // 4. LEASE atomik — guard ganda di where (belum FINAL & belum di-lease
  //    aktif) supaya concurrent pull tidak pernah dobel antar consumer.
  if (leaseIds.length > 0) {
    const res = await db.job.updateMany({
      where: {
        id: { in: leaseIds },
        pulledAt: null,
        OR: [{ pullLeaseUntil: null }, { pullLeaseUntil: { lt: now } }],
      },
      data: {
        pullLeaseUntil: leaseUntil,
        pulledByTokenId: principal.id,
        pullCount: { increment: 1 },
      },
    });
    await db.apiToken
      .update({ where: { id: principal.id }, data: { pullCount: { increment: res.count } } })
      .catch(() => {});
    if (res.count > 0) {
      await log("deliver", "info", `API pull ${res.count} job (lease ${leaseMin}m) oleh token "${principal.name}"`, {
        source: "api-pull",
      });
      // riwayat konsumsi — re-query yang benar-benar ke-lease oleh token ini
      await writePullLogs(principal.id, "LEASE", leaseMin, {
        id: { in: leaseIds },
        pulledByTokenId: principal.id,
        pullLeaseUntil: leaseUntil,
      });
    }
  }

  // 5. Recovery — job FINAL ikut dilampirkan bila diminta (tanpa ubah flag)
  let recovered: object[] = [];
  if (includePulled) {
    const finalized = await db.job.findMany({
      where: { status: "READY", contact: { isNot: null }, pulledAt: { not: null } },
      orderBy: { scrapedAt: "asc" },
      take: limit,
      include: { company: true, jobLinks: { include: { source: true } }, contact: true },
    });
    recovered = finalized.flatMap((job) => {
      const pre = preflightCanonical(job);
      return pre.ok ? [{ id: job.id, code: job.code || job.id, ...pre.canonical }] : [];
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      requested: limit,
      lease_minutes: leaseMin,
      pulled_at: now.toISOString(),
      count: payload.length,
      jobs: payload,
      ...(includePulled ? { recovered_count: recovered.length, recovered_jobs: recovered } : {}),
      // petunjuk alur untuk consumer
      next: `POST /api/v1/jobs/pull {"action":"ack","ids":[…]} untuk final, atau {"action":"release","ids":[…]} untuk balikin ke pool. Lease kadaluarsa → otomatis balik ke pool.`,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// POST — ack / release atas job yang sedang di-lease token ini.
// Body: { action: "ack" | "release", ids: string[] } — ids boleh
// berupa job.id (cuid) ATAU job.code (JOBS00001).
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  await ensureBootstrap();

  const principal = await verifyApiToken(req.headers.get("authorization"));
  if (!principal) {
    return NextResponse.json(
      { success: false, message: "Unauthorized — Bearer token tidak valid atau sudah di-revoke" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => null)) as { action?: unknown; ids?: unknown } | null;
  const action = body?.action;
  const rawIds = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  if (action !== "ack" && action !== "release") {
    return NextResponse.json({ success: false, message: 'action harus "ack" atau "release"' }, { status: 422 });
  }
  if (rawIds.length === 0) {
    return NextResponse.json({ success: false, message: "ids wajib diisi (array job.id atau job.code)" }, { status: 422 });
  }
  const ids = rawIds.slice(0, 200);

  // ids bisa id ATAU code — resolve ke job nyata
  const jobs = await db.job.findMany({
    where: { OR: [{ id: { in: ids } }, { code: { in: ids } }] },
    select: { id: true, code: true, title: true, pulledAt: true, pulledByTokenId: true },
  });
  // hanya job yang sedang di-lease OLEH TOKEN INI & belum FINAL yang boleh diubah
  const owned = jobs.filter((j) => !j.pulledAt && j.pulledByTokenId === principal.id).map((j) => j.id);

  let affected = 0;
  const now = new Date();
  if (owned.length > 0) {
    if (action === "ack") {
      // FINAL — tidak akan muncul lagi di pull manapun
      const res = await db.job.updateMany({
        where: { id: { in: owned }, pulledAt: null, pulledByTokenId: principal.id },
        data: { pulledAt: now, pullLeaseUntil: null },
      });
      affected = res.count;
      if (affected > 0) {
        await log("deliver", "info", `API ack ${affected} job (final) oleh token "${principal.name}"`, { source: "api-pull" });
        await writePullLogs(principal.id, "ACK", null, { id: { in: owned } });
      }
    } else {
      // release — balikin ke pool: hapus lease & kepemilikan
      const res = await db.job.updateMany({
        where: { id: { in: owned }, pulledAt: null, pulledByTokenId: principal.id },
        data: { pullLeaseUntil: null, pulledByTokenId: null },
      });
      affected = res.count;
      if (affected > 0) {
        await log("deliver", "info", `API release ${affected} job (balik ke pool) oleh token "${principal.name}"`, { source: "api-pull" });
        await writePullLogs(principal.id, "RELEASE", null, { id: { in: owned } });
      }
    }
  }

  const notOwned = ids.length - affected;
  return NextResponse.json({
    success: true,
    data: {
      action,
      affected,
      // id yang dikirim tapi bukan milik token ini / sudah final / tidak dikenal
      skipped: notOwned,
    },
  });
}

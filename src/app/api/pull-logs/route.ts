import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// GET /api/pull-logs — riwayat konsumsi API pull (§19b)
// Satu baris = satu aksi (LEASE/ACK/RELEASE) atas satu job oleh
// satu token. Data job disimpan sebagai snapshot, jadi riwayat
// tetap terbaca walau job sudah terhapus dari DB.
// ─────────────────────────────────────────────────────────────

const ACTIONS = ["LEASE", "ACK", "RELEASE"] as const;

export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(sp.get("pageSize") ?? "15", 10) || 15));
  const action = sp.get("action") ?? "";
  const tokenId = sp.get("token") ?? "";
  const q = sp.get("q")?.trim() ?? "";
  // rentang grafik aktivitas harian (7/14/30 hari, default 14)
  const days = [7, 14, 30].includes(parseInt(sp.get("days") ?? "14", 10)) ? parseInt(sp.get("days") ?? "14", 10) : 14;

  const where: Record<string, unknown> = {};
  if (ACTIONS.includes(action as (typeof ACTIONS)[number])) where.action = action;
  if (tokenId) where.tokenId = tokenId;
  if (q) {
    // cari by kode job / judul / nama token
    where.OR = [
      { jobCode: { contains: q, mode: "insensitive" as const } },
      { jobTitle: { contains: q, mode: "insensitive" as const } },
      { token: { is: { name: { contains: q, mode: "insensitive" as const } } } },
    ];
  }

  const [total, pageRaw, actionStats] = await Promise.all([
    db.apiPullLog.count({ where }),
    db.apiPullLog.findMany({
      where,
      include: { token: { select: { name: true, tokenPrefix: true, status: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    // statistik GLOBAL per aksi (24 jam terakhir) — nggak ikut filter,
    // supaya chip jumlah tetap lengkap saat filter aktif
    db.apiPullLog.groupBy({
      by: ["action"],
      where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      _count: true,
    }),
  ]);

  const activeTokens = await db.apiToken.count({ where: { status: "ACTIVE" } });

  // Aktivitas harian (rentang sesuai ?days= — global, semua aksi; grafik tab Riwayat).
  // Group by hari pakai raw SQL (Prisma groupBy tidak dukung date_trunc).
  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);
  const rawDaily = await db
    .$queryRawUnsafe<{ date: string; action: string; count: number }[]>(
      `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date, action, COUNT(*)::int AS count
         FROM "ApiPullLog"
        WHERE "createdAt" >= $1
        GROUP BY 1, 2`,
      since
    )
    .catch(() => [] as { date: string; action: string; count: number }[]);
  const daily: { date: string; label: string; LEASE: number; ACK: number; RELEASE: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    daily.push({
      date: key,
      label: d.toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }),
      LEASE: rawDaily.find((r) => r.date === key && r.action === "LEASE")?.count ?? 0,
      ACK: rawDaily.find((r) => r.date === key && r.action === "ACK")?.count ?? 0,
      RELEASE: rawDaily.find((r) => r.date === key && r.action === "RELEASE")?.count ?? 0,
    });
  }

  // pad-to-full-page: halaman terakhir yang berisa digeser mundur
  // biar tabel tidak pernah nampilin halaman berisa (pola /api/jobs)
  let logs = pageRaw;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > 1 && page === totalPages && pageRaw.length < pageSize && total > pageSize) {
    logs = await db.apiPullLog.findMany({
      where,
      include: { token: { select: { name: true, tokenPrefix: true, status: true } } },
      orderBy: { createdAt: "desc" },
      skip: total - pageSize,
      take: pageSize,
    });
  }

  return NextResponse.json({
    total,
    page,
    pageSize,
    activeTokens,
    stats: Object.fromEntries(ACTIONS.map((a) => [a, actionStats.find((s) => s.action === a)?._count ?? 0])),
    daily,
    logs: logs.map((l) => ({
      id: l.id,
      tokenId: l.tokenId,
      tokenName: l.token.name,
      tokenPrefix: l.token.tokenPrefix,
      tokenRevoked: l.token.status !== "ACTIVE",
      jobId: l.jobId,
      jobCode: l.jobCode,
      jobTitle: l.jobTitle,
      action: l.action,
      leaseMin: l.leaseMin,
      meta: safeParse(l.metaJson),
      createdAt: l.createdAt,
    })),
  });
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const o: unknown = JSON.parse(json);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

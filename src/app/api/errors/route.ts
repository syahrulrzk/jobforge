import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { resolveError } from "@/lib/jobforge/engine";

export const dynamic = "force-dynamic";

// GET /api/errors — error list + agregat tipe (PRD §34)
// byType & openCount GLOBAL (chips filter tetap lengkap saat filter aktif),
// total & errors mengikuti filter `type`
export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(sp.get("pageSize") ?? "20", 10) || 20));
  const type = sp.get("type")?.trim() ?? "";

  const where: Record<string, unknown> = {};
  if (type) where.errorType = type;

  const [total, openCount, byTypeRaw, errors] = await Promise.all([
    db.scrapeError.count({ where }),
    db.scrapeError.count({ where: { status: "OPEN" } }),
    db.scrapeError.groupBy({
      by: ["errorType"],
      _count: { errorType: true },
      orderBy: { _count: { errorType: "desc" } },
    }),
    db.scrapeError.findMany({
      where,
      orderBy: { lastSeen: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { source: { select: { name: true, slug: true } } },
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    openCount,
    byType: byTypeRaw.map((t) => ({ type: t.errorType, count: t._count.errorType })),
    errors: errors.map((e) => ({
      id: e.id,
      errorType: e.errorType,
      message: e.message,
      stack: e.stack,
      retryCount: e.retryCount,
      status: e.status,
      firstSeen: e.firstSeen.toISOString(),
      lastSeen: e.lastSeen.toISOString(),
      source: e.source ? { name: e.source.name, slug: e.source.slug } : null,
    })),
  });
}

// PATCH /api/errors — resolve an error (PRD §34)
export async function PATCH(req: NextRequest) {
  await ensureBootstrap();
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string") {
    return NextResponse.json({ error: "Missing error id" }, { status: 422 });
  }
  try {
    await resolveError(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error not found" }, { status: 404 });
  }
}

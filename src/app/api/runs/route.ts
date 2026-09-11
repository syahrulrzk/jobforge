import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// GET /api/runs — scrape runs listing (PRD §32)
export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(sp.get("pageSize") ?? "20", 10) || 20));
  const sourceId = sp.get("source") ?? "";
  const status = sp.get("status") ?? "";

  const where: Record<string, unknown> = {};
  if (sourceId) where.sourceId = sourceId;
  if (status) where.status = status;

  const [total, runs] = await Promise.all([
    db.scrapeRun.count({ where }),
    db.scrapeRun.findMany({
      where,
      include: { source: { select: { id: true, name: true, slug: true, scraperType: true } } },
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    runs: runs.map((r) => ({
      id: r.id,
      source: r.source,
      engine: r.engine,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      pagesScraped: r.pagesScraped,
      jobsFound: r.jobsFound,
      jobsCreated: r.jobsCreated,
      jobsUpdated: r.jobsUpdated,
      jobsRejected: r.jobsRejected,
      jobsDuplicate: r.jobsDuplicate,
      errorCount: r.errorCount,
      status: r.status,
    })),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

const ACTIONS = ["scrape", "parse", "normalize", "enrich", "validate", "dedup", "deliver", "import", "error"];
const STATUSES = ["success", "failed", "info", "warning"];

// GET /api/activity — full structured log stream (PRD §26)
// Query params:
//   limit   (1–1000, default 200) — max logs returned (newest first)
//   offset  (default 0)           — skip for "load older" pagination
//   action  scrape|parse|normalize|enrich|validate|dedup|deliver|import|error
//   status  success|failed|info|warning
//   source  source slug (e.g. jobstreet) or "system" for null-source logs
//   q       free-text search on message
export async function GET(req: NextRequest) {
  await ensureBootstrap();

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number.parseInt(sp.get("limit") ?? "200", 10) || 200, 1), 1000);
  const offset = Math.max(Number.parseInt(sp.get("offset") ?? "0", 10) || 0, 0);
  const action = sp.get("action");
  const status = sp.get("status");
  const source = sp.get("source");
  const q = sp.get("q")?.trim() ?? "";

  const where: Record<string, unknown> = {};
  if (action && ACTIONS.includes(action)) where.action = action;
  if (status && STATUSES.includes(status)) where.status = status;
  if (source) {
    if (source === "system") where.source = null;
    else where.source = source;
  }
  if (q) {
    // SQLite LIKE via Prisma `contains` is case-sensitive — cover common casings
    const lower = q.toLowerCase();
    const upper = q.toUpperCase();
    const capitalized = q.charAt(0).toUpperCase() + q.slice(1);
    where.OR = [
      { message: { contains: q } },
      { message: { contains: lower } },
      { message: { contains: upper } },
      { message: { contains: capitalized } },
    ];
  }

  // facet counts per action — computed WITHOUT the action filter so chips stay useful
  const facetWhere = { ...where } as Record<string, unknown>;
  delete facetWhere.action;

  const [logs, total, byAction, sourceRows] = await Promise.all([
    db.activityLog.findMany({
      where,
      orderBy: { ts: "desc" },
      take: limit,
      skip: offset,
    }),
    db.activityLog.count({ where }),
    db.activityLog.groupBy({ by: ["action"], _count: { action: true }, where: facetWhere }),
    db.activityLog.findMany({ select: { source: true }, distinct: ["source"], orderBy: { source: "asc" } }),
  ]);

  return NextResponse.json({
    logs,
    total,
    limit,
    offset,
    byAction: byAction
      .map((g) => ({ action: g.action, count: g._count.action }))
      .sort((a, b) => b.count - a.count),
    sources: sourceRows.map((r) => r.source),
  });
}

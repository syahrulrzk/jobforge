import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { sourceCreateSchema } from "@/lib/jobforge/schemas";

export const dynamic = "force-dynamic";

// GET /api/sources — source management list (PRD §31)
export async function GET() {
  await ensureBootstrap();
  const sources = await db.source.findMany({
    include: {
      _count: { select: { jobLinks: true, runs: true } },
      runs: { orderBy: { startedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });
  const rows = sources.map((s) => {
    const lastRun = s.runs[0];
    const recent = s.runs;
    void recent;
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      baseUrl: s.baseUrl,
      type: s.type,
      status: s.status,
      scraperType: s.scraperType,
      engine: s.engine,
      engines: s.engines || s.engine,
      schedule: s.schedule,
      proxyUrl: s.proxyUrl || "",
      headersJson: s.headersJson || "",
      lastRunAt: s.lastRunAt,
      jobCount: s._count.jobLinks,
      runCount: s._count.runs,
      lastRun: lastRun
        ? {
            status: lastRun.status,
            jobsFound: lastRun.jobsFound,
            jobsCreated: lastRun.jobsCreated,
            jobsRejected: lastRun.jobsRejected,
            engine: lastRun.engine,
            startedAt: lastRun.startedAt,
          }
        : null,
    };
  });
  return NextResponse.json({ sources: rows });
}

// POST /api/sources — add source (PRD §31 add source)
export async function POST(req: NextRequest) {
  await ensureBootstrap();
  const body = await req.json().catch(() => null);
  const parsed = sourceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 422 });
  }
  const d = parsed.data;
  const slug = d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const exists = await db.source.findUnique({ where: { slug } });
  if (exists) {
    return NextResponse.json({ error: "Source with that name already exists" }, { status: 409 });
  }
  // §9.3 multi-engine — urutan array = prioritas failover; engine = primary (engines[0])
  const enginesCsv = d.engines && d.engines.length > 0 ? d.engines.join(",") : d.engine ?? "cheerio";
  const source = await db.source.create({
    data: {
      slug,
      name: d.name,
      baseUrl: d.baseUrl,
      type: d.type,
      status: "ACTIVE",
      scraperType: d.scraperType,
      engine: enginesCsv.split(",")[0],
      engines: enginesCsv,
      schedule: d.schedule,
      proxyUrl: d.proxyUrl ?? "",
      headersJson: d.headersJson ?? "",
    },
  });
  return NextResponse.json({ source }, { status: 201 });
}

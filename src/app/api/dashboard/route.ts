import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// GET /api/dashboard — aggregated overview stats (PRD §28)
export async function GET() {
  await ensureBootstrap();

  const [
    totalJobs,
    totalCompanies,
    hrEmailsFound,
    validEmails,
    activeSources,
    totalSources,
    successfulScrapes,
    failedScrapes,
    jobsSent,
    jobsPublished,
    needsEnrichment,
    rejected,
    pendingDeliveries,
    failedDeliveries,
    openErrors,
  ] = await Promise.all([
    db.job.count(),
    db.company.count(),
    db.jobContact.count(),
    db.jobContact.count({ where: { emailStatus: "VALID" } }),
    db.source.count({ where: { status: "ACTIVE" } }),
    db.source.count(),
    db.scrapeRun.count({ where: { status: "SUCCESS" } }),
    db.scrapeRun.count({ where: { status: "FAILED" } }),
    db.job.count({ where: { status: { in: ["SENT", "PUBLISHED"] } } }),
    db.job.count({ where: { status: "PUBLISHED" } }),
    db.job.count({ where: { status: "NEEDS_ENRICHMENT" } }),
    db.job.count({ where: { status: "REJECTED" } }),
    db.apiDelivery.count({ where: { status: { in: ["PENDING", "SENDING"] } } }),
    db.apiDelivery.count({ where: { status: "FAILED" } }),
    db.scrapeError.count({ where: { status: "OPEN" } }),
  ]);

  const finished = successfulScrapes + failedScrapes;
  const successRate = finished === 0 ? 0 : Math.round((successfulScrapes / finished) * 1000) / 10;

  // jobs per day — last 14 days (scraping activity chart)
  const since = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000);
  since.setHours(0, 0, 0, 0);
  const jobs = await db.job.findMany({
    where: { scrapedAt: { gte: since } },
    select: { scrapedAt: true, status: true },
  });
  const perDay: Record<string, { created: number; published: number }> = {};
  for (let i = 0; i < 14; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    perDay[key] = { created: 0, published: 0 };
  }
  for (const j of jobs) {
    const key = j.scrapedAt.toISOString().slice(0, 10);
    if (perDay[key]) perDay[key].created += 1;
  }
  const publishedJobs = await db.job.findMany({
    where: { status: "PUBLISHED", publishedAt: { gte: since } },
    select: { publishedAt: true },
  });
  for (const j of publishedJobs) {
    const key = j.publishedAt ? j.publishedAt.toISOString().slice(0, 10) : "";
    if (perDay[key]) perDay[key].published += 1;
  }

  const activity = Object.entries(perDay).map(([date, v]) => ({
    date,
    ...v,
  }));

  // status distribution (pipeline funnel)
  const statusGroups = await db.job.groupBy({ by: ["status"], _count: { status: true } });
  const statusDist = statusGroups.map((g) => ({ status: g.status, count: g._count.status }));

  // source health (per PRD §28 example)
  const sources = await db.source.findMany({
    include: {
      _count: { select: { jobLinks: true } },
      runs: { orderBy: { startedAt: "desc" }, take: 5 },
    },
  });
  const sourceHealth = sources
    .map((s) => {
      const finishedRuns = s.runs.filter((r) => r.status !== "RUNNING").length;
      const ok = s.runs.filter((r) => r.status === "SUCCESS").length;
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        status: s.status,
        scraperType: s.scraperType,
        jobCount: s._count.jobLinks,
        lastRunAt: s.lastRunAt,
        successRate: finishedRuns === 0 ? null : Math.round((ok / finishedRuns) * 100),
      };
    })
    .sort((a, b) => b.jobCount - a.jobCount);

  // recent activity (§26 structured logs) — preview for dashboard console
  const recentActivity = await db.activityLog.findMany({
    orderBy: { ts: "desc" },
    take: 30,
  });

  // live pipeline counters
  const inFlight = {
    scraped: statusDist.find((s) => s.status === "SCRAPED")?.count ?? 0,
    processing: statusDist.find((s) => s.status === "PROCESSING")?.count ?? 0,
    enriching: statusDist.find((s) => s.status === "ENRICHING")?.count ?? 0,
    validating: statusDist.find((s) => s.status === "VALIDATING")?.count ?? 0,
    ready: statusDist.find((s) => s.status === "READY")?.count ?? 0,
  };

  return NextResponse.json({
    stats: {
      totalJobs,
      totalCompanies,
      hrEmailsFound,
      validEmails,
      activeSources,
      totalSources,
      successfulScrapes,
      failedScrapes,
      successRate,
      jobsSent,
      jobsPublished,
      needsEnrichment,
      rejected,
      pendingDeliveries,
      failedDeliveries,
      openErrors,
    },
    inFlight,
    activity,
    statusDist,
    sourceHealth,
    recentActivity,
  });
}

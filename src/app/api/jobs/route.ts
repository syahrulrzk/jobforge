import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// GET /api/jobs — listing + search + filters (PRD §29)
export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(sp.get("pageSize") ?? "20", 10) || 20));
  const q = sp.get("q")?.trim() ?? "";
  const title = sp.get("title")?.trim() ?? ""; // position search — word-AND over title/skills
  const location = sp.get("location")?.trim() ?? "";
  const remote = sp.get("remote"); // "true" → remote only
  const source = sp.get("source") ?? "";
  const status = sp.get("status") ?? "";
  const company = sp.get("company") ?? "";
  const date = sp.get("date") ?? ""; // 24h | 7d | 30d | all
  const withEmail = sp.get("withEmail") === "1"; // LokerBase mode — only jobs carrying an HR email

  const where: Record<string, unknown> = {};
  if (withEmail) where.contact = { isNot: null };
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { location: { contains: q } },
      { company: { is: { name: { contains: q } } } },
    ];
  }
  if (title) {
    // every word must appear somewhere in the title/skills — "react frontend" matches "Frontend Engineer (React)"
    const words = title.split(/\s+/).filter(Boolean).slice(0, 6);
    where.AND = words.map((w) => ({
      OR: [{ title: { contains: w } }, { normalizedTitle: { contains: w } }, { skills: { contains: w } }],
    }));
  }
  if (location) where.location = { contains: location };
  if (remote === "true") where.workplaceType = "REMOTE";
  if (status) where.status = status;
  if (company) where.companyId = company;
  if (source || date) {
    const jobSourceWhere: Record<string, unknown> = {};
    if (source) jobSourceWhere.sourceId = source;
    if (date && date !== "all") {
      const hours = date === "24h" ? 24 : date === "7d" ? 168 : 720;
      jobSourceWhere.firstSeenAt = { gte: new Date(Date.now() - hours * 3600 * 1000) };
    }
    where.jobLinks = { some: jobSourceWhere };
  }

  const [total, jobs] = await Promise.all([
    db.job.count({ where }),
    db.job.findMany({
      where,
      include: {
        company: true,
        contact: true,
        jobLinks: { include: { source: true } },
        deliveries: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { scrapedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company ? { id: j.company.id, name: j.company.name, logoUrl: j.company.logoUrl, website: j.company.website } : null,
      source: j.jobLinks[0]
        ? { slug: j.jobLinks[0].source.slug, name: j.jobLinks[0].source.name, url: j.jobLinks[0].sourceUrl }
        : null,
      location: j.location,
      workplaceType: j.workplaceType,
      salaryMin: j.salaryMin,
      salaryMax: j.salaryMax,
      currency: j.currency,
      status: j.status,
      statusReason: j.statusReason,
      hrEmail: j.contact?.hrEmail ?? null,
      emailStatus: j.contact?.emailStatus ?? null,
      scrapedAt: j.scrapedAt,
      deliveryStatus: j.deliveries[0]?.status ?? null,
    })),
  });
}

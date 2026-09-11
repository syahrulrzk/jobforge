import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// GET /api/companies — company listing (PRD §30)
export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(60, Math.max(6, parseInt(sp.get("pageSize") ?? "12", 10) || 12));
  const q = sp.get("q")?.trim() ?? "";

  const where = q ? { name: { contains: q } } : {};

  const [total, companies] = await Promise.all([
    db.company.count({ where }),
    db.company.findMany({
      where,
      include: {
        _count: { select: { jobs: true } },
        jobs: {
          orderBy: { scrapedAt: "desc" },
          take: 1,
          select: { scrapedAt: true, title: true, status: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const rows = await Promise.all(
    companies.map(async (c) => {
      const contacts = await db.jobContact.findMany({
        where: { job: { companyId: c.id } },
        select: { hrEmail: true, emailStatus: true },
        distinct: ["hrEmail"],
        take: 5,
      });
      const activeJobs = await db.job.count({
        where: { companyId: c.id, status: { in: ["READY", "SENT", "PUBLISHED"] } },
      });
      return {
        id: c.id,
        name: c.name,
        logoUrl: c.logoUrl,
        website: c.website,
        industry: c.industry,
        profile: c.profile,
        jobCount: c._count.jobs,
        activeJobs,
        hrContacts: contacts,
        lastJob: c.jobs[0] ?? null,
        enrichedAt: c.enrichedAt,
      };
    })
  );

  return NextResponse.json({ total, page, pageSize, companies: rows });
}

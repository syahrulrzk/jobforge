import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// GET /api/companies/:id — company detail (PRD §30)
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ensureBootstrap();
  const { id } = await ctx.params;
  const company = await db.company.findUnique({
    where: { id },
    include: { jobs: { orderBy: { scrapedAt: "desc" }, take: 10 } },
  });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const contacts = await db.jobContact.findMany({
    where: { job: { companyId: company.id } },
    include: { job: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  // email harvest (Domain Search) — company bisa punya email tanpa job
  const harvested = await db.harvestedContact.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const sources = await db.jobSource.findMany({
    where: { job: { companyId: company.id } },
    include: { source: { select: { name: true, slug: true } } },
    distinct: ["sourceId"],
    take: 10,
  });

  return NextResponse.json({
    company: {
      id: company.id,
      name: company.name,
      normalizedName: company.normalizedName,
      logoUrl: company.logoUrl,
      website: company.website,
      profile: company.profile,
      industry: company.industry,
      size: company.size,
      enrichedAt: company.enrichedAt,
      createdAt: company.createdAt,
    },
    jobs: company.jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      location: j.location,
      scrapedAt: j.scrapedAt,
    })),
    contacts: contacts.map((c) => ({
      hrEmail: c.hrEmail,
      emailStatus: c.emailStatus,
      emailVerified: c.emailVerified,
      jobTitle: c.job.title,
    })),
    harvested: harvested.map((h) => ({
      email: h.email,
      kind: h.kind,
      category: h.category,
      via: h.via,
      sourceUrl: h.sourceUrl,
      createdAt: h.createdAt,
    })),
    sources: sources.map((s) => ({ name: s.source.name, slug: s.source.slug })),
  });
}

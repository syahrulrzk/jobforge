import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// GET /api/jobs/:id — full job detail incl. canonical JSON (PRD §29)
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ensureBootstrap();
  const { id } = await ctx.params;
  const job = await db.job.findUnique({
    where: { id },
    include: {
      company: true,
      contact: true,
      jobLinks: { include: { source: true } },
      deliveries: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const link = job.jobLinks[0];
  const canonical = link
    ? {
        source: {
          platform: link.source.slug,
          job_id: link.sourceJobId,
          url: link.sourceUrl,
        },
        company: job.company
          ? {
              name: job.company.name,
              logo_url: job.company.logoUrl,
              website: job.company.website,
              profile: job.company.profile,
            }
          : null,
        job: {
          title: job.title,
          description: job.description,
          salary:
            job.salaryMin && job.salaryMax
              ? { min: job.salaryMin, max: job.salaryMax, currency: job.currency ?? "IDR" }
              : null,
          location: job.location,
          employment_type: job.employmentType,
          workplace_type: job.workplaceType,
          requirements: job.requirements ? JSON.parse(job.requirements) : null,
          skills: job.skills ? JSON.parse(job.skills) : null,
        },
        contact: job.contact
          ? {
              hr_email: job.contact.hrEmail,
              email_source: job.contact.emailSourceUrl,
              email_verified: job.contact.emailVerified,
            }
          : null,
        metadata: { scraped_at: job.scrapedAt.toISOString() },
      }
    : null;

  return NextResponse.json({
    job: {
      id: job.id,
      title: job.title,
      description: job.description,
      status: job.status,
      statusReason: job.statusReason,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      currency: job.currency,
      location: job.location,
      employmentType: job.employmentType,
      workplaceType: job.workplaceType,
      requirements: job.requirements ? JSON.parse(job.requirements) : null,
      skills: job.skills ? JSON.parse(job.skills) : null,
      fingerprint: job.fingerprint,
      scrapedAt: job.scrapedAt,
      publishedAt: job.publishedAt,
      company: job.company,
      contact: job.contact,
      sources: job.jobLinks.map((l) => ({
        platform: l.source.name,
        slug: l.source.slug,
        jobId: l.sourceJobId,
        url: l.sourceUrl,
      })),
      deliveries: job.deliveries,
    },
    canonical,
  });
}

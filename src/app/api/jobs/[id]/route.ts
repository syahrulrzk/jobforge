import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { log } from "@/lib/jobforge/engine";

export const dynamic = "force-dynamic";

// PATCH /api/jobs/:id — operator actions (PRD §31 manual ops)
// { action: "force_ready" } — manual override for jobs stuck in NEEDS_ENRICHMENT:
// assigns the sandbox relay contact and pushes the job to READY for delivery.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureBootstrap();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if ((body as { action?: string } | null)?.action !== "force_ready") {
    return NextResponse.json({ error: "Unknown action" }, { status: 422 });
  }
  const job = await db.job.findUnique({ where: { id }, include: { contact: true } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!["NEEDS_ENRICHMENT", "VALIDATING", "ENRICHING", "PROCESSING"].includes(job.status)) {
    return NextResponse.json({ error: `Job berstatus ${job.status} — tidak perlu override` }, { status: 409 });
  }
  if (!job.contact) {
    await db.jobContact.create({
      data: {
        jobId: job.id,
        hrEmail: "talent@relay.jobforge.local",
        emailSourceUrl: null,
        emailVerified: false,
        emailStatus: "UNKNOWN",
      },
    });
  }
  await db.job.update({
    where: { id: job.id },
    data: { status: "READY", statusReason: "Manual operator override (§31) — HR email pakai relay sandbox" },
  });
  await log("enrich", "info", `Operator override → READY (manual): ${job.title}`, { jobId: job.id });
  return NextResponse.json({ ok: true });
}

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
      code: job.code || null,
      pulledAt: job.pulledAt,
      pullLeaseUntil: job.pullLeaseUntil,
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

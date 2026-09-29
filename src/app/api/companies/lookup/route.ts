import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { cleanCompanyName, resolveDomainFromName } from "@/lib/jobforge/logo";

export const dynamic = "force-dynamic";

// GET /api/companies/lookup?q=simgroup.co.id
// Cari perusahaan by nama ATAU domain (simgroup.co.id) → info + agregat lowongan.
// Dicari di: Company.name, Company.website, Job.companyName (raw dari board).
export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ error: "Ketik nama atau domain perusahaan (min. 2 karakter)" }, { status: 422 });
  }

  const isDomain = q.includes(".");
  const bare = isDomain ? q.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "") : q;
  const base = isDomain ? bare.split(".")[0] : q;
  const searchTokens = (isDomain ? base.replace(/-/g, " ") : q).split(/\s+/).filter((w) => w.length >= 3);

  const companyWhere = {
    OR: [
      ...(isDomain ? [{ website: { contains: base, mode: "insensitive" as const } }] : []),
      ...searchTokens.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })),
    ],
  };

  // 1. company di registry
  const companies = await db.company.findMany({
    where: companyWhere,
    take: 6,
    include: {
      _count: { select: { jobs: true } },
    },
  });

  // 2. job dengan companyName raw yang cocok (belum tentu punya relasi Company)
  const rawJobConds = searchTokens.map((w) => ({
    companyName: { contains: w, mode: "insensitive" as const },
  }));
  const rawJobWhere = isDomain
    ? { OR: [...rawJobConds, { company: { is: { website: { contains: base, mode: "insensitive" as const } } } }] }
    : { AND: rawJobConds };

  const [totalJobs, jobs] = await Promise.all([
    db.job.count({ where: rawJobWhere }),
    db.job.findMany({
      where: rawJobWhere,
      include: { company: true, contact: true, jobLinks: { include: { source: true } } },
      orderBy: { scrapedAt: "desc" },
      take: 20,
    }),
  ]);

  // 3. bila belum terdaftar — coba resolve identitas via Clearbit (nama/domain)
  let suggestion: { name: string; domain: string; website: string } | null = null;
  const registered = companies[0];
  if (!registered && searchTokens.length > 0) {
    const domain = isDomain ? bare : await resolveDomainFromName(q);
    if (domain) {
      suggestion = {
        name: cleanCompanyName(q).replace(/\b\w/g, (m) => m.toUpperCase()),
        domain,
        website: `https://${domain}`,
      };
    }
  }

  return NextResponse.json({
    query: q,
    registered: companies.map((c) => ({
      id: c.id,
      name: c.name,
      logoUrl: c.logoUrl,
      website: c.website,
      industry: c.industry,
      size: c.size,
      profile: c.profile,
      jobCount: c._count.jobs,
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      companyName: j.company?.name ?? j.companyName,
      logoUrl: j.company?.logoUrl ?? j.companyLogoUrl,
      location: j.location,
      salaryMin: j.salaryMin,
      salaryMax: j.salaryMax,
      currency: j.currency,
      status: j.status,
      hrEmail: j.contact?.hrEmail ?? null,
      source: j.jobLinks[0]?.source.slug ?? null,
      sourceUrl: j.jobLinks[0]?.sourceUrl ?? null,
      scrapedAt: j.scrapedAt,
    })),
    totalJobs,
    suggestion,
  });
}

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
  const company = sp.get("company") ?? ""; // company id (dari kartu company)
  const companyName = sp.get("companyName")?.trim() ?? ""; // cari by nama/domain perusahaan
  const companyDomain = sp.get("companyDomain")?.trim() ?? "";
  const date = sp.get("date") ?? ""; // 24h | 7d | 30d | all
  const withEmail = sp.get("withEmail") === "1"; // LokerBase mode — only jobs carrying an HR email

  const where: Record<string, unknown> = {};
  if (withEmail) where.contact = { isNot: null };
  if (q) {
    // mode: "insensitive" — Postgres contains default-nya case-sensitive;
    // tanpa ini "jakarta" gagal match "Jakarta Selatan" (SQLite lama
    // kebetulan case-insensitive, jadi bug ini muncul setelah migrasi DB)
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { location: { contains: q, mode: "insensitive" } },
      { company: { is: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }
  if (title) {
    // every word must appear somewhere in the title/skills — "react frontend" matches "Frontend Engineer (React)"
    const words = title.split(/\s+/).filter(Boolean).slice(0, 6);
    where.AND = words.map((w) => ({
      OR: [
        { title: { contains: w, mode: "insensitive" } },
        { normalizedTitle: { contains: w, mode: "insensitive" } },
        { skills: { contains: w, mode: "insensitive" } },
      ],
    }));
  }
  if (companyName) {
    // cari lowongan perusahaan tertentu — semua kata wajib ada di nama company
    // ("sim group" → "PT SIM Group" cocok); OR di companyName & company relasi
    const words = companyName.split(/\s+/).filter(Boolean).slice(0, 5);
    const nameConds = words.map((w) => ({
      OR: [
        { companyName: { contains: w, mode: "insensitive" } },
        { company: { is: { name: { contains: w, mode: "insensitive" } } } },
      ],
    }));
    where.AND = [...((where.AND as unknown[]) ?? []), ...nameConds];
  }
  if (companyDomain) {
    // domain → job lewat nama company ATAU website company
    const bare = companyDomain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
    const base = bare.split(".")[0];
    where.OR = [
      { company: { is: { website: { contains: base, mode: "insensitive" } } } },
      { companyName: { contains: base, mode: "insensitive" } },
    ];
  }
  if (location) where.location = { contains: location, mode: "insensitive" };
  if (remote === "true") where.workplaceType = "REMOTE";
  // kategori kerja — chips LokerBase: FULL_TIME | PART_TIME | FREELANCE | CONTRACT | INTERNSHIP
  const employment = sp.get("employment")?.trim() ?? "";
  if (["FULL_TIME", "PART_TIME", "FREELANCE", "CONTRACT", "INTERNSHIP"].includes(employment)) {
    where.employmentType = employment;
  }
  // kategori tempat kerja — ONSITE | REMOTE | HYBRID (chip WFO/WFH)
  const workplace = sp.get("workplace")?.trim() ?? "";
  if (["ONSITE", "REMOTE", "HYBRID"].includes(workplace)) {
    where.workplaceType = workplace;
  }
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

  const [total, pageRaw] = await Promise.all([
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

  // Pad-to-full-page: halaman terakhir yang berisa digeser mundur biar
  // selalu penuh — grid gak pernah nampilin baris kosong/berisa.
  let jobs = pageRaw;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > 1 && page === totalPages && pageRaw.length < pageSize) {
    jobs = total > pageSize
      ? await db.job.findMany({
          where,
          include: {
            company: true,
            contact: true,
            jobLinks: { include: { source: true } },
            deliveries: { orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: { scrapedAt: "desc" },
          skip: total - pageSize,
          take: pageSize,
        })
      : pageRaw;
  }

  return NextResponse.json({
    total,
    page,
    pageSize,
    jobs: jobs.map((j) => ({
      id: j.id,
      code: j.code || null,
      pulledAt: j.pulledAt,
      title: j.title,
      company: j.company
        ? { id: j.company.id, name: j.company.name, logoUrl: j.company.logoUrl, website: j.company.website }
        : null,
      // fallback: nama perusahaan dari payload scrape (belum ter-link jadi Company)
      companyName: j.companyName,
      source: j.jobLinks[0]
        ? { slug: j.jobLinks[0].source.slug, name: j.jobLinks[0].source.name, url: j.jobLinks[0].sourceUrl }
        : null,
      location: j.location,
      workplaceType: j.workplaceType,
      employmentType: j.employmentType,
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

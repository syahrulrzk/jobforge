import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { extractDomain } from "@/lib/jobforge/logo";
import { findEmailFromInternet, parseSearchEngine } from "@/lib/jobforge/email-finder";
import { harvestDomainEmails } from "@/lib/jobforge/domain-email-harvest";
import { parseProxyMode } from "@/lib/jobforge/proxy-pool";
import { bareDomain, saveHarvestToDb } from "@/lib/jobforge/harvest-store";

export const dynamic = "force-dynamic";
// tools eksternal (bbot scan + OCR + holehe) bisa makan waktu — beri ruang
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────
// Tools — Cari Email
//
// GET /api/search/email?q=PT+ABC&domain=abc.co.id
//   1. Langsung match email HR yang SUDAH ada di DB (JobContact) via
//      domain / nama perusahaan.
//   2. Kalau tidak ada → coba Company registry (nama/website).
//
// POST /api/search/email { name?, website?, engine?, useExternalTools?, mode? }
//   mode "hr" (default): cari email HR/karir — chain WEBSITE → SEARCH →
//   LINKEDIN + BBOT/OCR/HOLEHE (saat useExternalTools) → simpan ke JobContact.
//   mode "harvest": ala hunter.io — SEMUA email yang ke-expose di internet
//   untuk satu domain (deep crawl situs + search @domain + BBOT opt-in).
// ─────────────────────────────────────────────────────────────


export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const domain = bareDomain(sp.get("domain") ?? "");
  if (q.length < 2 && domain.length < 3) {
    return NextResponse.json({ error: "Masukkan nama atau domain perusahaan (min. 2/3 karakter)" }, { status: 422 });
  }

  const base = domain ? domain.split(".")[0] : q;
  const nameWords = (q || base.replace(/-/g, " ")).split(/\s+/).filter((w) => w.length >= 3);

  // 1) email HR yang sudah ada di DB — company by website ATAU nama
  const companyWhere = {
    OR: [
      ...(domain ? [{ website: { contains: base, mode: "insensitive" as const } }] : []),
      ...nameWords.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })),
    ],
  };
  const companies = await db.company.findMany({ where: companyWhere, take: 6 });
  const companyIds = companies.map((c) => c.id);

  const jobWhere = {
    OR: [
      ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
      ...nameWords.map((w) => ({ companyName: { contains: w, mode: "insensitive" as const } })),
    ],
  };

  const contacts = await db.jobContact.findMany({
    where: { job: jobWhere },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          status: true,
          companyName: true,
          company: { select: { id: true, name: true, logoUrl: true, website: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  // 2) Company registry — buat kartu "belum ada email → probe live"
  const registered = companies.slice(0, 6).map((c) => ({
    id: c.id,
    name: c.name,
    logoUrl: c.logoUrl,
    website: c.website,
    industry: c.industry,
    size: c.size,
    hasEmail: contacts.some((ct) => ct.job.company?.id === c.id),
  }));

  // 3) email harvest yang pernah disimpan untuk domain/nama ini
  const harvestWhere = domain
    ? { OR: [{ domain: { contains: base, mode: "insensitive" as const } }, ...(nameWords.length ? [{ domain: { contains: nameWords[0], mode: "insensitive" as const } }] : [])] }
    : nameWords.length
      ? { domain: { contains: nameWords[0], mode: "insensitive" as const } }
      : null;
  const harvested = harvestWhere
    ? await db.harvestedContact.findMany({ where: harvestWhere, orderBy: { createdAt: "desc" }, take: 50 })
    : [];

  // Saran domain kalau company belum terdaftar dan input mengandung "."
  let suggestion: { name: string; domain: string } | null = null;
  if (domain) {
    suggestion = { name: q || base.replace(/-/g, " "), domain };
  }

  // stats gudang data — total email terkumpul (hunter.io style warehouse)
  const warehouseTotal = await db.harvestedContact.count();
  const warehouseCompanies = await db.harvestedContact.groupBy({ by: ["domain"], _count: { domain: true } });

  return NextResponse.json({
    query: { q, domain },
    total: contacts.length,
    warehouse: {
      totalEmails: warehouseTotal,
      totalDomains: warehouseCompanies.length,
    },
    harvested: harvested.map((h) => ({
      email: h.email,
      kind: h.kind,
      category: h.category,
      via: h.via,
      domain: h.domain,
      companyName: h.companyId ? (companies.find((c) => c.id === h.companyId)?.name ?? null) : null,
      createdAt: h.createdAt,
    })),
    emails: contacts.map((ct) => ({
      id: ct.id,
      hrEmail: ct.hrEmail,
      emailStatus: ct.emailStatus,
      emailSourceUrl: ct.emailSourceUrl,
      jobId: ct.job.id,
      jobTitle: ct.job.title,
      jobStatus: ct.job.status,
      company: ct.job.company
        ? { id: ct.job.company.id, name: ct.job.company.name, logoUrl: ct.job.company.logoUrl, website: ct.job.company.website }
        : null,
      companyName: ct.job.company?.name ?? ct.job.companyName ?? "—",
      logoUrl: ct.job.company?.logoUrl ?? null,
      createdAt: ct.createdAt,
    })),
    registered,
    suggestion,
  });
}

export async function POST(req: NextRequest) {
  await ensureBootstrap();
  let body: {
    name?: string;
    website?: string;
    engine?: string;
    useExternalTools?: boolean;
    mode?: string;
    action?: string;
    proxyMode?: string;
    proxyUrl?: string;
    emails?: { email: string; kind: string; category: string | null; sourceUrl: string; via: string; sources: string[] }[];
  };
  try {
    body = (await req.json()) as {
      name?: string;
      website?: string;
      engine?: string;
      useExternalTools?: boolean;
      mode?: string;
      action?: string;
      proxyMode?: string;
      proxyUrl?: string;
      emails?: { email: string; kind: string; category: string | null; sourceUrl: string; via: string; sources: string[] }[];
    };
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const name = body.name?.trim() ?? "";
  const website = body.website?.trim() ?? "";
  const searchEngine = parseSearchEngine(body.engine);
  const useExternalTools = body.useExternalTools === true;
  const mode = body.mode === "harvest" ? "harvest" : "hr";
  // proxy: "direct" (default) | "auto" (pool gratis tervalidasi) | "custom" (URL operator)
  const proxyMode = parseProxyMode(body.proxyMode);
  const proxyUrl = body.proxyUrl?.trim() || null;
  if (name.length < 2 && !website) {
    return NextResponse.json({ error: "Isi nama atau website perusahaan dulu" }, { status: 422 });
  }

  // ── mode HARVEST: semua email publik untuk domain (ala hunter.io) ──
  if (mode === "harvest") {
    // action "save": simpan hasil harvest ke DB (upsert Company + HarvestedContact)
    if (body.action === "save" && body.emails) {
      const domain = (body.website ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*/, "").trim() || "";
      const saved = await saveHarvestToDb(body.emails, domain, name);
      return NextResponse.json(saved);
    }

    const harvest = await harvestDomainEmails(name, website || null, searchEngine, useExternalTools, proxyMode, proxyUrl);

    // ── AUTO-SAVE (gudang data): semua hasil harvest langsung masuk DB ──
    const saveResult = harvest.emails.length > 0 ? await saveHarvestToDb(harvest.emails, harvest.domain, name) : null;

    // tandai email yang tersimpan (semuanya setelah auto-save)
    return NextResponse.json({
      mode: "harvest",
      domain: harvest.domain,
      emails: harvest.emails.map((e) => ({ ...e, saved: true, companyId: saveResult?.companyId ?? null })),
      pagesCrawled: harvest.pagesCrawled,
      steps: harvest.steps,
      durationMs: harvest.durationMs,
      autoSaved: saveResult ? { created: saveResult.created, duplicate: saveResult.duplicate, companyName: saveResult.companyName } : null,
    });
  }

  const started = Date.now();
  // Engine chain: WEBSITE (homepage→karir→kontak→browser) → SEARCH ENGINE
  // (mesin pencari dipilih user: auto/duckduckgo/bing/google-cse) → saat
  // useExternalTools: BBOT email-enum + tesseract OCR + verifikasi HOLEHE.
  // Semua step transparan.
  const finder = await findEmailFromInternet(name || bareDomain(website), website || null, searchEngine, useExternalTools, { proxyMode, proxyUrl });

  if (!finder.found || !finder.email) {
    return NextResponse.json({
      found: false,
      steps: finder.steps,
      durationMs: finder.durationMs,
      message: "Tidak ada email ter-publish yang ditemukan di internet untuk perusahaan ini (website + mesin pencari)",
    });
  }

  const result = finder.email;

  // ── AUTO-SAVE (gudang data): kandidat mode HR juga masuk gudang ──
  const harvestDomain = extractDomain(result.sourceUrl) ?? bareDomain(website) ?? "";
  const autoSaved = await saveHarvestToDb(
    [
      result,
      ...finder.candidates.filter((c) => c.email !== result.email),
    ].map((c) => ({
      email: c.email,
      kind: c.role ? "role" : c.personName ? "personal" : "unknown",
      category: c.role,
      sourceUrl: c.sourceUrl,
      via: c.via,
      sources: [c.sourceUrl],
    })),
    harvestDomain,
    name,
  );

  // Persist ke JobContact job pertama perusahaan — biar muncul juga di
  // Jobs/HR Contacts dan pipeline delivery. JobContact butuh jobId: pakai
  // job terbaru yang match company ini.
  const domainBase = (extractDomain(result.sourceUrl) ?? bareDomain(website) ?? "").split(".")[0];
  const company =
    (website ? await db.company.findFirst({ where: { website: { contains: domainBase, mode: "insensitive" } } }) : null) ??
    (name
      ? await db.company.findFirst({ where: { name: { contains: name.split(/\s+/)[0], mode: "insensitive" } } })
      : null);

  let attachedJobId: string | null = null;
  if (company) {
    const job = await db.job.findFirst({
      where: { companyId: company.id },
      orderBy: { scrapedAt: "desc" },
      select: { id: true },
    });
    if (job) {
      await db.jobContact.upsert({
        where: { jobId: job.id },
        create: { jobId: job.id, hrEmail: result.email, emailSourceUrl: result.sourceUrl },
        update: { hrEmail: result.email, emailSourceUrl: result.sourceUrl, emailStatus: "UNKNOWN" },
      });
      attachedJobId = job.id;
    }
  }

  return NextResponse.json({
    found: true,
    email: result.email,
    sourceUrl: result.sourceUrl,
    via: result.via,
    engine: searchEngine,
    personName: result.personName,
    personInferred: result.personInferred,
    role: result.role,
    candidates: finder.candidates.slice(0, 10),
    autoSaved: { created: autoSaved.created, duplicate: autoSaved.duplicate, companyName: autoSaved.companyName },
    steps: finder.steps,
    verified: finder.verified ?? null,
    attachedJobId,
    durationMs: finder.durationMs,
  });
}

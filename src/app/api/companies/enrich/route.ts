import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { enrichCompanyProfile, PLACEHOLDER_PROFILE } from "@/lib/jobforge/company-enrich";
import { log } from "@/lib/jobforge/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/companies/enrich — trigger company profile enrichment from website
// body: { name: string, website?: string } → scrape company website → update Company record
export async function POST(req: NextRequest) {
  await ensureBootstrap();
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const website = typeof body?.website === "string" ? body.website.trim() : undefined;

  if (name.length < 2) {
    return NextResponse.json({ error: "Nama perusahaan minimal 2 karakter" }, { status: 422 });
  }

  const t0 = Date.now();

  try {
    // Cek apakah company sudah ada di DB
    const existing = await db.company.findFirst({
      where: { name: { contains: name, mode: "insensitive" } },
    });

    if (existing && existing.profile !== PLACEHOLDER_PROFILE && existing.enrichedAt) {
      // Company sudah dienrichment sebelumnya
      return NextResponse.json({
        success: true,
        message: "Profil perusahaan sudah ada",
        company: {
          id: existing.id,
          name: existing.name,
          website: existing.website,
          industry: existing.industry,
          size: existing.size,
          profile: existing.profile,
          enrichedAt: existing.enrichedAt,
        },
      });
    }

    // Jalankan enrichment
    const profile = await enrichCompanyProfile(name, website ?? existing?.website ?? null);

    if (!profile) {
      await log("enrich", "failed", `Company enrichment gagal untuk "${name}" — tidak ada data yang bisa diekstrak`, { durationMs: Date.now() - t0 });
      return NextResponse.json({ error: "Tidak dapat mengekstrak data profil perusahaan" }, { status: 404 });
    }

    // Normalize company name
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Upsert company record
    const company = await db.company.upsert({
      where: existing ? { id: existing.id } : { normalizedName },
      create: {
        name,
        normalizedName,
        logoUrl: "", // akan diisi oleh logo resolver
        website: profile.website || null,
        profile: profile.description || PLACEHOLDER_PROFILE,
        industry: profile.industry || null,
        size: profile.size || null,
        enrichedAt: new Date(),
      },
      update: {
        website: profile.website || existing?.website || null,
        profile: profile.description || existing?.profile || PLACEHOLDER_PROFILE,
        industry: profile.industry || existing?.industry || null,
        size: profile.size || existing?.size || null,
        enrichedAt: new Date(),
      },
    });

    await log(
      "enrich",
      "success",
      `Company enrichment berhasil untuk "${name}" — source: ${profile.source}, website: ${profile.domain || "N/A"}`,
      { durationMs: Date.now() - t0 }
    );

    return NextResponse.json({
      success: true,
      message: "Profil perusahaan berhasil dienrichment",
      company: {
        id: company.id,
        name: company.name,
        website: company.website,
        industry: company.industry,
        size: company.size,
        profile: company.profile,
        enrichedAt: company.enrichedAt,
        source: profile.source,
      },
    });
  } catch (err) {
    await log("enrich", "failed", `Company enrichment error untuk "${name}": ${err instanceof Error ? err.message : String(err)}`, { durationMs: Date.now() - t0 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Company enrichment gagal" },
      { status: 500 }
    );
  }
}

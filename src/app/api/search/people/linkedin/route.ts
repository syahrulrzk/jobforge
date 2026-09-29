import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { parseSearchEngine } from "@/lib/jobforge/email-finder";
import { searchPeopleOnInternet } from "@/lib/jobforge/people-search";

export const dynamic = "force-dynamic";
// beberapa query SERP berurutan + pool proxy auto bisa makan waktu
export const maxDuration = 120;

// ─────────────────────────────────────────────────────────────
// Tools — Cari Orang & Jabatan via Internet
//
// GET /api/search/people/linkedin?role=IT+Manager&company=Bank+Mandiri
//      &location=Jakarta&industry=perbankan&engine=auto&proxyMode=auto
//
// HANYA public profile yang ter-index search engine (query
// site:linkedin.com/in) — TIDAK scraping linkedin.com langsung, tidak
// butuh login/API LinkedIn. Nama & headline = heuristik dari URL/SERP
// snippet, tidak dikarang.
// ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const role = sp.get("role")?.trim() ?? "";
  const company = sp.get("company")?.trim() ?? "";
  const location = sp.get("location")?.trim() ?? "";
  const industry = sp.get("industry")?.trim() ?? "";

  if (!role && !company && !location && !industry) {
    return NextResponse.json({ error: "Isi minimal jabatan, perusahaan, lokasi, atau industri" }, { status: 422 });
  }

  const result = await searchPeopleOnInternet({
    role,
    company,
    location,
    industry,
    engine: parseSearchEngine(sp.get("engine")),
    proxyMode: sp.get("proxyMode"),
    proxyUrl: sp.get("proxyUrl"),
  });

  return NextResponse.json(result);
}

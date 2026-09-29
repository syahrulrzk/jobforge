import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { liveKeywordScrape } from "@/lib/jobforge/live-search";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// simple in-flight guard — one live scrape at a time (fingerprints dedup anyway)
let inFlight = false;

// POST /api/search/live — on-demand keyword scrape across selected boards (PRD §9)
// body: { q, sources?: string[] } — sources = slug list dari Data Sources;
// tanpa `sources` → semua source ACTIVE yang di-scrape.
export async function POST(req: NextRequest) {
  await ensureBootstrap();
  const body = await req.json().catch(() => null);
  const q = typeof body?.q === "string" ? body.q.trim() : "";
  if (q.length < 2) {
    return NextResponse.json({ error: "Kata kunci minimal 2 karakter" }, { status: 422 });
  }
  const selectedSlugs = Array.isArray(body?.sources)
    ? body.sources.filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0)
    : undefined;
  // filter perusahaan: nama ("sim group") atau domain ("simgroup.co.id")
  const companyFilter = typeof body?.company === "string" ? body.company : undefined;
  if (inFlight) {
    return NextResponse.json({ error: "Ada live scrape yang sedang berjalan — tunggu sebentar" }, { status: 429 });
  }
  inFlight = true;
  try {
    const result = await liveKeywordScrape(q, selectedSlugs, companyFilter);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Live scrape gagal" },
      { status: 500 }
    );
  } finally {
    inFlight = false;
  }
}

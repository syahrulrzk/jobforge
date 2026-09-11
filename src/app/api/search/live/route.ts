import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { liveKeywordScrape } from "@/lib/jobforge/live-search";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// simple in-flight guard — one live scrape at a time (fingerprints dedup anyway)
let inFlight = false;

// POST /api/search/live — on-demand keyword scrape across all real boards (PRD §9)
export async function POST(req: NextRequest) {
  await ensureBootstrap();
  const body = await req.json().catch(() => null);
  const q = typeof body?.q === "string" ? body.q.trim() : "";
  if (q.length < 2) {
    return NextResponse.json({ error: "Kata kunci minimal 2 karakter" }, { status: 422 });
  }
  if (inFlight) {
    return NextResponse.json({ error: "Ada live scrape yang sedang berjalan — tunggu sebentar" }, { status: 429 });
  }
  inFlight = true;
  try {
    const result = await liveKeywordScrape(q);
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

import { NextRequest, NextResponse } from "next/server";
import { extractDomain, fetchLogoPng } from "@/lib/jobforge/logo";

export const dynamic = "force-dynamic";

// GET /api/logo/:domain — company logo proxy (PRD §11 enrichment)
// Tries Clearbit → Google favicon → DuckDuckGo and streams the first
// hit back as an image. Consumer: <img> fallback chain + Job Portal payload.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ domain: string }> }) {
  const raw = (await ctx.params).domain;
  const domain = extractDomain(decodeURIComponent(raw));
  if (!domain) {
    return NextResponse.json({ error: "Invalid domain" }, { status: 400 });
  }

  const hit = await fetchLogoPng(domain);
  if (!hit) {
    return NextResponse.json({ error: "Logo not found", domain }, { status: 404 });
  }

  return new NextResponse(hit.body, {
    status: 200,
    headers: {
      "Content-Type": hit.contentType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Logo-Provider": hit.provider,
      "X-Logo-Domain": domain,
    },
  });
}

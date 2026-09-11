import { NextRequest, NextResponse } from "next/server";
import { extractDomain, fetchLogoPng, generateLogoBadge } from "@/lib/jobforge/logo";

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
  if (hit) {
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

  // no provider has this brand — deterministic generated badge (always renders)
  return new NextResponse(generateLogoBadge(domain), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Logo-Provider": "generated",
      "X-Logo-Domain": domain,
    },
  });
}

import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { runSourceNow } from "@/lib/jobforge/engine";

export const dynamic = "force-dynamic";

// POST /api/sources/:id/run — manual scrape trigger (PRD §31)
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ensureBootstrap();
  const { id } = await ctx.params;
  try {
    await runSourceNow(id);
    return NextResponse.json({ ok: true, message: "Scrape run executed" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Run failed" },
      { status: 500 }
    );
  }
}

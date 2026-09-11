import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { sourceUpdateSchema } from "@/lib/jobforge/schemas";

export const dynamic = "force-dynamic";

// PATCH /api/sources/:id — edit / enable / disable source (PRD §31)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureBootstrap();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = sourceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 422 });
  }
  const existing = await db.source.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  const source = await db.source.update({
    where: { id },
    data: { ...parsed.data, status: parsed.data.status === "ACTIVE" ? "ACTIVE" : parsed.data.status },
  });
  return NextResponse.json({ source });
}

// DELETE /api/sources/:id
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureBootstrap();
  const { id } = await ctx.params;
  const existing = await db.source.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  // detach job links, keep jobs (data provenance retained per §38)
  await db.jobSource.deleteMany({ where: { sourceId: id } });
  await db.scrapeRun.deleteMany({ where: { sourceId: id } });
  await db.scrapeError.deleteMany({ where: { sourceId: id } });
  await db.source.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

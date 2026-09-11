import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { resolveError } from "@/lib/jobforge/engine";

export const dynamic = "force-dynamic";

// PATCH /api/errors — resolve an error (PRD §34)
export async function PATCH(req: NextRequest) {
  await ensureBootstrap();
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string") {
    return NextResponse.json({ error: "Missing error id" }, { status: 422 });
  }
  try {
    await resolveError(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error not found" }, { status: 404 });
  }
}

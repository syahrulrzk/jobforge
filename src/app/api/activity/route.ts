import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// GET /api/activity — recent structured logs (PRD §26)
export async function GET() {
  await ensureBootstrap();
  const logs = await db.activityLog.findMany({
    orderBy: { ts: "desc" },
    take: 30,
  });
  return NextResponse.json({ logs });
}

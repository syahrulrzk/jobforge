import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { runPipelineNow } from "@/lib/jobforge/engine";

export const dynamic = "force-dynamic";

// POST /api/pipeline — manual "run full pipeline now" (PRD §31)
export async function POST() {
  await ensureBootstrap();
  try {
    const sourcesRun = await runPipelineNow();
    return NextResponse.json({ ok: true, message: `Pipeline executed for ${sourcesRun} source(s)` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pipeline failed" },
      { status: 500 }
    );
  }
}

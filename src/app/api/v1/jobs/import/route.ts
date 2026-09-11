import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { verifyPortalAuth, processBulkImport } from "@/lib/jobforge/portal";

export const dynamic = "force-dynamic";

// POST /api/v1/jobs/import — Job Portal bulk import endpoint (PRD §19)
// Auth: Bearer <API_KEY>
export async function POST(req: NextRequest) {
  await ensureBootstrap();
  const auth = req.headers.get("authorization");
  if (!verifyPortalAuth(auth)) {
    return NextResponse.json(
      { success: false, message: "Unauthorized — missing or invalid Bearer token" },
      { status: 401 }
    );
  }
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }
  const result = await processBulkImport(body);
  return NextResponse.json(result, { status: result.success ? 200 : 422 });
}

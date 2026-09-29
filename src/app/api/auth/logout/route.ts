import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/jobforge/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/logout — hapus cookie session.
export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

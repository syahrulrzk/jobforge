import { NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/jobforge/auth";

export const dynamic = "force-dynamic";

// GET /api/auth/verify?token=... — dipakai middleware (Edge Runtime) untuk
// memverifikasi tanda-tangan HMAC session cookie (node:crypto tidak tersedia
// di edge). Return 200 valid, 401 tidak.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get(SESSION_COOKIE) ?? req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, user: session.u });
}

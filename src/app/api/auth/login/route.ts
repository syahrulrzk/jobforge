import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { verifyCredentials, createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/jobforge/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/login — verifikasi username/password, set cookie session.
export async function POST(req: Request) {
  await ensureBootstrap();
  try {
    const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";
    if (!username || !password) {
      return NextResponse.json({ error: "Username dan password wajib diisi" }, { status: 400 });
    }
    if (!(await verifyCredentials(username, password))) {
      // 401 + tanpa Set-Cookie: kredensial salah tidak boleh membuat session.
      return NextResponse.json({ error: "Username atau password salah" }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    // Set cookie langsung di respons ini — paling andal lintas browser/proxy:
    // satu respons = set cookie + konfirmasi, tanpa bergantung pada cookies()
    // mutasi yang kadang telat saat dev/HMR.
    const token = await createSessionToken(username);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Login gagal" },
      { status: 500 }
    );
  }
}

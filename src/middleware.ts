import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/jobforge/auth";

// Middleware proteksi dashboard: semua route kecuali /login dan /api/auth/*
// wajib punya cookie session valid. Verifikasi dilakukan LANGSUNG di sini
// (HMAC via Node runtime) — TIDAK memakai self-fetch ke origin, karena lewat
// proxy/preview domain eksternal fetch tersebut gagal dan session valid ikut
// ditolak (bug: user terus di-bounce balik ke /login setelah login sukses).
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
  // Static assets Next.js + file metadata (favicon/robots/sitemap/manifest)
  // — semua ekstensi aset publik di root harus di-loloskan agar favicon,
  // robots.txt, dll tidak terbawa redirect login.
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.json" ||
    pathname === "/icon.svg" ||
    pathname === "/apple-icon.png" ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest|woff2?)$/i.test(pathname)
  ) {
    return true;
  }
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (isPublic(pathname)) {
    // Sudah login tapi buka /login? → langsung ke dashboard.
    if (pathname === "/login" && session) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (session) return NextResponse.next();

  // API request → 401 JSON; halaman → redirect ke /login
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized — login diperlukan" }, { status: 401 });
  }
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Node.js runtime: butuh node:crypto + Prisma untuk verifikasi session
  // langsung di middleware (Edge runtime tidak bisa keduanya).
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

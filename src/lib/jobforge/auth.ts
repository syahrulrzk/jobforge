// ─────────────────────────────────────────────────────────────
// JOBFORCE — Dashboard Auth (hardening produksi)
// Autentikasi sederhana berbasis cookie session bertanda-tangan HMAC:
//   - Kredensial: username (default "admin") + password disimpan di
//     tabel Setting (DASHBOARD_USERNAME / DASHBOARD_PASSWORD, SHA-256 hex).
//   - Bila Setting belum ada: fallback ke env DASHBOARD_USERNAME /
//     DASHBOARD_PASSWORD, atau kredensial default "admin"/"jobforge-admin".
//     Sesi pakai cookie HttpOnly "jf_session" berisi payload base64url +
//     tanda-tangan HMAC-SHA256 (secret otomatis dibuat di Setting).
// ─────────────────────────────────────────────────────────────────
import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "jf_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam
export { SESSION_TTL_MS };

export const AUTH_KEYS = {
  username: "DASHBOARD_USERNAME",
  password: "DASHBOARD_PASSWORD", // SHA-256 hex
  secret: "DASHBOARD_SESSION_SECRET",
} as const;

async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ── Kredensial ──────────────────────────────────────────────

function defaultCredentials(): { username: string; password: string } {
  return {
    username: process.env.DASHBOARD_USERNAME || "admin",
    password: process.env.DASHBOARD_PASSWORD || "jobforge-admin",
  };
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const storedUser = (await getSetting(AUTH_KEYS.username)) ?? defaultCredentials().username;
  const storedHash = await getSetting(AUTH_KEYS.password);
  if (username !== storedUser) return false;
  if (storedHash) return safeEqual(sha256Hex(password), storedHash.toLowerCase());
  // Belum ada hash tersimpan → bandingkan langsung dengan password default/env
  return safeEqual(password, defaultCredentials().password);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const storedUser = (await getSetting(AUTH_KEYS.username)) ?? defaultCredentials().username;
  if (!(await verifyCredentials(storedUser, currentPassword))) {
    return { ok: false, error: "Password lama salah" };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: "Password baru minimal 8 karakter" };
  }
  await setSetting(AUTH_KEYS.password, sha256Hex(newPassword));
  return { ok: true };
}

// ── Secret & session ────────────────────────────────────────

async function getSecret(): Promise<string> {
  let secret = await getSetting(AUTH_KEYS.secret);
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    await setSetting(AUTH_KEYS.secret, secret);
  }
  return secret;
}

export async function createSessionToken(username: string): Promise<string> {
  const secret = await getSecret();
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS })
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<{ u: string } | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const secret = await getSecret();
  if (!safeEqual(sig, sign(payload, secret))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; exp: number };
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { u: data.u };
  } catch {
    return null;
  }
}

// ── Cookie helpers (Server Actions / Route Handlers) ────────

export async function getSession(): Promise<{ u: string } | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(username: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

// Verifikasi dari middleware (Edge Runtime tidak bisa import node:crypto
// secara aman untuk HMAC di semua versi — middleware akan memanggil API
// /api/auth/verify sebagai gantinya).
export { sha256Hex };
